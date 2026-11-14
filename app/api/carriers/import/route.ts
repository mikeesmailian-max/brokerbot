import { db } from "@/lib/store";
import { fail, json, readFile } from "@/lib/http";
import { mapRows, readSheet } from "@/lib/import";
import { logEvent, newCarrier } from "@/lib/repo";

/** Upload your carrier list (Excel or CSV). Duplicates are skipped. */
export async function POST(req: Request) {
  try {
    const { file } = await readFile(req);
    const rows = await readSheet(file.name, file.buf);
    if (!rows.length) return fail("That file has no rows.");
    const { mapped, skipped, unmatchedHeaders, badPhones } = mapRows(rows);
    if (!mapped.length) return fail("I couldn't find a company-name column. Add a header like “Carrier Name” and try again.");
    const store = db();
    const existing = await store.list("carriers");
    const seen = new Set<string>();
    for (const c of existing) for (const k of [c.mc_number, c.phone, c.name.toLowerCase()]) if (k) seen.add(k);
    const fresh = [];
    let duplicates = 0;
    for (const m of mapped) {
      const keys = [m.mc_number, m.phone, m.name.toLowerCase()].filter(Boolean) as string[];
      if (keys.some((k) => seen.has(k))) { duplicates++; continue; }
      keys.forEach((k) => seen.add(k));
      fresh.push(newCarrier(m));
    }
    for (let i = 0; i < fresh.length; i += 500) await store.insert("carriers", fresh.slice(i, i + 500));
    const noPhone = fresh.filter((c) => !c.phone).length;
    await logEvent("carriers_imported", `Imported ${fresh.length} carriers from ${file.name}.`);
    return json({ added: fresh.length, duplicates, skipped, badPhones, noPhone, unmatchedHeaders, total: rows.length });
  } catch (e) {
    return fail(e, 422);
  }
}
