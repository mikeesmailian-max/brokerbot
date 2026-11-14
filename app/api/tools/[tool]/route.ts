import { db } from "@/lib/store";
import { json, toolAuthorized } from "@/lib/http";
import { COVERED_LINE, logCustomerLoad, logOutcome, submitOffer } from "@/lib/dispatcher";
import type { CallOutcome } from "@/lib/types";

export const maxDuration = 30;

const OUTCOMES: CallOutcome[] = ["declined", "no_loads", "callback", "voicemail", "no_answer", "do_not_call", "load_found"];

/**
 * The voice agent calls these while it is on the phone.
 * Every answer includes a `say` field telling the agent what to do next.
 */
export async function POST(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  if (!toolAuthorized(req)) return json({ error: "unauthorized" }, 401);
  const { tool } = await params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const callId = String(b.call_id ?? "");
  try {
    const store = db();
    const call = callId ? await store.get("calls", callId) : null;
    if (!call) return json({ status: "error", say: "Something went wrong on my side. Apologise and offer to call back." });
    // Any tool call means a person picked up.
    if (call.status === "ringing" || call.status === "dialing")
      await store.update("calls", call.id, { status: "in_progress", stage: `Talking with ${(call.contact_name || "them").split(" ")[0]}` });

    switch (tool) {
      case "load_status": {
        const load = call.load_id ? await store.get("loads", call.load_id) : null;
        const open = load && (load.status === "open" || load.status === "searching");
        if (!open && call.outcome !== "booked") {
          await store.update("calls", call.id, { outcome: "covered_elsewhere", stage: `Told them: “${COVERED_LINE}”` });
          return json({ status: "covered", say: `Say exactly: "${COVERED_LINE}" Then end the call.` });
        }
        return json({ status: "available", say: "Still available. Keep going." });
      }
      case "submit_offer":
        return json(await submitOffer({ callId, ask: Number(b.carrier_ask), mcNumber: (b.mc_number as string) || null, notes: (b.notes as string) || null }));
      case "customer_load":
        return json(
          await logCustomerLoad({
            callId,
            origin: b.origin as string,
            destination: b.destination as string,
            pickup_date: b.pickup_date as string,
            equipment: b.equipment as string,
            commodity: b.commodity as string,
            weight_lbs: b.weight_lbs ? Number(b.weight_lbs) : undefined,
            rate: b.rate ? Number(b.rate) : undefined,
            notes: b.notes as string,
          }),
        );
      case "log_outcome": {
        const outcome = OUTCOMES.includes(b.outcome as CallOutcome) ? (b.outcome as CallOutcome) : "declined";
        return json(await logOutcome({ callId, outcome, notes: (b.notes as string) || undefined }));
      }
      default:
        return json({ error: "unknown tool" }, 404);
    }
  } catch (e) {
    console.error("tool", tool, e);
    return json({ status: "error", say: "Something went wrong on my side. Apologise and offer to call back." });
  }
}
