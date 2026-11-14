import { db } from "@/lib/store";
import { cfg } from "@/lib/config";
import { fail, json } from "@/lib/http";
import { logCustomerLoad, logEmailReply } from "@/lib/dispatcher";
import { isoDate } from "@/lib/repo";

export const dynamic = "force-dynamic";

async function find(token: string) {
  if (!token || token.length < 12) return null;
  const call = (await db().list("calls", { eq: { bid_token: token }, limit: 1 }))[0];
  return call && call.type === "customer" && call.channel === "email" ? call : null;
}

/** What a customer sees from the check-in email link. Shows nothing about anyone else. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const call = await find(token);
  if (!call) return fail("This link is no longer valid.", 404);
  const c = cfg();
  return json({ company: c.companyName, broker: c.brokerName, phone: c.callbackPhone, customer: call.company_name, contact: call.contact_name, answered: call.outcome });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const call = await find(token);
    if (!call) return fail("This link is no longer valid.", 404);
    const b = await req.json();
    const text = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
    if (b.answer === "none" || b.answer === "call") {
      await logEmailReply({ callId: call.id, answer: b.answer, notes: text(b.notes, 500) });
      return json({ ok: true });
    }
    if (!text(b.origin) || !text(b.destination)) return fail("Tell us where it picks up and where it delivers.");
    const num = (v: unknown, max: number) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= max ? Number(v) : undefined);
    await logCustomerLoad({
      callId: call.id,
      origin: text(b.origin),
      destination: text(b.destination),
      pickup_date: isoDate(b.pickup_date) ?? undefined,
      equipment: text(b.equipment, 60),
      commodity: text(b.commodity, 120),
      weight_lbs: num(b.weight_lbs, 200000),
      rate: num(b.rate, 1000000),
      notes: text(b.notes, 500),
    });
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
