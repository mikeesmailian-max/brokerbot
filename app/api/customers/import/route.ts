import { fail, json, readFile } from "@/lib/http";
import { mapRows, readSheet } from "@/lib/import";
import { upsertCustomer } from "@/lib/customers";

/** Upload a customer list (Excel or CSV). */
export async function POST(req: Request) {
  try {
    const { file } = await readFile(req);
    const rows = await readSheet(file.name, file.buf);
    const { mapped, skipped, badPhones } = mapRows(rows);
    if (!mapped.length) return fail("I couldn't find a company-name column. Add a header like “Customer” and try again.");
    let added = 0, duplicates = 0;
    for (const m of mapped) {
      const r = await upsertCustomer(m);
      if (r.created) added++; else duplicates++;
    }
    return json({ added, duplicates, skipped, badPhones, total: rows.length });
  } catch (e) {
    return fail(e, 422);
  }
}
