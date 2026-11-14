import { db } from "./store";
import { cfg, callsAreReal, COVERED_LINE, emailIsReal } from "./config";
import { laneOf, logEvent, money, newCall, newCampaign, newLoad, newToken, now, uid } from "./repo";
import { decide } from "./negotiation";
import { outboundCall } from "./elevenlabs";
import { cutInWithCoveredLine } from "./twilio";
import { coveredEmail, customerCheckInEmail, loadOfferEmail, sendEmail } from "./email";
import { studyCustomer } from "./history";
import { simulateCall, simulateEmailReplies } from "./simulator";
import { ACTIVE_CALL, type Call, type CallOutcome, type Campaign, type Load } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const first = (name: string | null) => (name || "").trim().split(/\s+/)[0] || "there";

/* ───────────────────────── Starting campaigns ───────────────────────── */

/**
 * How to reach people:
 *  email_first – email everyone now; phone only those who haven't answered once the wait is up
 *  email_only  – email and wait for replies
 *  call_only   – phone only
 *  both        – email and phone at the same moment
 */
export type OutreachMode = "email_first" | "email_only" | "call_only" | "both";
const MODES: OutreachMode[] = ["email_first", "email_only", "call_only", "both"];
export const asMode = (v: unknown, fallback: OutreachMode = "email_first"): OutreachMode =>
  MODES.includes(v as OutreachMode) ? (v as OutreachMode) : fallback;

/** How long to give email before the phones start. Practice mode shortens it so you can watch. */
const waitMs = (minutes: number | undefined, type: "capacity" | "customer") => {
  const ms = Math.max(0, Math.min(24 * 60, Number(minutes ?? 15) || 0)) * 60_000;
  return callsAreReal(type) ? ms : Math.min(ms, 15_000);
};
const emailStage = () => (emailIsReal() ? "Emailed — waiting for a reply" : "Emailed (practice: nothing really sent)");
const clockTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export async function startCapacityCampaign(args: {
  loadId: string;
  carrierIds: string[];
  concurrency: number;
  mode: OutreachMode;
  waitMinutes?: number;
}): Promise<Campaign> {
  const store = db();
  const load = await store.get("loads", args.loadId);
  if (!load) throw new Error("Load not found.");
  if (load.status !== "open" && load.status !== "searching" && load.status !== "draft")
    throw new Error(`This load is already ${load.status}.`);
  if (load.target_rate == null || load.max_rate == null)
    throw new Error("Set the starting offer and the most you will pay first.");
  if (load.max_rate < load.target_rate) throw new Error("The most you will pay is lower than your starting offer.");

  const running = await store.list("campaigns", { eq: { load_id: load.id, status: "running" } });
  if (running.length) throw new Error("A search is already running for this load.");

  const all = await store.list("carriers");
  const byId = new Map(all.map((c) => [c.id, c]));
  const picked = args.carrierIds.map((id) => byId.get(id)).filter((c) => c && !c.do_not_call) as typeof all;
  const wantEmail = args.mode !== "call_only", wantCalls = args.mode !== "email_only";
  const toEmail = wantEmail ? picked.filter((c) => c.email) : [];
  const toCall = wantCalls ? picked.filter((c) => c.phone) : [];
  if (!toEmail.length && !toCall.length)
    throw new Error(args.mode === "email_only" ? "None of the carriers you picked has an email address." : "Pick at least one carrier to contact.");

  // Phones wait only when there are emails out to wait on.
  const delayed = args.mode === "email_first" && toEmail.length > 0 && toCall.length > 0;
  const startAt = delayed ? new Date(Date.now() + waitMs(args.waitMinutes, "capacity")).toISOString() : null;
  const hasCalls = toCall.length > 0;
  const campaign = newCampaign({
    type: "capacity",
    load_id: load.id,
    concurrency: Math.max(1, Math.min(50, Math.round(args.concurrency) || 5)),
    also_email: toEmail.length > 0,
    mode: args.mode,
    calls_start_at: startAt,
    calls_started: !delayed,
    // Email-only has nothing to "run": the emails are out and replies book the load whenever they arrive.
    status: hasCalls ? "running" : "completed",
    ended_at: hasCalls ? null : now(),
  });
  await store.insert("campaigns", [campaign]);
  await store.update("loads", load.id, { status: hasCalls ? "searching" : "open" });

  const calls = toCall.map((c, i) =>
    newCall({
      campaign_id: campaign.id, type: "capacity", channel: "call", load_id: load.id, carrier_id: c.id,
      company_name: c.name, contact_name: c.contact_name, phone: c.phone, email: c.email, mc_number: c.mc_number,
      position: i, stage: delayed ? "Will call if email gets no answer" : "Waiting in line",
    }),
  );
  const emails = toEmail.map((c, i) =>
    newCall({
      campaign_id: campaign.id, type: "capacity", channel: "email", load_id: load.id, carrier_id: c.id,
      company_name: c.name, contact_name: c.contact_name, email: c.email, mc_number: c.mc_number,
      status: "sent", stage: emailStage(), bid_token: newToken(), position: 1000 + i, started_at: now(),
    }),
  );
  await store.insert("calls", [...calls, ...emails]);

  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  await logEvent(
    "campaign_started",
    !hasCalls
      ? `Emailed ${n(emails.length, "carrier")} about ${laneOf(load)}. First one to say yes gets it.`
      : delayed
        ? `Emailed ${n(emails.length, "carrier")} about ${laneOf(load)}. If nobody takes it by ${clockTime(startAt!)}, I start calling.`
        : `Looking for a truck: ${laneOf(load)}. Calling ${n(calls.length, "carrier")}, ${campaign.concurrency} at a time${emails.length ? `, emailing ${emails.length}` : ""}.`,
    { load_id: load.id, campaign_id: campaign.id },
  );

  void deliver(emails, (e) => loadOfferEmail(load, e.contact_name, `${cfg().appUrl}/bid/${e.bid_token}`));
  if (hasCalls) {
    if (delayed) arm(campaign);
    else await tick(campaign.id);
  }
  return campaign;
}

export async function startCustomerCampaign(args: {
  customerIds: string[];
  concurrency: number;
  mode: OutreachMode;
  waitMinutes?: number;
}): Promise<Campaign> {
  const store = db();
  const all = await store.list("customers");
  const byId = new Map(all.map((c) => [c.id, c]));
  const picked = args.customerIds.map((id) => byId.get(id)).filter((c) => c && !c.do_not_call) as typeof all;
  const wantEmail = args.mode !== "call_only", wantCalls = args.mode !== "email_only";
  const toEmail = wantEmail ? picked.filter((c) => c.email) : [];
  const toCall = wantCalls ? picked.filter((c) => c.phone) : [];
  if (!toEmail.length && !toCall.length)
    throw new Error(args.mode === "email_only" ? "None of the customers you picked has an email address." : "Pick at least one customer with a phone number or email.");

  const delayed = args.mode === "email_first" && toEmail.length > 0 && toCall.length > 0;
  const startAt = delayed ? new Date(Date.now() + waitMs(args.waitMinutes, "customer")).toISOString() : null;
  const hasCalls = toCall.length > 0;
  const campaign = newCampaign({
    type: "customer",
    concurrency: Math.max(1, Math.min(50, Math.round(args.concurrency) || 3)),
    also_email: toEmail.length > 0,
    mode: args.mode,
    calls_start_at: startAt,
    calls_started: !delayed,
    status: hasCalls ? "running" : "completed",
    ended_at: hasCalls ? null : now(),
  });
  await store.insert("campaigns", [campaign]);

  const calls = toCall.map((c, i) =>
    newCall({
      campaign_id: campaign.id, type: "customer", channel: "call", customer_id: c.id, company_name: c.name,
      contact_name: c.contact_name, phone: c.phone, email: c.email, position: i,
      stage: delayed ? "Will call if email gets no answer" : "Waiting in line",
    }),
  );
  const emails = toEmail.map((c, i) =>
    newCall({
      campaign_id: campaign.id, type: "customer", channel: "email", customer_id: c.id, company_name: c.name,
      contact_name: c.contact_name, email: c.email, status: "sent", stage: emailStage(), bid_token: newToken(),
      position: 1000 + i, started_at: now(),
    }),
  );
  await store.insert("calls", [...calls, ...emails]);

  const n = (count: number) => `${count} customer${count === 1 ? "" : "s"}`;
  await logEvent(
    "campaign_started",
    !hasCalls
      ? `Emailed ${n(emails.length)} to ask for freight.`
      : delayed
        ? `Emailed ${n(emails.length)} to ask for freight. Anyone who hasn't answered by ${clockTime(startAt!)} gets a call.`
        : `Calling ${n(calls.length)} to ask for freight${emails.length ? `, and emailing ${emails.length}` : ""}.`,
    { campaign_id: campaign.id },
  );

  const loads = emails.length ? await store.list("loads", { limit: 5000 }) : [];
  void deliver(emails, (e) => {
    const customer = byId.get(e.customer_id!)!;
    return customerCheckInEmail(customer, studyCustomer(customer, loads), `${cfg().appUrl}/reply/${e.bid_token}`);
  });
  if (hasCalls) {
    if (delayed) arm(campaign);
    else await tick(campaign.id);
  }
  return campaign;
}

/** Send the emails one by one. In practice mode nothing leaves the building and replies are simulated. */
async function deliver(rows: Call[], build: (row: Call) => { subject: string; html: string }) {
  const store = db();
  for (const row of rows) {
    try {
      const mail = build(row);
      await sendEmail(row.email!, mail.subject, mail.html);
    } catch (err) {
      await store.update("calls", row.id, { status: "ended", outcome: "failed", stage: "Email could not be sent", ended_at: now() });
      console.error(err);
    }
  }
  if (!emailIsReal()) simulateEmailReplies(rows);
}

/* ───────────────────────── Phone as the second step ───────────────────────── */

function arm(campaign: Campaign) {
  if (!campaign.calls_start_at) return;
  const ms = Math.max(0, Date.parse(campaign.calls_start_at) - Date.now());
  const t = setTimeout(() => void startCalls(campaign.id).catch((e) => console.error("startCalls", e)), ms + 50);
  if (typeof t === "object" && "unref" in t) t.unref();
}

/** The wait is over (or you pressed "Call now"): phone everyone who hasn't already answered by email. */
export async function startCalls(campaignId: string): Promise<void> {
  const store = db();
  const campaign = await store.get("campaigns", campaignId);
  if (!campaign || campaign.status !== "running" || campaign.calls_started) return;
  await store.update("campaigns", campaignId, { calls_started: true, calls_start_at: now() });

  const rows = await store.list("calls", { eq: { campaign_id: campaignId } });
  const answered = new Set(
    rows
      .filter((r) => r.channel === "email" && r.outcome && r.outcome !== "failed")
      .map((r) => r.carrier_id ?? r.customer_id),
  );
  let skipped = 0;
  for (const r of rows) {
    if (r.channel !== "call" || r.status !== "queued") continue;
    if (answered.has(r.carrier_id ?? r.customer_id)) {
      skipped++;
      await store.update("calls", r.id, { status: "ended", outcome: "cancelled", stage: "Already answered by email", ended_at: now() });
    } else {
      await store.update("calls", r.id, { stage: "Waiting in line" });
    }
  }
  const left = rows.filter((r) => r.channel === "call" && r.status === "queued").length - skipped;
  if (left > 0)
    await logEvent(
      "calls_started",
      campaign.type === "capacity"
        ? `No taker by email yet — calling ${left} carrier${left === 1 ? "" : "s"} now.`
        : `Following up by phone with ${left} customer${left === 1 ? "" : "s"} who ${left === 1 ? "hasn't" : "haven't"} answered the email.`,
      { load_id: campaign.load_id, campaign_id: campaign.id },
    );
  await tick(campaignId);
}

/** Safety net for the timer: anything whose wait is over gets its calls started. Runs whenever the dashboard refreshes. */
export async function pump(): Promise<void> {
  const waiting = (await db().list("campaigns", { eq: { status: "running" } })).filter(
    (c) => !c.calls_started && c.calls_start_at && Date.parse(c.calls_start_at) <= Date.now(),
  );
  for (const c of waiting) await startCalls(c.id).catch((e) => console.error("pump", e));
}

/* ───────────────────────── The dialer loop ───────────────────────── */

/** Fill every free line. Called when a campaign starts and every time a call ends. */
export async function tick(campaignId: string): Promise<void> {
  const store = db();
  const campaign = await store.get("campaigns", campaignId);
  if (!campaign || campaign.status !== "running" || !campaign.calls_started) return;

  let calls = await store.list("calls", { eq: { campaign_id: campaignId } });

  // Sweep calls that never reported back (real calls only — the simulator always finishes).
  if (callsAreReal(campaign.type)) {
    for (const c of calls) {
      if (c.channel !== "call" || !ACTIVE_CALL.includes(c.status) || !c.started_at) continue;
      const age = Date.now() - Date.parse(c.started_at);
      if ((c.status !== "in_progress" && age > 3 * 60_000) || age > 25 * 60_000) {
        await store.update("calls", c.id, { status: "ended", outcome: c.outcome ?? "no_answer", stage: "No answer", ended_at: now() });
      }
    }
    calls = await store.list("calls", { eq: { campaign_id: campaignId } });
  }

  const phone = calls.filter((c) => c.channel === "call");
  const active = phone.filter((c) => ACTIVE_CALL.includes(c.status)).length;
  const queued = phone.filter((c) => c.status === "queued").length;

  if (active === 0 && queued === 0) {
    await finishCampaign(campaign, "completed");
    return;
  }

  const claimed = await store.claimQueued(campaignId, campaign.concurrency - active);
  for (let i = 0; i < claimed.length; i++) {
    if (i > 0 && callsAreReal(campaign.type)) await sleep(1100); // stay under Twilio's 1 call/second default
    void placeCall(claimed[i]).catch((e) => console.error("placeCall", e));
  }
}

async function placeCall(call: Call): Promise<void> {
  const store = db();
  if (!callsAreReal(call.type)) {
    simulateCall(call);
    return;
  }
  try {
    const c = cfg();
    let variables: Record<string, string | number>;
    if (call.type === "capacity") {
      const load = (await store.get("loads", call.load_id!))!;
      if (load.status === "covered") return void (await endCall(call.id, "cancelled", { stage: "Not needed — load covered" }));
      variables = {
        call_id: call.id,
        broker_name: c.brokerName,
        company_name: c.companyName,
        callback_phone: c.callbackPhone,
        carrier_name: call.company_name,
        contact_first_name: first(call.contact_name),
        load_ref: load.ref,
        origin: `${load.origin_city ?? ""}, ${load.origin_state ?? ""}`,
        destination: `${load.dest_city ?? ""}, ${load.dest_state ?? ""}`,
        pickup: [load.pickup_date, load.pickup_time].filter(Boolean).join(" at ") || "flexible",
        delivery: [load.delivery_date, load.delivery_time].filter(Boolean).join(" at ") || "flexible",
        equipment: load.equipment ?? "dry van",
        commodity: load.commodity ?? "general freight",
        weight: load.weight_lbs ? `${load.weight_lbs.toLocaleString()} pounds` : "not listed",
        miles: load.miles ? String(load.miles) : "not listed",
        opening_rate: load.target_rate ?? 0,
        special_instructions: load.special_instructions ?? "none",
      };
    } else {
      const customer = (await store.get("customers", call.customer_id!))!;
      const history = studyCustomer(customer, await store.list("loads", { eq: { customer_id: customer.id } }));
      variables = {
        call_id: call.id,
        broker_name: c.brokerName,
        company_name: c.companyName,
        callback_phone: c.callbackPhone,
        customer_name: customer.name,
        contact_first_name: first(customer.contact_name),
        history_summary: history.summary,
      };
    }
    const res = await outboundCall({
      agentId: call.type === "capacity" ? c.eleven.carrierAgent : c.eleven.customerAgent,
      toNumber: call.phone!,
      variables,
    });
    await store.update("calls", call.id, {
      status: "ringing",
      stage: "Ringing…",
      conversation_id: res.conversation_id,
      call_sid: res.call_sid,
    });
  } catch (e) {
    console.error(e);
    await endCall(call.id, "failed", { stage: "Could not place the call", summary: e instanceof Error ? e.message : String(e) });
  }
}

async function finishCampaign(campaign: Campaign, status: "completed" | "stopped") {
  const store = db();
  await store.update("campaigns", campaign.id, { status, ended_at: now() });
  if (campaign.type === "capacity" && campaign.load_id) {
    const load = await store.get("loads", campaign.load_id);
    if (load && load.status === "searching") {
      await store.update("loads", load.id, { status: "open" });
      const bids = campaign.also_email ? " Email replies can still book it." : "";
      await logEvent(
        "campaign_ended",
        status === "stopped"
          ? `Search stopped for ${laneOf(load)}.`
          : `Reached everyone on the list for ${laneOf(load)} — no truck yet. Try more carriers or raise the ceiling.${bids}`,
        { load_id: load.id, campaign_id: campaign.id },
        "warn",
      );
    }
  } else if (campaign.type === "customer") {
    const calls = await store.list("calls", { eq: { campaign_id: campaign.id } });
    const reached = new Set(calls.map((c) => c.customer_id)).size;
    const found = new Set(calls.filter((c) => c.outcome === "load_found").map((c) => c.customer_id)).size;
    await logEvent(
      "campaign_ended",
      `Customer outreach finished: ${found} with freight out of ${reached} contacted.`,
      { campaign_id: campaign.id },
      found ? "success" : "info",
    );
  }
}

export async function stopCampaign(campaignId: string) {
  const store = db();
  const campaign = await store.get("campaigns", campaignId);
  if (!campaign || campaign.status !== "running") return;
  const calls = await store.list("calls", { eq: { campaign_id: campaignId } });
  for (const c of calls) {
    if (c.status === "queued") await store.update("calls", c.id, { status: "ended", outcome: "cancelled", stage: "Stopped before dialing", ended_at: now() });
  }
  await finishCampaign(campaign, "stopped");
}

/* ───────────────────────── Call lifecycle ───────────────────────── */

export async function setStage(callId: string, patch: Partial<Call>) {
  const call = await db().get("calls", callId);
  if (!call || call.status === "ended") return null;
  return db().update("calls", callId, patch);
}

export async function endCall(callId: string, outcome: CallOutcome, extra: Partial<Call> = {}) {
  const store = db();
  const call = await store.get("calls", callId);
  if (!call) return;
  const already = call.status === "ended";
  const started = call.started_at ? Date.parse(call.started_at) : Date.now();
  await store.update("calls", callId, {
    status: "ended",
    // A booking or a "covered elsewhere" result is never overwritten by a later hang-up report.
    outcome: call.outcome ?? outcome,
    ended_at: call.ended_at ?? now(),
    duration_secs: call.duration_secs ?? Math.max(0, Math.round((Date.now() - started) / 1000)),
    ...(already ? { stage: call.stage } : {}),
    ...extra,
  });
  const stamp = { last_contacted_at: now() };
  if (call.carrier_id) await store.update("carriers", call.carrier_id, outcome === "do_not_call" ? { ...stamp, do_not_call: true } : stamp);
  if (call.customer_id) await store.update("customers", call.customer_id, outcome === "do_not_call" ? { ...stamp, do_not_call: true } : stamp);
  if (!already) await tick(call.campaign_id);
}

/* ───────────────────────── First come, first served ───────────────────────── */

export type OfferResult =
  | { status: "booked"; rate: number; say: string }
  | { status: "counter"; offer: number; say: string }
  | { status: "final_offer"; offer: number; say: string }
  | { status: "covered"; say: string }
  | { status: "error"; say: string };

/**
 * A carrier named a price (on a call, or through an email bid link).
 * Decides accept / counter, and if it's a yes, tries to win the load.
 * Only the first carrier to get here books it — everyone else is told it's covered.
 */
export async function submitOffer(args: { callId: string; ask: number; mcNumber?: string | null; notes?: string | null }): Promise<OfferResult> {
  const store = db();
  const call = await store.get("calls", args.callId);
  if (!call || !call.load_id) return { status: "error", say: "I can't find that load. Apologise and say you'll call back." };
  const load = await store.get("loads", call.load_id);
  if (!load) return { status: "error", say: "I can't find that load. Apologise and say you'll call back." };

  const covered = async (): Promise<OfferResult> => {
    if (call.outcome !== "booked")
      await store.update("calls", call.id, { outcome: "covered_elsewhere", stage: `Told them: “${COVERED_LINE}”` });
    return { status: "covered", say: `Say exactly: "${COVERED_LINE}" Then end the call.` };
  };
  if (call.outcome === "booked") return { status: "booked", rate: call.agreed_rate ?? args.ask, say: "This is already booked with them. Wrap up." };
  if (load.status !== "open" && load.status !== "searching") return covered();

  const ask = Math.round(Number(args.ask));
  if (!Number.isFinite(ask) || ask <= 0) return { status: "error", say: "Ask them what all-in rate they need for this load." };

  const d = decide(load, call, ask);
  const offerRow = { id: uid(), call_id: call.id, load_id: load.id, carrier_id: call.carrier_id, carrier_ask: ask, created_at: now() };

  if (d.decision === "accepted") {
    const won = await store.bookLoad({
      loadId: load.id,
      carrierId: call.carrier_id,
      carrierName: call.company_name,
      rate: d.rate,
      via: call.channel,
    });
    if (!won) {
      await store.insert("offers", [{ ...offerRow, our_offer: null, decision: "covered" }]);
      return covered();
    }
    await store.insert("offers", [{ ...offerRow, our_offer: d.rate, decision: "accepted" }]);
    await store.update("calls", call.id, {
      outcome: "booked",
      agreed_rate: d.rate,
      last_ask: ask,
      mc_number: args.mcNumber || call.mc_number,
      stage: `Booked at ${money(d.rate)}`,
      summary: args.notes || call.summary,
      ...(call.channel === "email" ? { status: "ended" as const, ended_at: now() } : {}),
    });
    if (call.carrier_id) {
      const carrier = await store.get("carriers", call.carrier_id);
      if (carrier) await store.update("carriers", carrier.id, { loads_hauled: carrier.loads_hauled + 1, last_contacted_at: now() });
    }
    const margin = load.customer_rate != null ? ` Margin ${money(load.customer_rate - d.rate)}.` : "";
    await logEvent(
      "booked",
      `Truck found! ${call.company_name} took ${laneOf(load)} at ${money(d.rate)}${call.channel === "email" ? " (by email)" : ""}.${margin}`,
      { load_id: load.id, call_id: call.id, campaign_id: call.campaign_id },
      "success",
    );
    await releaseEveryoneElse(won, call.id);
    return {
      status: "booked",
      rate: d.rate,
      say: `It's theirs at $${d.rate}. Confirm it's booked, confirm their MC number and the driver's name and cell, tell them the rate confirmation is coming by email, thank them, and end the call.`,
    };
  }

  const offer = d.offer;
  await store.insert("offers", [{ ...offerRow, our_offer: offer, decision: d.decision }]);
  await store.update("calls", call.id, {
    last_ask: ask,
    last_offer: offer,
    rounds: call.rounds + 1,
    stage: d.decision === "final" ? `They want ${money(ask)} — gave our best: ${money(offer)}` : `They want ${money(ask)} — countered ${money(offer)}`,
  });
  if (d.decision === "final")
    return {
      status: "final_offer",
      offer,
      say: `Tell them $${offer} is the best you can do on this one. If they agree, call this tool again with carrier_ask ${offer}. If not, thank them and log the call as declined.`,
    };
  return {
    status: "counter",
    offer,
    say: `Too high. Counter at $${offer} and give a reason (short miles, easy freight, quick pay). If they agree or name a new number, call this tool again with that number.`,
  };
}

/** The moment a load is booked: every other live call hears the line and is released. */
async function releaseEveryoneElse(load: Load, winnerCallId: string) {
  const store = db();
  const others = (await store.list("calls", { eq: { load_id: load.id } })).filter((c) => c.id !== winnerCallId && c.status !== "ended");
  let told = 0;
  await Promise.all(
    others.map(async (c) => {
      try {
        if (c.status === "queued") {
          await store.update("calls", c.id, { status: "ended", outcome: "cancelled", stage: "Not needed — load covered", ended_at: now() });
          return;
        }
        if (c.channel === "email") {
          await store.update("calls", c.id, { status: "ended", outcome: "covered_elsewhere", stage: "Let them know it's covered", ended_at: now() });
          if (c.email) {
            const mail = coveredEmail(load, c.contact_name);
            await sendEmail(c.email, mail.subject, mail.html).catch((e) => console.error(e));
          }
          return;
        }
        let stage = `Told them: “${COVERED_LINE}”`;
        if (callsAreReal("capacity") && c.call_sid) {
          const r = await cutInWithCoveredLine(c.call_sid);
          if (r === "cancelled" || r === "already_over") stage = "Hung up before they answered — load covered";
          if (r === "skipped") stage = "Load covered — the agent will tell them on its next turn";
        } else if (c.status !== "in_progress") {
          stage = "Hung up before they answered — load covered";
        }
        if (stage.startsWith("Told")) told++;
        await store.update("calls", c.id, {
          status: "ended",
          outcome: "covered_elsewhere",
          stage,
          ended_at: now(),
          duration_secs: c.started_at ? Math.round((Date.now() - Date.parse(c.started_at)) / 1000) : null,
        });
      } catch (e) {
        console.error("release failed", c.id, e);
      }
    }),
  );
  const companies = new Set(others.map((c) => c.carrier_id ?? c.id)).size;
  if (others.length)
    await logEvent(
      "released",
      `Released ${companies} other carrier${companies === 1 ? "" : "s"}${told ? ` — ${told} still on the line heard “${COVERED_LINE}”` : ""}.`,
      { load_id: load.id },
    );
  const campaigns = await store.list("campaigns", { eq: { load_id: load.id, status: "running" } });
  for (const c of campaigns) await store.update("campaigns", c.id, { status: "completed", ended_at: now() });
}

/* ───────────────────────── Customer calls ───────────────────────── */

const splitPlace = (s: string | null | undefined): [string | null, string | null] => {
  if (!s) return [null, null];
  const m = s.trim().match(/^(.*?)[,\s]+([A-Za-z]{2})$/);
  return m ? [m[1].trim(), m[2].toUpperCase()] : [s.trim(), null];
};

/** A customer said yes, they have freight. Capture it as a draft load for you to review. */
export async function logCustomerLoad(args: {
  callId: string;
  origin?: string;
  destination?: string;
  pickup_date?: string;
  equipment?: string;
  commodity?: string;
  weight_lbs?: number;
  rate?: number;
  notes?: string;
}) {
  const store = db();
  const call = await store.get("calls", args.callId);
  if (!call) return { status: "error", say: "Note the details and say you'll confirm by email." };
  const [oc, os] = splitPlace(args.origin);
  const [dc, ds] = splitPlace(args.destination);
  const load = newLoad({
    customer_id: call.customer_id,
    customer_name: call.company_name,
    origin_city: oc,
    origin_state: os,
    dest_city: dc,
    dest_state: ds,
    pickup_date: args.pickup_date || null,
    equipment: args.equipment || null,
    commodity: args.commodity || null,
    weight_lbs: args.weight_lbs ? Math.round(Number(args.weight_lbs)) : null,
    customer_rate: args.rate ? Math.round(Number(args.rate)) : null,
    special_instructions: args.notes || null,
    status: "draft",
    source: "customer_call",
  });
  await store.insert("loads", [load]);
  await store.update("calls", call.id, {
    outcome: "load_found",
    stage: `Has freight: ${laneOf(load)}`,
    ...(call.channel === "email" ? { status: "ended" as const, ended_at: now() } : {}),
  });
  await logEvent(
    "load_found",
    `${call.company_name} has a load${call.channel === "email" ? " (answered by email)" : ""}: ${laneOf(load)}${load.pickup_date ? ", picks " + load.pickup_date : ""}. Saved as a draft for you to review.`,
    { load_id: load.id, call_id: call.id, campaign_id: call.campaign_id },
    "success",
  );
  return { status: "saved", say: "Got it. Tell them you'll send a confirmation by email, ask if there is anything else moving this week, then wrap up." };
}

const OUTCOME_LABEL: Record<string, string> = {
  declined: "Passed on it",
  no_loads: "Nothing moving right now",
  callback: "Asked for a call back",
  voicemail: "Left a voicemail",
  no_answer: "No answer",
  do_not_call: "Asked not to be called",
  load_found: "Has freight",
};

/** The agent reports how the call ended. */
export async function logOutcome(args: { callId: string; outcome: CallOutcome; notes?: string }) {
  const call = await db().get("calls", args.callId);
  if (!call) return { status: "error" };
  if (call.outcome === "booked" || call.outcome === "covered_elsewhere") return { status: "ok" };
  const outcome = call.outcome === "load_found" ? "load_found" : args.outcome;
  await endCall(call.id, outcome, {
    stage: [OUTCOME_LABEL[outcome] ?? outcome, args.notes].filter(Boolean).join(" — "),
    summary: args.notes || call.summary,
  });
  return { status: "ok" };
}

export { COVERED_LINE };

/** A customer answered the check-in email without a load: nothing right now, or "call me". */
export async function logEmailReply(args: { callId: string; answer: "none" | "call"; notes?: string }) {
  const store = db();
  const call = await store.get("calls", args.callId);
  if (!call || call.channel !== "email") return { status: "error" };
  if (call.outcome === "load_found") return { status: "ok" };
  const outcome: CallOutcome = args.answer === "call" ? "callback" : "no_loads";
  await store.update("calls", call.id, {
    status: "ended",
    outcome,
    stage: [args.answer === "call" ? "Replied: please call me" : "Replied: nothing moving right now", args.notes].filter(Boolean).join(" — "),
    summary: args.notes || call.summary,
    ended_at: now(),
  });
  if (call.customer_id) await store.update("customers", call.customer_id, { last_contacted_at: now() });
  await logEvent(
    "email_reply",
    args.answer === "call" ? `${call.company_name} replied by email: wants a call.` : `${call.company_name} replied by email: nothing moving right now.`,
    { call_id: call.id, campaign_id: call.campaign_id },
  );
  return { status: "ok" };
}
