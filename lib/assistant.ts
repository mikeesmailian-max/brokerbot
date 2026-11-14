import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { db } from "./store";
import { cfg } from "./config";
import { rankCarriers, studyCustomer } from "./history";
import { laneOf, money } from "./format";
import { ACTIVE_CALL, type Load } from "./types";

/** Something the assistant wants to do that needs your click before it happens. */
export interface ProposedAction {
  id: string;
  label: string;
  detail: string;
  request: { path: string; method: "POST" | "PATCH"; json: unknown };
}

export interface ChatTurn { role: "user" | "assistant"; content: string }

const openLoads = async () => (await db().list("loads", { in: ["status", ["draft", "open", "searching", "covered"]], order: ["created_at", "desc"], limit: 100 }));
const findLoad = (loads: Load[], ref: string) => {
  const r = ref.trim().toLowerCase();
  return loads.find((l) => l.ref.toLowerCase() === r) ?? loads.find((l) => l.ref.toLowerCase().includes(r) || laneOf(l).toLowerCase().includes(r));
};

async function board() {
  const store = db();
  const [loads, calls] = await Promise.all([openLoads(), store.list("calls", { order: ["created_at", "desc"], limit: 300 })]);
  const today = new Date().toISOString().slice(0, 10);
  const covered = loads.filter((l) => l.status === "covered" && l.covered_at?.slice(0, 10) === today);
  return {
    loads_needing_trucks: loads.filter((l) => l.status !== "covered").map((l) => ({
      ref: l.ref, lane: laneOf(l), status: l.status, customer: l.customer_name, pickup: l.pickup_date, equipment: l.equipment,
      customer_pays: l.customer_rate, start_offer: l.target_rate, max_pay: l.max_rate,
    })),
    covered_today: covered.map((l) => ({ ref: l.ref, lane: laneOf(l), carrier: l.covered_by_name, paid_carrier: l.covered_rate, margin: l.customer_rate != null && l.covered_rate != null ? l.customer_rate - l.covered_rate : null })),
    on_the_phone_now: calls.filter((c) => c.channel === "call" && ACTIVE_CALL.includes(c.status)).map((c) => ({ who: c.company_name, about: c.type, status: c.stage })),
    calls_today: calls.filter((c) => c.channel === "call" && c.status !== "queued" && c.created_at.slice(0, 10) === today).length,
  };
}

async function customersDue(limit: number) {
  const store = db();
  const [customers, loads] = await Promise.all([store.list("customers"), store.list("loads", { limit: 5000 })]);
  return customers
    .filter((c) => !c.do_not_call)
    .map((c) => ({ c, h: studyCustomer(c, loads) }))
    .sort((a, b) => b.h.due_score - a.h.due_score)
    .slice(0, limit)
    .map(({ c, h }) => ({ id: c.id, name: c.name, contact: c.contact_name, has_phone: Boolean(c.phone), chance_of_freight: h.due_score, loads: h.loads, total_paid: h.revenue, days_since_last: h.days_since_last, usual_gap_days: h.avg_gap_days, top_lane: h.top_lanes[0]?.lane ?? null }));
}

const METHOD_TEXT: Record<string, (n: number, who: string, wait: number) => string> = {
  email_first: (n, who, wait) => `Email ${n} ${who}${n === 1 ? "" : "s"} now; phone whoever hasn't answered after ${wait} minutes.`,
  email_only: (n, who) => `Email ${n} ${who}${n === 1 ? "" : "s"} and wait for replies.`,
  call_only: (n, who) => `Call ${n} ${who}${n === 1 ? "" : "s"}.`,
  both: (n, who) => `Email and call ${n} ${who}${n === 1 ? "" : "s"} at the same time.`,
};

const SYSTEM = () => `You are the dispatch assistant inside Freight Command, working for ${cfg().brokerName} at ${cfg().companyName}, a freight brokerage.

How to talk: like a sharp, friendly operations chief. Numbers first, one to three short sentences. Your replies may be read aloud, so write plain spoken sentences — no markdown, no bullet lists, no emoji. Say dollar amounts naturally.

What you can do: look up the live board, customers and their shipping history, carriers, and past calls with the tools. Always check with a tool before stating a fact about loads, calls or money — never guess.

What needs the user's click: you cannot send emails, place calls or change rates yourself. To reach out to carriers or customers, or change a load's rates, use the matching propose tool. Email goes first by default, with phone as the follow-up for anyone who doesn't answer; use a different method only if the user asks for it. It puts a Confirm button in front of the user. Then say in one sentence what will happen when they press it. Never say something has started — only that it is ready to confirm.

If a load has no start offer or max pay, ask for both numbers before proposing a truck search. If the request is unclear (for example which load), ask one short question.`;

/** One chat turn: Claude answers, looking things up and proposing actions as needed. */
export async function chat(history: ChatTurn[]): Promise<{ reply: string; actions: ProposedAction[] }> {
  const actions: ProposedAction[] = [];
  const out = (v: unknown) => JSON.stringify(v);

  const tools = [
    betaZodTool({
      name: "get_board",
      description: "The live picture: loads that need trucks (with rates), loads covered today with margin, who is on the phone right now, and call count today.",
      inputSchema: z.object({}),
      run: async () => out(await board()),
    }),
    betaZodTool({
      name: "get_customers_due",
      description: "Customers ranked by how likely they are to have freight right now, based on their shipping history and rhythm.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(25).optional() }),
      run: async (i) => out(await customersDue(i.limit ?? 8)),
    }),
    betaZodTool({
      name: "get_recent_calls",
      description: "Finished calls and emails, newest first: who, result, what they asked, what was agreed. Optionally filter by company name.",
      inputSchema: z.object({ company: z.string().optional(), limit: z.number().int().min(1).max(40).optional() }),
      run: async (i) => {
        const calls = (await db().list("calls", { order: ["created_at", "desc"], limit: 400 }))
          .filter((c) => c.status === "ended" && c.outcome !== "cancelled" && (!i.company || c.company_name.toLowerCase().includes(i.company.toLowerCase())))
          .slice(0, i.limit ?? 15);
        return out(calls.map((c) => ({ who: c.company_name, type: c.type, by: c.channel, result: c.outcome, they_asked: c.last_ask, agreed: c.agreed_rate, note: c.stage, summary: c.summary, when: c.created_at })));
      },
    }),
    betaZodTool({
      name: "rank_carriers_for_load",
      description: "Best-fit carriers for a load, with the reason each one fits.",
      inputSchema: z.object({ load_ref: z.string().describe("Load reference like L-48213, or part of the lane"), limit: z.number().int().min(1).max(25).optional() }),
      run: async (i) => {
        const load = findLoad(await openLoads(), i.load_ref);
        if (!load) return "No load matches that. Call get_board to see the references.";
        const store = db();
        const ranked = rankCarriers(load, (await store.list("carriers")).filter((c) => !c.do_not_call), await store.list("loads", { in: ["status", ["covered", "delivered"]], limit: 2000 }));
        return out(ranked.slice(0, i.limit ?? 10).map((r) => ({ name: r.carrier.name, home: [r.carrier.home_city, r.carrier.home_state].filter(Boolean).join(", "), why: r.why, has_phone: Boolean(r.carrier.phone) })));
      },
    }),
    betaZodTool({
      name: "propose_truck_search",
      description: "Prepare a truck search for a load: email and/or call the best-fit carriers, first yes wins, everyone else is released. Default is email first, phone as the follow-up. Shows the user a Confirm button — nothing is sent or dialed until they press it.",
      inputSchema: z.object({
        load_ref: z.string(),
        carriers_to_call: z.number().int().min(1).max(100).describe("How many of the best-fit carriers to contact"),
        calls_at_once: z.number().int().min(1).max(20),
        method: z.enum(["email_first", "email_only", "call_only", "both"]).describe("email_first (default): email now, phone only if nobody answers. both: email and phone together."),
        wait_minutes: z.number().int().min(0).max(240).optional().describe("email_first only: how long to give email before phoning. Default 15."),
      }),
      run: async (i) => {
        const load = findLoad(await openLoads(), i.load_ref);
        if (!load) return "No load matches that. Call get_board to see the references.";
        if (load.status === "covered") return "That load is already covered.";
        if (load.status === "searching") return "A search is already running for that load.";
        if (load.target_rate == null || load.max_rate == null) return "This load has no start offer or max pay yet. Ask the user for both numbers, then use propose_rate_change first.";
        const store = db();
        const ranked = rankCarriers(load, (await store.list("carriers")).filter((c) => !c.do_not_call && (c.phone || c.email)), await store.list("loads", { in: ["status", ["covered", "delivered"]], limit: 2000 }));
        const pick = ranked.slice(0, i.carriers_to_call);
        if (!pick.length) return "There are no carriers on file to call. The user needs to import a carrier list first.";
        actions.push({
          id: crypto.randomUUID(),
          label: `Find a truck: ${laneOf(load)}`,
          detail: `${METHOD_TEXT[i.method](pick.length, "carrier", i.wait_minutes ?? 15)} Open at ${money(load.target_rate)}, up to ${money(load.max_rate)}.`,
          request: { path: "/api/campaigns", method: "POST", json: { type: "capacity", loadId: load.id, carrierIds: pick.map((r) => r.carrier.id), concurrency: i.calls_at_once, mode: i.method, waitMinutes: i.wait_minutes ?? 15 } },
        });
        return `Ready for the user to confirm. Top of the list: ${pick.slice(0, 3).map((r) => r.carrier.name).join(", ")}.`;
      },
    }),
    betaZodTool({
      name: "propose_customer_calls",
      description: "Prepare outreach to customers to ask for freight, based on their history: email, phone, or email first with a phone follow-up. Shows the user a Confirm button — nothing is sent or dialed until they press it.",
      inputSchema: z.object({
        customer_names: z.array(z.string()).describe("Exact customer names from get_customers_due"),
        calls_at_once: z.number().int().min(1).max(10),
        method: z.enum(["email_first", "email_only", "call_only", "both"]).describe("email_first (default): email now, phone only those who don't answer."),
        wait_minutes: z.number().int().min(0).max(240).optional(),
      }),
      run: async (i) => {
        const all = await db().list("customers");
        const wanted = i.customer_names.map((n) => n.toLowerCase());
        const pick = all.filter((c) => wanted.includes(c.name.toLowerCase()) && (c.phone || c.email) && !c.do_not_call);
        if (!pick.length) return "None of those customers can be reached (not found, no phone or email, or marked do-not-call).";
        actions.push({
          id: crypto.randomUUID(),
          label: `Ask ${pick.length} customer${pick.length === 1 ? "" : "s"} for freight`,
          detail: `${pick.map((c) => c.name).join(", ")}. ${METHOD_TEXT[i.method](pick.length, "customer", i.wait_minutes ?? 15)}`,
          request: { path: "/api/campaigns", method: "POST", json: { type: "customer", customerIds: pick.map((c) => c.id), concurrency: i.calls_at_once, mode: i.method, waitMinutes: i.wait_minutes ?? 15 } },
        });
        return `Ready for the user to confirm: ${pick.map((c) => c.name).join(", ")}.`;
      },
    }),
    betaZodTool({
      name: "propose_rate_change",
      description: "Prepare a change to a load's opening offer and/or the most we will pay a carrier. Shows the user a Confirm button.",
      inputSchema: z.object({ load_ref: z.string(), start_offer: z.number().positive().optional(), max_pay: z.number().positive().optional() }),
      run: async (i) => {
        const load = findLoad(await openLoads(), i.load_ref);
        if (!load) return "No load matches that. Call get_board to see the references.";
        const low = i.start_offer ?? load.target_rate, high = i.max_pay ?? load.max_rate;
        if (low == null || high == null) return "Both a start offer and a max pay are needed. Ask the user for the missing number.";
        if (high < low) return "The max pay is lower than the start offer. Ask the user to fix that.";
        if (load.customer_rate != null && high > load.customer_rate) return `That max (${money(high)}) is more than the customer pays (${money(load.customer_rate)}). Tell the user and ask if they really want a loss; if so they must set it in the load editor.`;
        actions.push({
          id: crypto.randomUUID(),
          label: `Set rates: ${laneOf(load)}`,
          detail: `Open at ${money(low)}, go up to ${money(high)}${load.customer_rate != null ? ` — you keep at least ${money(load.customer_rate - high)}` : ""}.`,
          request: { path: `/api/loads/${load.id}`, method: "PATCH", json: { target_rate: low, max_rate: high, status: "open" } },
        });
        return "Ready for the user to confirm.";
      },
    }),
  ];

  if (!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) return offline(history, tools, actions);

  const client = new Anthropic();
  const final = await client.beta.messages.toolRunner({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "low" },
    system: SYSTEM(),
    tools,
    messages: history.slice(-24).map((m) => ({ role: m.role, content: m.content })),
  });
  if (final.stop_reason === "refusal") return { reply: "I can't help with that one. Ask me about your loads, carriers, customers or calls.", actions: [] };
  const reply = final.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ").trim();
  return { reply: reply || "Done.", actions };
}

/** No Claude key yet: answer the common questions straight from the board so the assistant still works in practice mode. */
async function offline(history: ChatTurn[], tools: { name: string; run: (input: never) => unknown }[], actions: ProposedAction[]) {
  const q = (history[history.length - 1]?.content ?? "").toLowerCase();
  const b = await board();
  const note = " (Practice brain — add your Claude key and I can hold a real conversation.)";
  if (/(customer|repeat|who should i call|due)/.test(q)) {
    const due = await customersDue(3);
    if (!due.length) return { reply: "No customers on file yet. Drop some rate confirmations on the Customers screen and I'll study them." + note, actions };
    if (/(call|email|reach|start|go|do it)/.test(q)) {
      const tool = tools.find((t) => t.name === "propose_customer_calls")!;
      await tool.run({ customer_names: due.map((d) => d.name), calls_at_once: 3, method: "email_first" } as never);
    }
    return { reply: `Most likely to have freight: ${due.map((d) => `${d.name}, ${d.chance_of_freight} out of 100`).join("; ")}.${actions.length ? " Press Confirm and I'll email them, then call anyone who doesn't answer." : " Say reach out and I'll set it up."}` + note, actions };
  }
  if (/(truck|carrier|cover|find|capacity)/.test(q)) {
    const l = b.loads_needing_trucks.find((x) => x.status === "open" && x.start_offer && x.max_pay);
    if (!l) return { reply: "Nothing is ready for a truck search right now." + note, actions };
    const tool = tools.find((t) => t.name === "propose_truck_search")!;
    await tool.run({ load_ref: l.ref, carriers_to_call: 12, calls_at_once: 5, method: "email_first" } as never);
    return { reply: `${l.lane} is ready. I lined up the twelve best-fit carriers: email first at ${money(l.start_offer)}, then phone anyone who hasn't answered. Press Confirm to start.` + note, actions };
  }
  const margin = b.covered_today.reduce((a, l) => a + (l.margin ?? 0), 0);
  return {
    reply: `${b.loads_needing_trucks.length} load${b.loads_needing_trucks.length === 1 ? "" : "s"} need a truck, ${b.on_the_phone_now.length} call${b.on_the_phone_now.length === 1 ? "" : "s"} live, ${b.covered_today.length} covered today for ${money(margin)} margin.` + note,
    actions,
  };
}
