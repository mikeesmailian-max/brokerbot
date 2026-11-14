import { db } from "@/lib/store";
import { fail, json } from "@/lib/http";
import { laneOf, logEvent, newLoad } from "@/lib/repo";
import { upsertCustomer } from "@/lib/customers";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const num = (v: unknown) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
    const { customer } = await upsertCustomer({ name: body.customer_name || null });
    const text = (k: string) => (typeof body[k] === "string" ? body[k] : undefined);
    const load = newLoad({
      ref: text("ref") || undefined,
      origin_city: text("origin_city"), origin_state: text("origin_state")?.toUpperCase(),
      dest_city: text("dest_city"), dest_state: text("dest_state")?.toUpperCase(),
      pickup_date: text("pickup_date"), pickup_time: text("pickup_time"),
      delivery_date: text("delivery_date"), delivery_time: text("delivery_time"),
      equipment: text("equipment"), commodity: text("commodity"), special_instructions: text("special_instructions"),
      negotiation_style: ["fast", "balanced", "firm"].includes(body.negotiation_style) ? body.negotiation_style : "balanced",
      customer_id: customer?.id ?? null,
      customer_name: customer?.name ?? body.customer_name ?? null,
      weight_lbs: num(body.weight_lbs),
      miles: num(body.miles),
      customer_rate: num(body.customer_rate),
      target_rate: num(body.target_rate),
      max_rate: num(body.max_rate),
      status: "open",
      source: "manual",
    });
    await db().insert("loads", [load]);
    await logEvent("load_created", `New load added: ${laneOf(load)}.`, { load_id: load.id });
    return json({ load });
  } catch (e) {
    return fail(e);
  }
}
