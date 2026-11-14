import { db } from "@/lib/store";
import { fail, json } from "@/lib/http";
import { toE164 } from "@/lib/repo";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const b = await req.json();
    const patch: Record<string, unknown> = {};
    if (typeof b.do_not_call === "boolean") patch.do_not_call = b.do_not_call;
    for (const k of ["contact_name", "email", "notes"]) if (typeof b[k] === "string") patch[k] = b[k] || null;
    if (typeof b.phone === "string") {
      const p = toE164(b.phone);
      if (b.phone && !p) return fail("That phone number doesn't look right.");
      patch.phone = p;
    }
    return json({ customer: await db().update("customers", id, patch) });
  } catch (e) {
    return fail(e);
  }
}
