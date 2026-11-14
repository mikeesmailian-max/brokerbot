import { coveredAudio } from "@/lib/elevenlabs";

/** Twilio plays this (your voice saying the "found capacity" line) when it cuts in on a call. */
export async function GET() {
  try {
    const audio = await coveredAudio();
    if (!audio) return new Response("voice not configured", { status: 404 });
    return new Response(new Uint8Array(audio), { headers: { "content-type": "audio/mpeg", "cache-control": "public, max-age=86400" } });
  } catch (e) {
    console.error(e);
    return new Response("audio unavailable", { status: 502 });
  }
}
