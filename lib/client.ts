"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Call, Campaign, EventRow, Load } from "./types";
import { money } from "./format";

export interface LiveState {
  mode: { data: "demo" | "live"; calls: "real" | "simulated"; email: boolean; extraction: boolean; cutIn: boolean };
  loads: Load[];
  calls: Call[];
  events: EventRow[];
  campaigns: Campaign[];
  kpis: { activeCalls: number; waiting: number; needTruck: number; coveredToday: number; marginToday: number; callsToday: number; reachRate: number | null };
}

/** Thin fetch wrapper: JSON in, JSON out, real error messages. */
export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const opts: RequestInit = { cache: "no-store", ...init };
  if (init?.json !== undefined) {
    opts.method = init.method ?? "POST";
    opts.headers = { "content-type": "application/json", ...(init.headers ?? {}) };
    opts.body = JSON.stringify(init.json);
  }
  const res = await fetch(path, opts);
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/login")) {
    window.location.href = "/login";
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

/** Keeps the command center live: refreshes the whole picture about once a second. */
export function useLive(intervalMs = 1200) {
  const [state, setState] = useState<LiveState | null>(null);
  const [offline, setOffline] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  const pull = useCallback(async () => {
    try {
      const s = await api<LiveState>("/api/state");
      if (!stopped.current) { setState(s); setOffline(false); }
    } catch {
      if (!stopped.current) setOffline(true);
    }
  }, []);

  useEffect(() => {
    stopped.current = false;
    const loop = async () => {
      await pull();
      if (!stopped.current) timer.current = setTimeout(loop, document.hidden ? 6000 : intervalMs);
    };
    loop();
    return () => { stopped.current = true; if (timer.current) clearTimeout(timer.current); };
  }, [pull, intervalMs]);

  return { state, offline, refresh: pull };
}

/** Re-render every second (for call timers). */
export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t); }, [ms]);
}

export const clock = (fromIso: string | null, toIso?: string | null) => {
  if (!fromIso) return "";
  const s = Math.max(0, Math.round(((toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export type Tone = "wait" | "ring" | "talk" | "haggle" | "mail" | "won" | "told" | "off";

/** One visual state per call, shared by the ecosystem map and the lists. */
export function toneOf(c: Call): Tone {
  if (c.outcome === "booked" || c.outcome === "load_found") return "won";
  if (c.outcome === "covered_elsewhere") return "told";
  if (c.status === "ended") return "off";
  if (c.status === "queued") return "wait";
  if (c.status === "sent") return "mail";
  if (c.status === "dialing" || c.status === "ringing") return "ring";
  return c.rounds > 0 ? "haggle" : "talk";
}

export const OUTCOME: Record<string, { label: string; chip: string }> = {
  booked: { label: "Booked", chip: "green" },
  load_found: { label: "Has freight", chip: "green" },
  declined: { label: "Passed", chip: "" },
  no_loads: { label: "Nothing now", chip: "" },
  no_answer: { label: "No answer", chip: "" },
  voicemail: { label: "Voicemail", chip: "" },
  covered_elsewhere: { label: "Released — covered", chip: "blue" },
  callback: { label: "Call back", chip: "amber" },
  do_not_call: { label: "Do not call", chip: "red" },
  failed: { label: "Didn't connect", chip: "red" },
  cancelled: { label: "Not dialed", chip: "" },
};

/** Short status under each bubble on the live map. */
export function nodeLabel(c: Call): string {
  const t = toneOf(c);
  if (t === "won") return c.type === "customer" ? "Has freight!" : `Booked ${money(c.agreed_rate)}`;
  if (t === "told") return "Released";
  if (t === "wait") return c.stage?.startsWith("Will call") ? "Call later if needed" : "In line";
  if (t === "mail") return c.last_offer ? `Countered ${money(c.last_offer)}` : "Emailed";
  if (t === "ring") return "Ringing…";
  if (t === "haggle") return `Wants ${money(c.last_ask)}`;
  if (t === "talk") return "Talking";
  return OUTCOME[c.outcome ?? ""]?.label ?? "Done";
}


/** One bubble per company: if we both called and emailed someone, show the more important of the two. */
export function mergeByCompany(calls: Call[]): { call: Call; emailed: boolean }[] {
  const rank: Record<Tone, number> = { won: 0, haggle: 1, talk: 2, ring: 3, told: 4, off: 5, mail: 6, wait: 7 };
  const groups = new Map<string, Call[]>();
  for (const c of calls) {
    const key = c.carrier_id ?? c.customer_id ?? c.id;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()].map((g) => {
    // A carrier still waiting for a call, or still holding a live email, outranks a finished attempt.
    const live = g.filter((c) => c.status !== "ended");
    const pool = g.some((c) => c.outcome === "booked" || c.outcome === "load_found") ? g : live.length ? live : g;
    const call = [...pool].sort((a, b) => rank[toneOf(a)] - rank[toneOf(b)])[0];
    return { call, emailed: g.some((c) => c.channel === "email") };
  });
}

/** Time left until the phone follow-up starts, as m:ss. */
export const countdown = (iso: string | null) => {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
