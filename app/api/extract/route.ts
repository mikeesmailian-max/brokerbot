import { db } from "@/lib/store";
import { fail, json, readFile } from "@/lib/http";
import { extractLoad } from "@/lib/extract";
import { laneOf, logEvent, money, newLoad, now, uid } from "@/lib/repo";
import { upsertCustomer } from "@/lib/customers";

export const maxDuration = 120;

/**
 * Drop a document, get a load.
 *  purpose=new_load          → a draft load to confirm and find a truck for
 *  purpose=customer_history  → a past job: saves the customer's contact details and adds the load to their history
 */
export async function POST(req: Request) {
  try {
    const { form, file } = await readFile(req);
    const purpose = form.get("purpose") === "customer_history" ? "customer_history" : "new_load";
    const x = await extractLoad(file, purpose);
    const store = db();
    const { customer, created } = await upsertCustomer({
      name: x.customer_name,
      contact_name: x.customer_contact_name,
      phone: x.customer_phone,
      email: x.customer_email,
    });

    if (purpose === "customer_history" && customer && x.reference) {
      const dup = (await store.list("loads", { eq: { customer_id: customer.id, ref: x.reference } }))[0];
      if (dup) return json({ duplicate: true, customer, load: dup, extracted: x, demo: x.demo ?? false });
    }

    const r25 = (n: number) => Math.round(n / 25) * 25;
    const load = newLoad({
      ref: x.reference || undefined,
      customer_id: customer?.id ?? null,
      customer_name: customer?.name ?? x.customer_name,
      origin_city: x.origin_city,
      origin_state: x.origin_state?.toUpperCase() ?? null,
      dest_city: x.dest_city,
      dest_state: x.dest_state?.toUpperCase() ?? null,
      pickup_date: x.pickup_date,
      pickup_time: x.pickup_time,
      delivery_date: x.delivery_date,
      delivery_time: x.delivery_time,
      equipment: x.equipment,
      commodity: x.commodity,
      weight_lbs: x.weight_lbs != null ? Math.round(x.weight_lbs) : null,
      miles: x.miles != null ? Math.round(x.miles) : null,
      special_instructions: x.special_instructions,
      customer_rate: x.rate != null ? Math.round(x.rate) : null,
      // Starting suggestion only — you set the real numbers before any call goes out.
      target_rate: purpose === "new_load" && x.rate ? r25(x.rate * 0.72) : null,
      max_rate: purpose === "new_load" && x.rate ? r25(x.rate * 0.86) : null,
      status: purpose === "new_load" ? "draft" : "delivered",
      source: purpose === "new_load" ? "upload" : "history",
    });
    await store.insert("loads", [load]);
    await store.insert("documents", [
      { id: uid(), filename: file.name, purpose, load_id: load.id, customer_id: customer?.id ?? null, extracted: x, created_at: now() },
    ]);
    await logEvent(
      purpose === "new_load" ? "load_extracted" : "history_added",
      purpose === "new_load"
        ? `Read ${file.name}: ${laneOf(load)}${load.customer_rate ? ", pays " + money(load.customer_rate) : ""}. Check it and set your rates.`
        : `Added to ${customer?.name ?? "customer"} history: ${laneOf(load)}${load.customer_rate ? ", paid " + money(load.customer_rate) : ""}.${created ? " New customer saved." : ""}`,
      { load_id: load.id },
    );
    return json({ load, customer, customerCreated: created, extracted: x, demo: x.demo ?? false });
  } catch (e) {
    return fail(e, 422);
  }
}
