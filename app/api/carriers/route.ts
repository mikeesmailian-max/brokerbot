import { db } from "@/lib/store";
import { fail, json } from "@/lib/http";
import { newCarrier, toE164 } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json({ carriers: await db().list("carriers", { order: ["name", "asc"] }) });
  } catch (e) {
    return fail(e, 500);
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (!b.name?.trim()) return fail("A carrier needs a name.");
    const phone = toE164(b.phone);
    if (b.phone && !phone) return fail("That phone number doesn't look right. Use a 10-digit US number.");
    const carrier = newCarrier({
      name: b.name.trim(),
      mc_number: b.mc_number || null,
      contact_name: b.contact_name || null,
      phone,
      email: b.email || null,
      equipment_types: b.equipment ? String(b.equipment).split(/[,;/]+/).map((s: string) => s.trim()).filter(Boolean) : [],
      home_city: b.home_city || null,
      home_state: b.home_state ? String(b.home_state).toUpperCase() : null,
      preferred_lanes: b.preferred_lanes || null,
    });
    await db().insert("carriers", [carrier]);
    return json({ carrier });
  } catch (e) {
    return fail(e);
  }
}
