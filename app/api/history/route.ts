import { db } from "@/lib/store";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Every call and email we have ever made, newest first. */
export async function GET() {
  try {
    const store = db();
    const [calls, loads] = await Promise.all([
      store.list("calls", { order: ["created_at", "desc"], limit: 1000 }),
      store.list("loads", { limit: 5000 }),
    ]);
    const lanes = Object.fromEntries(
      loads.map((l) => [l.id, { ref: l.ref, lane: `${[l.origin_city, l.origin_state].filter(Boolean).join(", ")} → ${[l.dest_city, l.dest_state].filter(Boolean).join(", ")}`, customer_rate: l.customer_rate }]),
    );
    return json({ calls: calls.filter((c) => c.status === "ended").map((c) => ({ ...c, transcript: undefined, has_transcript: Boolean(c.transcript?.length) })), lanes });
  } catch (e) {
    return fail(e, 500);
  }
}
