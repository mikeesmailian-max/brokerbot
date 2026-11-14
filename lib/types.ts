export type LoadStatus =
  | "draft" // extracted or captured, waiting for you to confirm
  | "open" // ready, no search running
  | "searching" // calls / emails are out
  | "covered" // a carrier took it
  | "delivered" // history
  | "cancelled";

export type NegotiationStyle = "fast" | "balanced" | "firm";

export interface Load {
  id: string;
  ref: string;
  customer_id: string | null;
  customer_name: string | null;
  origin_city: string | null;
  origin_state: string | null;
  dest_city: string | null;
  dest_state: string | null;
  pickup_date: string | null;
  pickup_time: string | null;
  delivery_date: string | null;
  delivery_time: string | null;
  equipment: string | null;
  commodity: string | null;
  weight_lbs: number | null;
  miles: number | null;
  special_instructions: string | null;
  /** What the customer pays us. */
  customer_rate: number | null;
  /** Opening (lowest) offer to carriers. */
  target_rate: number | null;
  /** The most we will pay a carrier. Never spoken unless we reach it. */
  max_rate: number | null;
  negotiation_style: NegotiationStyle;
  status: LoadStatus;
  source: "upload" | "manual" | "customer_call" | "history";
  covered_by_carrier_id: string | null;
  covered_by_name: string | null;
  covered_rate: number | null;
  covered_via: "call" | "email" | "manual" | null;
  covered_at: string | null;
  created_at: string;
}

export interface Carrier {
  id: string;
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
  do_not_call: boolean;
  loads_hauled: number;
  last_contacted_at: string | null;
  created_at: string;
}

export interface Customer {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  do_not_call: boolean;
  last_contacted_at: string | null;
  created_at: string;
}

export interface Campaign {
  id: string;
  type: "capacity" | "customer";
  load_id: string | null;
  status: "running" | "completed" | "stopped";
  concurrency: number;
  also_email: boolean;
  /** email_first: email now, phone later only if needed. */
  mode: "email_first" | "email_only" | "call_only" | "both";
  /** When the phones start (email_first). Null when calls start right away or never. */
  calls_start_at: string | null;
  calls_started: boolean;
  created_at: string;
  ended_at: string | null;
}

export type CallStatus = "queued" | "dialing" | "ringing" | "in_progress" | "sent" | "ended";

export type CallOutcome =
  | "booked"
  | "declined"
  | "no_answer"
  | "voicemail"
  | "covered_elsewhere"
  | "callback"
  | "load_found"
  | "no_loads"
  | "do_not_call"
  | "failed"
  | "cancelled";

export interface TranscriptTurn {
  role: "agent" | "user";
  message: string;
  time_in_call_secs?: number;
}

/** One outreach attempt: a phone call or an email. */
export interface Call {
  id: string;
  campaign_id: string;
  type: "capacity" | "customer";
  channel: "call" | "email";
  load_id: string | null;
  carrier_id: string | null;
  customer_id: string | null;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  status: CallStatus;
  outcome: CallOutcome | null;
  /** Plain-English live status shown on the dashboard. */
  stage: string | null;
  last_ask: number | null;
  last_offer: number | null;
  rounds: number;
  agreed_rate: number | null;
  mc_number: string | null;
  bid_token: string | null;
  conversation_id: string | null;
  call_sid: string | null;
  transcript: TranscriptTurn[] | null;
  summary: string | null;
  duration_secs: number | null;
  position: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

/** One round of price negotiation — kept forever for rate intelligence. */
export interface Offer {
  id: string;
  call_id: string;
  load_id: string;
  carrier_id: string | null;
  carrier_ask: number;
  our_offer: number | null;
  decision: "accepted" | "counter" | "final" | "covered";
  created_at: string;
}

export interface EventRow {
  id: string;
  type: string;
  level: "info" | "success" | "warn";
  message: string;
  load_id: string | null;
  call_id: string | null;
  campaign_id: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  filename: string;
  purpose: "new_load" | "customer_history";
  load_id: string | null;
  customer_id: string | null;
  extracted: unknown;
  created_at: string;
}

export interface TableMap {
  loads: Load;
  carriers: Carrier;
  customers: Customer;
  campaigns: Campaign;
  calls: Call;
  offers: Offer;
  events: EventRow;
  documents: DocumentRow;
}
export type TableName = keyof TableMap;

export interface CustomerHistory {
  loads: number;
  revenue: number;
  avg_rate: number | null;
  last_ship: string | null;
  days_since_last: number | null;
  avg_gap_days: number | null;
  top_lanes: { lane: string; count: number; avg_rate: number | null }[];
  top_equipment: string | null;
  /** 0–100: how likely they have freight right now, from shipping rhythm. */
  due_score: number;
  summary: string;
}

export const ACTIVE_CALL: CallStatus[] = ["dialing", "ringing", "in_progress"];
