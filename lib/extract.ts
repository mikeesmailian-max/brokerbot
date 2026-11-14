import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import ExcelJS from "exceljs";
import { cfg } from "./config";

export const Extracted = z.object({
  document_type: z.enum(["rate_confirmation", "load_tender", "bill_of_lading", "email", "other"]),
  customer_name: z.string().nullable().describe("The company that is paying us for this shipment / issued this document. Never our own company."),
  customer_contact_name: z.string().nullable(),
  customer_phone: z.string().nullable(),
  customer_email: z.string().nullable(),
  reference: z.string().nullable().describe("Load, order, PO or confirmation number"),
  origin_city: z.string().nullable(),
  origin_state: z.string().nullable().describe("2-letter state or province code"),
  dest_city: z.string().nullable(),
  dest_state: z.string().nullable().describe("2-letter state or province code"),
  pickup_date: z.string().nullable().describe("YYYY-MM-DD"),
  pickup_time: z.string().nullable().describe("Time or window, e.g. 08:00 or 08:00-14:00"),
  delivery_date: z.string().nullable().describe("YYYY-MM-DD"),
  delivery_time: z.string().nullable(),
  equipment: z.string().nullable().describe("Dry Van, Reefer, Flatbed, Step Deck, Power Only, etc."),
  commodity: z.string().nullable(),
  weight_lbs: z.number().nullable(),
  miles: z.number().nullable(),
  rate: z.number().nullable().describe("Total all-in amount this document says we are paid, in dollars"),
  special_instructions: z.string().nullable(),
  job_summary: z.string().describe("One plain sentence: what the job was"),
  needs_review: z.string().nullable().describe("Anything unclear, missing or conflicting that a person should check. Null if clean."),
});
export type Extracted = z.infer<typeof Extracted>;

export const extractionIsReal = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

async function toContent(name: string, type: string, buf: Buffer): Promise<Anthropic.ContentBlockParam> {
  const lower = name.toLowerCase();
  if (type === "application/pdf" || lower.endsWith(".pdf"))
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } };
  const img = IMAGE_TYPES.find((t) => t === type);
  if (img) return { type: "image", source: { type: "base64", media_type: img, data: buf.toString("base64") } };
  if (lower.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const lines: string[] = [];
    wb.eachSheet((ws) => {
      lines.push(`# Sheet: ${ws.name}`);
      ws.eachRow((row) => lines.push((row.values as unknown[]).slice(1).map((v) => cellText(v)).join(" | ")));
    });
    return { type: "text", text: lines.join("\n") };
  }
  if (type.startsWith("text/") || /\.(txt|csv|eml|md|html?)$/.test(lower)) return { type: "text", text: buf.toString("utf8") };
  throw new Error(`I can't read ${name}. Use a PDF, a photo/screenshot, a spreadsheet or a text file.`);
}

export const cellText = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text != null) return String(o.text);
    if (o.result != null) return cellText(o.result);
    return "";
  }
  return String(v).trim();
};

/** Read a rate confirmation / load tender / screenshot and pull out the load. */
export async function extractLoad(
  file: { name: string; type: string; buf: Buffer },
  purpose: "new_load" | "customer_history",
): Promise<Extracted & { demo?: boolean }> {
  if (!extractionIsReal()) return { ...DEMO_SAMPLE, reference: "BW-" + Math.floor(10000 + Math.random() * 90000), demo: true };

  const client = new Anthropic();
  const us = cfg().companyName;
  const context =
    purpose === "customer_history"
      ? `This document is a rate confirmation (or similar) that one of our customers sent us for a load we already handled. We are a freight brokerage / carrier called "${us}". Pull out who the customer is and how to reach them (contact name, phone, email), what the job was, and the amount it paid us.`
      : `This document describes a load our customer wants us to move. We are a freight brokerage called "${us}". Pull out the shipment details so we can find a truck for it.`;

  const response = await client.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(Extracted) },
    messages: [
      {
        role: "user",
        content: [
          await toContent(file.name, file.type, file.buf),
          {
            type: "text",
            text: `${context}

Rules:
- The customer is the party paying us or who issued the document — never "${us}" itself, and never the shipper or receiver facility unless they are also the paying party.
- Use only what the document says. If a field is not there, return null — do not guess.
- With multiple stops, use the first pickup as origin and the last delivery as destination, and mention the extra stops in special_instructions.
- Dates as YYYY-MM-DD. States as 2-letter codes. Rate as a plain number of dollars (the total, including fuel if it is listed as part of the total).
- Put anything a person should double-check in needs_review.`,
          },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("The document could not be processed. Try a clearer copy.");
  if (!response.parsed_output) throw new Error("I couldn't read the load details from that document. Try a clearer copy.");
  return response.parsed_output;
}

const DEMO_SAMPLE: Extracted = {
  document_type: "rate_confirmation",
  customer_name: "Brightwell Packaging",
  customer_contact_name: "Dana Whitfield",
  customer_phone: "+19725550141",
  customer_email: "dana@brightwellpackaging.example",
  reference: "BW-" + 77120,
  origin_city: "Dallas",
  origin_state: "TX",
  dest_city: "Memphis",
  dest_state: "TN",
  pickup_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
  pickup_time: "09:00",
  delivery_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
  delivery_time: null,
  equipment: "Dry Van",
  commodity: "Corrugated boxes",
  weight_lbs: 36000,
  miles: 452,
  rate: 1550,
  special_instructions: null,
  job_summary: "One dry van of corrugated boxes from Dallas, TX to Memphis, TN.",
  needs_review: "Demo sample — add ANTHROPIC_API_KEY and I will read your real documents.",
};
