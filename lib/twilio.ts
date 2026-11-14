import { cfg, COVERED_LINE, twilioReady } from "./config";

async function twilioCall(callSid: string, form?: Record<string, string>) {
  const { sid, token } = cfg().twilio;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${callSid}.json`, {
    method: form ? "POST" : "GET",
    headers: {
      authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${body.message ?? "request failed"}`);
  return body;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Take over a live call the instant the load is covered elsewhere:
 * the person hears the "found capacity" line, then the call hangs up.
 * Calls that are still ringing are simply cancelled.
 */
export async function cutInWithCoveredLine(callSid: string): Promise<"told" | "cancelled" | "already_over" | "skipped"> {
  if (!twilioReady()) return "skipped";
  const current = await twilioCall(callSid);
  if (current.status === "queued" || current.status === "ringing") {
    await twilioCall(callSid, { Status: "canceled" });
    return "cancelled";
  }
  if (current.status !== "in-progress") return "already_over";
  const c = cfg();
  const speak = c.eleven.key && c.eleven.voiceId
    ? `<Play>${xml(c.appUrl + "/api/audio/covered")}</Play>`
    : `<Say>${xml(COVERED_LINE)}</Say>`;
  await twilioCall(callSid, { Twiml: `<Response>${speak}<Hangup/></Response>` });
  return "told";
}
