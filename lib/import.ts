import ExcelJS from "exceljs";
import Papa from "papaparse";
import { cellText } from "./extract";
import { toE164 } from "./repo";

type Row = Record<string, string>;

/** Read an .xlsx or .csv into plain rows keyed by header. */
export async function readSheet(name: string, buf: Buffer): Promise<Row[]> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
    const out = Papa.parse<Row>(buf.toString("utf8").replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
    return out.data;
  }
  if (lower.endsWith(".xls")) throw new Error("Old .xls files aren't supported — save it as .xlsx or .csv and drop it again.");
  if (!lower.endsWith(".xlsx")) throw new Error("Use an Excel (.xlsx) or CSV file.");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets.find((w) => w.actualRowCount > 1) ?? wb.worksheets[0];
  if (!ws) return [];
  // The header is the first row that looks like labels (some exports have a title row on top).
  let headerRow = 1;
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
    const vals = (ws.getRow(r).values as unknown[]).slice(1).map(cellText).filter(Boolean);
    if (vals.length >= 2 && vals.some((v) => pick(v) !== null)) { headerRow = r; break; }
  }
  const headers = (ws.getRow(headerRow).values as unknown[]).slice(1).map(cellText);
  const rows: Row[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const vals = (ws.getRow(r).values as unknown[]).slice(1).map(cellText);
    if (!vals.some(Boolean)) continue;
    const row: Row = {};
    headers.forEach((h, i) => { if (h) row[h] = vals[i] ?? ""; });
    rows.push(row);
  }
  return rows;
}

const SYNONYMS: Record<string, string[]> = {
  name: ["name", "company", "company name", "carrier", "carrier name", "legal name", "dba", "customer", "customer name", "account", "business name"],
  mc_number: ["mc", "mc#", "mc #", "mc number", "mc no", "mc num", "docket", "docket number"],
  dot_number: ["dot", "dot#", "dot #", "dot number", "usdot", "usdot#", "usdot #", "usdot number", "us dot"],
  contact_name: ["contact", "contact name", "dispatcher", "dispatch contact", "rep", "owner", "primary contact", "first name", "full name"],
  phone: ["phone", "phone number", "telephone", "tel", "cell", "mobile", "dispatch phone", "contact phone", "phone 1", "main phone"],
  email: ["email", "e mail", "email address", "e mail address", "dispatch email", "contact email", "mail"],
  equipment: ["equipment", "equipment type", "equipment types", "trailer", "trailer type", "truck type", "type"],
  home_city: ["city", "home city", "base city", "domicile city"],
  home_state: ["state", "st", "home state", "base state", "province"],
  preferred_lanes: ["lanes", "preferred lanes", "lane", "preferred lane", "areas", "regions", "service area"],
  notes: ["notes", "note", "comments", "comment", "remarks"],
};
const norm = (h: string) => h.toLowerCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();
function pick(header: string): string | null {
  const h = norm(header);
  for (const [field, names] of Object.entries(SYNONYMS)) if (names.includes(h)) return field;
  return null;
}

export interface MappedRow {
  name: string;
  mc_number: string | null;
  dot_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  equipment_types: string[];
  home_city: string | null;
  home_state: string | null;
  preferred_lanes: string | null;
  notes: string | null;
}

/** Match messy spreadsheet headers to our fields. Returns clean rows plus what could not be used. */
export function mapRows(rows: Row[]): { mapped: MappedRow[]; skipped: number; unmatchedHeaders: string[]; badPhones: number } {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const map = new Map<string, string>();
  const unmatched: string[] = [];
  for (const h of headers) {
    const f = pick(h);
    if (f && ![...map.values()].includes(f)) map.set(h, f);
    else if (h.trim()) unmatched.push(h);
  }
  const mapped: MappedRow[] = [];
  let skipped = 0, badPhones = 0;
  for (const row of rows) {
    const v: Record<string, string> = {};
    for (const [h, f] of map) v[f] = (row[h] ?? "").toString().trim();
    if (!v.name) { skipped++; continue; }
    const phone = toE164(v.phone);
    if (v.phone && !phone) badPhones++;
    mapped.push({
      name: v.name,
      mc_number: v.mc_number ? v.mc_number.replace(/^mc[\s#-]*/i, "MC").toUpperCase() : null,
      dot_number: v.dot_number || null,
      contact_name: v.contact_name || null,
      phone,
      email: v.email && v.email.includes("@") ? v.email.toLowerCase() : null,
      equipment_types: v.equipment ? v.equipment.split(/[,;/|]+/).map((s) => s.trim()).filter(Boolean) : [],
      home_city: v.home_city || null,
      home_state: v.home_state ? v.home_state.toUpperCase() : null,
      preferred_lanes: v.preferred_lanes || null,
      notes: v.notes || null,
    });
  }
  return { mapped, skipped, unmatchedHeaders: unmatched, badPhones };
}
