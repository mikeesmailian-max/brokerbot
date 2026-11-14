import { cfg, COVERED_LINE } from "./config";

const API = "https://api.elevenlabs.io/v1";

/** Start one outbound phone call through the ElevenLabs agent + your Twilio number. */
export async function outboundCall(args: {
  agentId: string;
  toNumber: string;
  variables: Record<string, string | number>;
}): Promise<{ conversation_id: string | null; call_sid: string | null }> {
  const c = cfg().eleven;
  const res = await fetch(`${API}/convai/twilio/outbound-call`, {
    method: "POST",
    headers: { "xi-api-key": c.key, "content-type": "application/json" },
    body: JSON.stringify({
      agent_id: args.agentId,
      agent_phone_number_id: c.phoneNumberId,
      to_number: args.toNumber,
      conversation_initiation_client_data: { dynamic_variables: args.variables },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    conversation_id?: string | null;
    callSid?: string | null;
    detail?: unknown;
  };
  if (!res.ok || body.success === false) {
    throw new Error(`ElevenLabs outbound call failed (${res.status}): ${body.message || JSON.stringify(body.detail ?? body)}`);
  }
  return { conversation_id: body.conversation_id ?? null, call_sid: body.callSid ?? null };
}

const g = globalThis as unknown as { __fcCoveredAudio?: Buffer };

/** The "found capacity" line, spoken in your own voice. Generated once, then cached. */
export async function coveredAudio(): Promise<Buffer | null> {
  if (g.__fcCoveredAudio) return g.__fcCoveredAudio;
  const c = cfg().eleven;
  if (!c.key || !c.voiceId) return null;
  const res = await fetch(`${API}/text-to-speech/${c.voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": c.key, "content-type": "application/json" },
    body: JSON.stringify({ text: COVERED_LINE, model_id: "eleven_multilingual_v2" }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS failed (${res.status})`);
  g.__fcCoveredAudio = Buffer.from(await res.arrayBuffer());
  return g.__fcCoveredAudio;
}
