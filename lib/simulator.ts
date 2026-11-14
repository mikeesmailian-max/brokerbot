import { db } from "./store";
import { ladder } from "./negotiation";
import { money } from "./format";
import type { Call } from "./types";

/**
 * Demo mode: pretend to make the call so you can watch the whole flow
 * (dialing → talking → haggling → booked → everyone else released)
 * without a single real phone ringing.
 */
export function simulateCall(call: Call) {
  void run(call).catch((e) => console.error("simulator", e));
}

const wait = (min: number, max: number) => new Promise((r) => setTimeout(r, (min + Math.random() * (max - min)) * 1000));
const alive = async (id: string) => {
  const c = await db().get("calls", id);
  return c && c.status !== "ended" ? c : null;
};

async function run(call: Call) {
  // Lazy import: the dispatcher imports this file.
  const d = await import("./dispatcher");

  await wait(0.6, 2.2);
  if (!(await d.setStage(call.id, { status: "ringing", stage: "Ringing…" }))) return;
  await wait(2, 5);
  if (!(await alive(call.id))) return;

  const roll = Math.random();
  if (roll < 0.22) return d.endCall(call.id, "no_answer", { stage: "No answer" });
  if (roll < 0.32) return d.endCall(call.id, "voicemail", { stage: "Left a voicemail" });

  const who = (call.contact_name || "dispatch").split(" ")[0];
  if (!(await d.setStage(call.id, { status: "in_progress", stage: `Talking with ${who}` }))) return;
  await wait(3, 6);

  if (call.type === "customer") return customerCall(call, d);

  const load = call.load_id ? await db().get("loads", call.load_id) : null;
  if (!load) return d.endCall(call.id, "failed", { stage: "Load missing" });
  if (!(await d.setStage(call.id, { stage: `Pitched the load at ${money(load.target_rate)}` }))) return;
  await wait(3, 6);
  if (!(await alive(call.id))) return;

  if (Math.random() < 0.3) return d.endCall(call.id, "declined", { stage: "No truck in the area" });

  const steps = ladder(load);
  const max = steps[3];
  const span = Math.max(max - steps[0], 100);
  // Carriers start anywhere from "right at our offer" to well over our ceiling.
  let ask = Math.round((steps[0] + span * (0.3 + Math.random() * 1.5)) / 50) * 50;
  const floor = steps[0] + span * (0.25 + Math.random() * 0.95); // the least this carrier will really take

  for (let round = 0; round < 5; round++) {
    if (!(await alive(call.id))) return;
    const r = await d.submitOffer({ callId: call.id, ask, mcNumber: call.mc_number });
    if (r.status === "booked") {
      await wait(4, 7);
      return d.endCall(call.id, "booked", {});
    }
    if (r.status === "covered" || r.status === "error") return; // released by the winner
    await wait(4, 8);
    if (!(await alive(call.id))) return;
    if (r.offer >= floor) {
      ask = r.offer; // they take our number
    } else if (r.status === "final_offer") {
      return d.endCall(call.id, "declined", { stage: `Wanted ${money(ask)} — too high for this load` });
    } else {
      ask = Math.max(Math.round((ask + r.offer) / 2 / 25) * 25, Math.round(floor / 25) * 25);
    }
  }
  return d.endCall(call.id, "declined", { stage: "Could not agree on a rate" });
}

async function customerCall(call: Call, d: typeof import("./dispatcher")) {
  const roll = Math.random();
  if (roll < 0.4) {
    const past = (await db().list("loads", { eq: { customer_id: call.customer_id } })).filter((l) => l.status === "delivered");
    const like = past[Math.floor(Math.random() * past.length)];
    const pickup = new Date(Date.now() + (1 + Math.floor(Math.random() * 4)) * 86400000).toISOString().slice(0, 10);
    await d.setStage(call.id, { stage: "They have something moving — taking details" });
    await wait(4, 7);
    if (!(await alive(call.id))) return;
    await d.logCustomerLoad({
      callId: call.id,
      origin: like ? `${like.origin_city}, ${like.origin_state}` : "Dallas, TX",
      destination: like ? `${like.dest_city}, ${like.dest_state}` : "Atlanta, GA",
      pickup_date: pickup,
      equipment: like?.equipment ?? "Dry Van",
      commodity: like?.commodity ?? undefined,
      weight_lbs: like?.weight_lbs ?? undefined,
      rate: like?.customer_rate ?? undefined,
    });
    await wait(3, 5);
    return d.logOutcome({ callId: call.id, outcome: "load_found" });
  }
  await wait(2, 5);
  if (roll < 0.75) return d.logOutcome({ callId: call.id, outcome: "no_loads", notes: "Check back next week" });
  return d.logOutcome({ callId: call.id, outcome: "callback", notes: "Asked for a call tomorrow morning" });
}

/**
 * Practice mode: a few of the people we "emailed" answer through their private link,
 * so you can watch email replies compete with phone calls.
 */
export function simulateEmailReplies(rows: Call[]) {
  for (const row of rows) void emailReply(row).catch((e) => console.error("simulator email", e));
}

async function emailReply(row: Call) {
  const d = await import("./dispatcher");
  const roll = Math.random();
  const stillOpen = async () => {
    const c = await db().get("calls", row.id);
    return c && c.status === "sent" ? c : null;
  };

  if (row.type === "customer") {
    if (roll > 0.6) return; // no reply
    await wait(6, 28);
    if (!(await stillOpen())) return;
    if (roll < 0.3) {
      const past = (await db().list("loads", { eq: { customer_id: row.customer_id } })).filter((l) => l.status === "delivered");
      const like = past[Math.floor(Math.random() * past.length)];
      await d.logCustomerLoad({
        callId: row.id,
        origin: like ? `${like.origin_city}, ${like.origin_state}` : "Dallas, TX",
        destination: like ? `${like.dest_city}, ${like.dest_state}` : "Atlanta, GA",
        pickup_date: new Date(Date.now() + (1 + Math.floor(Math.random() * 4)) * 86400000).toISOString().slice(0, 10),
        equipment: like?.equipment ?? "Dry Van",
        commodity: like?.commodity ?? undefined,
        weight_lbs: like?.weight_lbs ?? undefined,
        rate: like?.customer_rate ?? undefined,
      });
    } else {
      await d.logEmailReply({ callId: row.id, answer: roll < 0.5 ? "none" : "call" });
    }
    return;
  }

  if (roll > 0.3) return; // most carriers don't answer email quickly
  const load = row.load_id ? await db().get("loads", row.load_id) : null;
  if (!load) return;
  const steps = ladder(load);
  const span = Math.max(steps[3] - steps[0], 100);
  let ask = Math.round((steps[0] + span * (0.4 + Math.random() * 1.2)) / 50) * 50;
  for (let round = 0; round < 3; round++) {
    await wait(round === 0 ? 8 : 5, round === 0 ? 40 : 12);
    if (!(await stillOpen())) return;
    const r = await d.submitOffer({ callId: row.id, ask, mcNumber: row.mc_number });
    if (r.status !== "counter" && r.status !== "final_offer") return;
    if (Math.random() < 0.5) ask = r.offer; // accepts our number on the next round
    else return;
  }
}
