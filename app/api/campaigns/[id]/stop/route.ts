import { fail, json } from "@/lib/http";
import { stopCampaign } from "@/lib/dispatcher";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await stopCampaign(id);
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
