import { db } from "@/lib/store";
import { cfg } from "@/lib/config";
import { fail, json } from "@/lib/http";
import { submitOffer } from "@/lib/dispatcher";

export const dynamic = "force-dynamic";

async function find(token: string) {
  if (!token || token.length < 12) return null;
  const call = (await db().list("calls", { eq: { bid_token: token }, limit: 1 }))[0];
  if (!call?.load_id) return null;
  const load = await db().get("loads", call.load_id);
  return load ? { call, load } : null;
}

/** What a carrier sees from the email link. Never exposes our ceiling or the customer's rate. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const hit = await find(token);
  if (!hit) return fail("This link is no longer valid.", 404);
  const { call, load } = hit;
  const c = cfg();
  return json({
    company: c.companyName,
    broker: c.brokerName,
    carrier: call.company_name,
    mc_number: call.mc_number,
    state: call.outcome === "booked" ? "won" : load.status === "open" || load.status === "searching" ? "open" : "covered",
    agreed_rate: call.outcome === "booked" ? call.agreed_rate : null,
    counter: call.last_offer,
    load: {
      ref: load.ref,
      origin: [load.origin_city, load.origin_state].filter(Boolean).join(", "),
      destination: [load.dest_city, load.dest_state].filter(Boolean).join(", "),
      pickup: [load.pickup_date, load.pickup_time].filter(Boolean).join(" "),
      delivery: [load.delivery_date, load.delivery_time].filter(Boolean).join(" "),
      equipment: load.equipment,
      commodity: load.commodity,
      weight_lbs: load.weight_lbs,
      miles: load.miles,
      offering: load.target_rate,
      notes: load.special_instructions,
    },
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const hit = await find(token);
    if (!hit) return fail("This link is no longer valid.", 404);
    const b = await req.json();
    const rate = Number(b.rate);
    if (!Number.isFinite(rate) || rate < 100 || rate > 100000) return fail("Enter your all-in rate in dollars.");
    if (!String(b.mc_number || hit.call.mc_number || "").trim()) return fail("Enter your MC number.");
    const r = await submitOffer({ callId: hit.call.id, ask: rate, mcNumber: b.mc_number || null, notes: b.notes || null });
    if (r.status === "booked") return json({ state: "won", agreed_rate: r.rate });
    if (r.status === "covered") return json({ state: "covered" });
    if (r.status === "counter" || r.status === "final_offer") return json({ state: "open", counter: r.offer, final: r.status === "final_offer" });
    return fail("Something went wrong. Please call us.");
  } catch (e) {
    return fail(e);
  }
}
