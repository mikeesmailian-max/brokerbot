import { db } from "@/lib/store";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = db();
    const call = await store.get("calls", id);
    if (!call) return fail("Call not found.", 404);
    const offers = await store.list("offers", { eq: { call_id: id }, order: ["created_at", "asc"] });
    return json({ call, offers });
  } catch (e) {
    return fail(e, 500);
  }
}
