import { randomUUID, randomBytes } from "crypto";
import { db } from "./store";
import type { Call, Campaign, Carrier, Customer, EventRow, Load } from "./types";

export const now = () => new Date().toISOString();
export const uid = () => randomUUID();

export function newLoad(p: Partial<Load>): Load {
  return {
    id: uid(),
    ref: p.ref || "L-" + Math.floor(10000 + Math.random() * 90000),
    customer_id: null,
    customer_name: null,
    origin_city: null,
    origin_state: null,
    dest_city: null,
    dest_state: null,
    pickup_date: null,
    pickup_time: null,
    delivery_date: null,
    delivery_time: null,
    equipment: null,
    commodity: null,
    weight_lbs: null,
    miles: null,
    special_instructions: null,
    customer_rate: null,
    target_rate: null,
    max_rate: null,
    negotiation_style: "balanced",
    status: "draft",
    source: "manual",
    covered_by_carrier_id: null,
    covered_by_name: null,
    covered_rate: null,
    covered_via: null,
    covered_at: null,
    created_at: now(),
    ...clean(p),
  };
}

export function newCarrier(p: Partial<Carrier>): Carrier {
  return {
    id: uid(),
    name: "Unknown carrier",
    mc_number: null,
    dot_number: null,
    contact_name: null,
    phone: null,
    email: null,
    equipment_types: [],
    home_city: null,
    home_state: null,
    preferred_lanes: null,
    notes: null,
    do_not_call: false,
    loads_hauled: 0,
    last_contacted_at: null,
    created_at: now(),
    ...clean(p),
  };
}

export function newCustomer(p: Partial<Customer>): Customer {
  return {
    id: uid(),
    name: "Unknown customer",
    contact_name: null,
    phone: null,
    email: null,
    notes: null,
    do_not_call: false,
    last_contacted_at: null,
    created_at: now(),
    ...clean(p),
  };
}

export function newCampaign(p: Partial<Campaign>): Campaign {
  return {
    id: uid(),
    type: "capacity",
    load_id: null,
    status: "running",
    concurrency: 5,
    also_email: false,
    mode: "call_only",
    calls_start_at: null,
    calls_started: true,
    created_at: now(),
    ended_at: null,
    ...clean(p),
  };
}

export function newCall(p: Partial<Call>): Call {
  return {
    id: uid(),
    campaign_id: "",
    type: "capacity",
    channel: "call",
    load_id: null,
    carrier_id: null,
    customer_id: null,
    company_name: "",
    contact_name: null,
    phone: null,
    email: null,
    status: "queued",
    outcome: null,
    stage: "Waiting in line",
    last_ask: null,
    last_offer: null,
    rounds: 0,
    agreed_rate: null,
    mc_number: null,
    bid_token: null,
    conversation_id: null,
    call_sid: null,
    transcript: null,
    summary: null,
    duration_secs: null,
    position: 0,
    started_at: null,
    ended_at: null,
    created_at: now(),
    ...clean(p),
  };
}

export const newToken = () => randomBytes(18).toString("base64url");

const DATE_FIELDS = new Set(["pickup_date", "delivery_date"]);
/** Dates must be real YYYY-MM-DD values or nothing — documents and people both produce odd ones. */
export function isoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3]) ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

/** Drop undefined so spreads never erase defaults; blank strings become null; dates are validated. */
function clean<T extends object>(p: T): T {
  return Object.fromEntries(
    Object.entries(p)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, DATE_FIELDS.has(k) ? isoDate(v) : typeof v === "string" && !v.trim() ? null : v]),
  ) as T;
}

export async function logEvent(
  type: string,
  message: string,
  refs: { load_id?: string | null; call_id?: string | null; campaign_id?: string | null } = {},
  level: EventRow["level"] = "info",
) {
  try {
    await db().insert("events", [
      {
        id: uid(),
        type,
        level,
        message,
        load_id: refs.load_id ?? null,
        call_id: refs.call_id ?? null,
        campaign_id: refs.campaign_id ?? null,
        created_at: now(),
      },
    ]);
  } catch (e) {
    console.error("event log failed", e);
  }
}

export { place, laneOf, money } from "./format";

/** Normalise a US phone number to E.164. Returns null when it can't be dialled. */
export function toE164(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const ext = s.search(/(ext|x)\.?\s*\d+$/i);
  const digits = (ext > 0 ? s.slice(0, ext) : s).replace(/\D/g, "");
  if (s.startsWith("+") && digits.length >= 8) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}
