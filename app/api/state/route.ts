import { db } from "@/lib/store";
import { callsAreReal, emailIsReal, twilioReady } from "@/lib/config";
import { extractionIsReal } from "@/lib/extract";
import { fail, json } from "@/lib/http";
import { ACTIVE_CALL } from "@/lib/types";
import { pump } from "@/lib/dispatcher";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = db();
    await pump(); // start any phone follow-ups whose email wait is over
    const [loads, calls, events, campaigns] = await Promise.all([
      store.list("loads", { in: ["status", ["draft", "open", "searching", "covered"]], order: ["created_at", "desc"], limit: 200 }),
      store.list("calls", { order: ["created_at", "desc"], limit: 400 }),
      store.list("events", { order: ["created_at", "desc"], limit: 60 }),
      store.list("campaigns", { eq: { status: "running" } }),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const coveredToday = loads.filter((l) => l.status === "covered" && l.covered_at?.slice(0, 10) === today);
    const margins = coveredToday.filter((l) => l.customer_rate != null && l.covered_rate != null).map((l) => l.customer_rate! - l.covered_rate!);
    const phoneToday = calls.filter((c) => c.channel === "call" && c.status !== "queued" && c.created_at.slice(0, 10) === today);
    const reached = phoneToday.filter((c) => c.status === "ended" && !["no_answer", "voicemail", "failed", "cancelled"].includes(c.outcome ?? ""));
    const finished = phoneToday.filter((c) => c.status === "ended" && c.outcome !== "cancelled");
    return json({
      mode: {
        data: store.mode,
        calls: callsAreReal("capacity") ? "real" : "simulated",
        email: emailIsReal(),
        extraction: extractionIsReal(),
        cutIn: twilioReady(),
      },
      loads,
      calls,
      events,
      campaigns,
      kpis: {
        activeCalls: calls.filter((c) => c.channel === "call" && ACTIVE_CALL.includes(c.status)).length,
        waiting: calls.filter((c) => c.status === "queued").length,
        needTruck: loads.filter((l) => l.status === "open" || l.status === "searching").length,
        coveredToday: coveredToday.length,
        marginToday: margins.reduce((a, b) => a + b, 0),
        callsToday: phoneToday.length,
        reachRate: finished.length ? Math.round((reached.length / finished.length) * 100) : null,
      },
    });
  } catch (e) {
    return fail(e, 500);
  }
}
