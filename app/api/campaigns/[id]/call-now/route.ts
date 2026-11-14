import { fail, json } from "@/lib/http";
import { startCalls } from "@/lib/dispatcher";

export const maxDuration = 60;

/** Don't wait for email any longer — start the phone follow-up now. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await startCalls(id);
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
