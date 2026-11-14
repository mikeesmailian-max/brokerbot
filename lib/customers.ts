import { db } from "./store";
import { newCustomer, toE164 } from "./repo";
import type { Customer } from "./types";

const key = (s: string | null | undefined) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(inc|llc|co|corp|company|ltd)$/, "");

/** Find the customer by name, email or phone — or create them. Fills in any contact details we were missing. */
export async function upsertCustomer(info: {
  name: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
}): Promise<{ customer: Customer | null; created: boolean }> {
  const store = db();
  const phone = toE164(info.phone);
  const email = info.email?.includes("@") ? info.email.toLowerCase().trim() : null;
  if (!info.name && !email && !phone) return { customer: null, created: false };
  const all = await store.list("customers");
  const found = all.find(
    (c) => (info.name && key(c.name) === key(info.name)) || (email && c.email === email) || (phone && c.phone === phone),
  );
  if (found) {
    const patch: Partial<Customer> = {};
    if (!found.contact_name && info.contact_name) patch.contact_name = info.contact_name;
    if (!found.phone && phone) patch.phone = phone;
    if (!found.email && email) patch.email = email;
    const updated = Object.keys(patch).length ? await store.update("customers", found.id, patch) : found;
    return { customer: updated ?? found, created: false };
  }
  const customer = newCustomer({ name: info.name || email || phone || "Unknown customer", contact_name: info.contact_name ?? null, phone, email });
  await store.insert("customers", [customer]);
  return { customer, created: true };
}
