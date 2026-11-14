import { db } from "@/lib/store";
import { fail, json } from "@/lib/http";
import { studyCustomer } from "@/lib/history";
import { upsertCustomer } from "@/lib/customers";
import { toE164 } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** Customers with their shipping history studied: lanes, rhythm, revenue, and who is due for a call. */
export async function GET() {
  try {
    const store = db();
    const [customers, loads] = await Promise.all([store.list("customers"), store.list("loads", { limit: 5000 })]);
    const withCustomer = loads.filter((l) => l.customer_id);
    const out = customers
      .map((c) => ({
        ...c,
        history: studyCustomer(c, withCustomer),
        recent: withCustomer
          .filter((l) => l.customer_id === c.id && l.status !== "cancelled" && l.status !== "draft")
          .sort((a, b) => (b.pickup_date || b.created_at).localeCompare(a.pickup_date || a.created_at))
          .slice(0, 8),
      }))
      .sort((a, b) => b.history.due_score - a.history.due_score);
    return json({ customers: out });
  } catch (e) {
    return fail(e, 500);
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (!b.name?.trim()) return fail("A customer needs a name.");
    if (b.phone && !toE164(b.phone)) return fail("That phone number doesn't look right. Use a 10-digit US number.");
    const { customer, created } = await upsertCustomer({ name: b.name.trim(), contact_name: b.contact_name, phone: b.phone, email: b.email });
    return json({ customer, created });
  } catch (e) {
    return fail(e);
  }
}
