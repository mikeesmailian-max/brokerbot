import { db } from "@/lib/store";
import { fail, json } from "@/lib/http";
import { rankCarriers } from "@/lib/history";

export const dynamic = "force-dynamic";

/** Carriers ranked best-fit-first for this load. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = db();
    const load = await store.get("loads", id);
    if (!load) return fail("Load not found.", 404);
    const [carriers, past] = await Promise.all([
      store.list("carriers"),
      store.list("loads", { in: ["status", ["covered", "delivered"]], limit: 2000 }),
    ]);
    const ranked = rankCarriers(load, carriers.filter((c) => !c.do_not_call), past);
    return json({ ranked: ranked.map((r) => ({ ...r.carrier, score: r.score, why: r.why })) });
  } catch (e) {
    return fail(e, 500);
  }
}
