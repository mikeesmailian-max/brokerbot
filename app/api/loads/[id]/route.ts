import { db } from "@/lib/store";
import { fail, json } from "@/lib/http";
import { stopCampaign } from "@/lib/dispatcher";
import { isoDate } from "@/lib/repo";
import type { Load } from "@/lib/types";

const TEXT = ["ref", "customer_name", "origin_city", "origin_state", "dest_city", "dest_state", "pickup_date", "pickup_time", "delivery_date", "delivery_time", "equipment", "commodity", "special_instructions"] as const;
const NUM = ["weight_lbs", "miles", "customer_rate", "target_rate", "max_rate"] as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const load = await db().get("loads", id);
    if (!load) return fail("Load not found.", 404);
    const patch: Partial<Load> = {};
    for (const k of TEXT) if (k in body) (patch as Record<string, unknown>)[k] = body[k] === "" ? null : body[k];
    for (const k of NUM) if (k in body) (patch as Record<string, unknown>)[k] = body[k] === "" || body[k] == null ? null : Number(body[k]);
    for (const k of ["pickup_date", "delivery_date"] as const) if (k in patch) patch[k] = isoDate(patch[k]);
    if (["fast", "balanced", "firm"].includes(body.negotiation_style)) patch.negotiation_style = body.negotiation_style;
    const next = { ...load, ...patch };
    if (next.target_rate != null && next.max_rate != null && next.max_rate < next.target_rate)
      return fail("The most you will pay can't be lower than your starting offer.");
    if (next.customer_rate != null && next.max_rate != null && next.max_rate > next.customer_rate && !body.allow_loss)
      return fail(`Your ceiling ($${next.max_rate}) is more than the customer pays ($${next.customer_rate}). Lower it, or confirm you accept a loss.`);
    // Confirming a draft makes it ready for a search.
    if (body.status === "open" && load.status === "draft") patch.status = "open";
    return json({ load: await db().update("loads", id, patch) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = db();
    const load = await store.get("loads", id);
    if (!load) return fail("Load not found.", 404);
    if (load.status === "covered") return fail("This load is already covered — it stays in your history.");
    for (const c of await store.list("campaigns", { eq: { load_id: id, status: "running" } })) await stopCampaign(c.id);
    await store.update("loads", id, { status: "cancelled" });
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
