import { db } from "@/lib/store";
import { fail, json } from "@/lib/http";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const b = await req.json();
    const patch: Record<string, unknown> = {};
    if (typeof b.do_not_call === "boolean") patch.do_not_call = b.do_not_call;
    if (typeof b.notes === "string") patch.notes = b.notes;
    return json({ carrier: await db().update("carriers", id, patch) });
  } catch (e) {
    return fail(e);
  }
}
