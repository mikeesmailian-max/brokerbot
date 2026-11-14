import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/store";
import { cfg } from "@/lib/config";
import { json } from "@/lib/http";
import { endCall } from "@/lib/dispatcher";
import type { CallOutcome, TranscriptTurn } from "@/lib/types";

export const maxDuration = 60;

/** ElevenLabs signs webhooks as `ElevenLabs-Signature: t=<unix>,v0=<hmac sha256 of "t.body">`. */
function verified(raw: string, header: string | null): boolean {
  const secret = cfg().eleven.webhookSecret;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  if (!parts.t || !parts.v0) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 30 * 60) return false;
  const want = createHmac("sha256", secret).update(`${parts.t}.${raw}`).digest("hex");
  const a = Buffer.from(want), b = Buffer.from(parts.v0);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** After every call: save the transcript and summary into history, and free the line. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verified(raw, req.headers.get("elevenlabs-signature"))) return json({ error: "bad signature" }, 401);
  const evt = JSON.parse(raw) as { type?: string; data?: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const data = evt.data ?? {};
  const store = db();

  const convId = data.conversation_id as string | undefined;
  const varId = data.conversation_initiation_client_data?.dynamic_variables?.call_id as string | undefined;
  let call = convId ? (await store.list("calls", { eq: { conversation_id: convId }, limit: 1 }))[0] : undefined;
  if (!call && varId) call = (await store.get("calls", varId)) ?? undefined;
  if (!call) return json({ ok: true, matched: false });

  if (evt.type === "call_initiation_failure") {
    const reason = String(data.failure_reason ?? "unknown");
    const outcome: CallOutcome = reason === "busy" || reason === "no-answer" ? "no_answer" : "failed";
    await endCall(call.id, outcome, call.outcome ? {} : { stage: reason === "busy" ? "Line busy" : reason === "no-answer" ? "No answer" : "Call did not connect" });
    return json({ ok: true });
  }

  if (evt.type === "post_call_transcription") {
    const transcript: TranscriptTurn[] = (data.transcript ?? [])
      .filter((t: { message?: string }) => t.message)
      .map((t: { role: string; message: string; time_in_call_secs?: number }) => ({
        role: t.role === "agent" ? "agent" : "user",
        message: t.message,
        time_in_call_secs: t.time_in_call_secs,
      }));
    const spoke = transcript.some((t) => t.role === "user");
    const reason = String(data.metadata?.termination_reason ?? "").toLowerCase();
    const fallback: CallOutcome = reason.includes("voicemail") ? "voicemail" : !spoke ? "no_answer" : call.type === "capacity" ? "declined" : "no_loads";
    const label: Record<string, string> = { voicemail: "Voicemail", no_answer: "No answer", declined: "Passed on it", no_loads: "Nothing moving right now" };
    await endCall(call.id, fallback, {
      transcript,
      summary: data.analysis?.transcript_summary ?? call.summary,
      duration_secs: data.metadata?.call_duration_secs ?? null,
      ...(call.outcome || call.status === "ended" ? {} : { stage: label[fallback] }),
    });
  }
  return json({ ok: true });
}
