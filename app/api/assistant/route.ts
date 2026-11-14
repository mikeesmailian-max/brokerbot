import Anthropic from "@anthropic-ai/sdk";
import { chat, type ChatTurn } from "@/lib/assistant";
import { fail, json } from "@/lib/http";

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { messages?: ChatTurn[] };
    const messages = (body.messages ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim());
    if (!messages.length || messages[messages.length - 1].role !== "user") return fail("Say something first.");
    return json(await chat(messages));
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return fail("The Claude API key isn't valid. Check ANTHROPIC_API_KEY.", 502);
    if (e instanceof Anthropic.RateLimitError) return fail("I'm being rate limited. Give me a few seconds and ask again.", 429);
    if (e instanceof Anthropic.APIError) return fail(`The assistant is unavailable right now (${e.status ?? "network"}).`, 502);
    return fail(e, 500);
  }
}
