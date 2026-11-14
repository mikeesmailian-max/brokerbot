import fs from "fs";
import path from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Call, Load, TableMap, TableName } from "./types";
import { seedDemo } from "./seed";

export interface ListOpts {
  eq?: Record<string, unknown>;
  in?: [string, unknown[]];
  order?: [string, "asc" | "desc"];
  limit?: number;
}

export interface Store {
  mode: "demo" | "live";
  list<T extends TableName>(table: T, opts?: ListOpts): Promise<TableMap[T][]>;
  get<T extends TableName>(table: T, id: string): Promise<TableMap[T] | null>;
  insert<T extends TableName>(table: T, rows: TableMap[T][]): Promise<TableMap[T][]>;
  update<T extends TableName>(table: T, id: string, patch: Partial<TableMap[T]>): Promise<TableMap[T] | null>;
  remove<T extends TableName>(table: T, id: string): Promise<void>;
  /**
   * First come, first served. Atomically marks the load covered — only one
   * caller can ever win. Returns null to everyone who arrives second.
   */
  bookLoad(args: {
    loadId: string;
    carrierId: string | null;
    carrierName: string;
    rate: number;
    via: "call" | "email" | "manual";
  }): Promise<Load | null>;
  /** Atomically move up to n queued calls to "dialing" so two ticks never dial the same number. */
  claimQueued(campaignId: string, n: number): Promise<Call[]>;
}

/* ───────────────────────── Demo (in-memory) ───────────────────────── */

type Mem = { [K in TableName]: TableMap[K][] };

// Until a database is connected, everything is kept in memory and mirrored to a
// local file so your loads, carriers, customers and history survive a restart.
// DATA_DIR lets a host keep the file outside the app folder, so a redeploy never wipes it.
const DATA_FILE = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "store.json");
const EMPTY = (): Mem => ({ loads: [], carriers: [], customers: [], campaigns: [], calls: [], offers: [], events: [], documents: [] });

function loadFromDisk(): Mem | null {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    const mem = { ...EMPTY(), ...(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as Partial<Mem>) };
    // Anything that was mid-call when the app stopped can't be resumed: close it out cleanly.
    const at = new Date().toISOString();
    for (const c of mem.calls) {
      if (c.status === "ended" || c.status === "sent") continue;
      Object.assign(c, { status: "ended", outcome: c.outcome ?? "cancelled", stage: c.outcome ? c.stage : "Stopped — the app restarted", ended_at: at });
    }
    for (const c of mem.campaigns) if (c.status === "running") Object.assign(c, { status: "stopped", ended_at: at });
    for (const l of mem.loads) if (l.status === "searching") l.status = "open";
    return mem;
  } catch (e) {
    console.error("Could not read saved data — starting from sample data.", e);
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveSoon(mem: Mem) {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const tmp = DATA_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(mem));
      fs.renameSync(tmp, DATA_FILE); // swap in one step so a crash never leaves a half-written file
    } catch (e) {
      console.error("Could not save data to disk (it is still held in memory).", e);
    }
  }, 400);
}

function memStore(): Store {
  const g = globalThis as unknown as { __fcMem?: Mem };
  if (!g.__fcMem) {
    const saved = loadFromDisk();
    if (saved) g.__fcMem = saved;
    else {
      g.__fcMem = EMPTY();
      seedDemo(g.__fcMem);
    }
    saveSoon(g.__fcMem);
  }
  const mem = g.__fcMem;
  const match = (row: Record<string, unknown>, opts?: ListOpts) => {
    if (opts?.eq) for (const [k, v] of Object.entries(opts.eq)) if (row[k] !== v) return false;
    if (opts?.in && !opts.in[1].includes(row[opts.in[0]])) return false;
    return true;
  };
  return {
    mode: "demo",
    async list(table, opts) {
      let rows = (mem[table] as unknown as Record<string, unknown>[]).filter((r) => match(r, opts));
      if (opts?.order) {
        const [col, dir] = opts.order;
        rows = [...rows].sort((a, b) => {
          const x = a[col] as string | number, y = b[col] as string | number;
          return (x < y ? -1 : x > y ? 1 : 0) * (dir === "asc" ? 1 : -1);
        });
      }
      if (opts?.limit) rows = rows.slice(0, opts.limit);
      return rows.map((r) => ({ ...r })) as never;
    },
    async get(table, id) {
      const r = (mem[table] as { id: string }[]).find((x) => x.id === id);
      return r ? ({ ...r } as never) : null;
    },
    async insert(table, rows) {
      (mem[table] as unknown[]).push(...rows.map((r) => ({ ...r })));
      saveSoon(mem);
      return rows;
    },
    async update(table, id, patch) {
      const r = (mem[table] as { id: string }[]).find((x) => x.id === id);
      if (!r) return null;
      Object.assign(r, patch);
      saveSoon(mem);
      return { ...r } as never;
    },
    async remove(table, id) {
      const arr = mem[table] as { id: string }[];
      const i = arr.findIndex((x) => x.id === id);
      if (i >= 0) arr.splice(i, 1);
      saveSoon(mem);
    },
    async bookLoad({ loadId, carrierId, carrierName, rate, via }) {
      // Single-threaded JS: this check-and-set cannot interleave.
      const l = mem.loads.find((x) => x.id === loadId);
      if (!l || (l.status !== "open" && l.status !== "searching")) return null;
      Object.assign(l, {
        status: "covered",
        covered_by_carrier_id: carrierId,
        covered_by_name: carrierName,
        covered_rate: rate,
        covered_via: via,
        covered_at: new Date().toISOString(),
      });
      saveSoon(mem);
      return { ...l };
    },
    async claimQueued(campaignId, n) {
      if (n <= 0) return [];
      const picked = mem.calls
        .filter((c) => c.campaign_id === campaignId && c.status === "queued")
        .sort((a, b) => a.position - b.position)
        .slice(0, n);
      for (const c of picked) {
        c.status = "dialing";
        c.started_at = new Date().toISOString();
        c.stage = "Dialing…";
      }
      saveSoon(mem);
      return picked.map((c) => ({ ...c }));
    },
  };
}

/* ───────────────────────── Live (Supabase) ───────────────────────── */

function supaStore(sb: SupabaseClient): Store {
  const ok = <T>(res: { data: T | null; error: { message: string } | null }): T => {
    if (res.error) throw new Error(`Supabase: ${res.error.message}`);
    return res.data as T;
  };
  return {
    mode: "live",
    async list(table, opts) {
      // Supabase returns at most 1,000 rows per request, so page through until we have them all.
      const want = opts?.limit ?? 20000;
      const PAGE = 1000;
      const rows: unknown[] = [];
      for (let from = 0; rows.length < want; from += PAGE) {
        let q = sb.from(table).select("*");
        if (opts?.eq) for (const [k, v] of Object.entries(opts.eq)) q = q.eq(k, v as never);
        if (opts?.in) q = q.in(opts.in[0], opts.in[1] as never[]);
        if (opts?.order) q = q.order(opts.order[0], { ascending: opts.order[1] === "asc" });
        q = q.order("id", { ascending: true }).range(from, from + Math.min(PAGE, want - rows.length) - 1);
        const page = ok(await q) as unknown[];
        rows.push(...page);
        if (page.length < PAGE) break;
      }
      return rows as never;
    },
    async get(table, id) {
      return ok(await sb.from(table).select("*").eq("id", id).maybeSingle()) as never;
    },
    async insert(table, rows) {
      if (!rows.length) return [];
      return ok(await sb.from(table).insert(rows as never).select("*")) as never;
    },
    async update(table, id, patch) {
      return ok(await sb.from(table).update(patch as never).eq("id", id).select("*").maybeSingle()) as never;
    },
    async remove(table, id) {
      ok(await sb.from(table).delete().eq("id", id));
    },
    async bookLoad({ loadId, carrierId, carrierName, rate, via }) {
      const rows = ok(
        await sb.rpc("book_load", {
          p_load_id: loadId,
          p_carrier_id: carrierId,
          p_carrier_name: carrierName,
          p_rate: rate,
          p_via: via,
        }),
      ) as Load[] | null;
      return rows && rows.length ? rows[0] : null;
    },
    async claimQueued(campaignId, n) {
      if (n <= 0) return [];
      return (ok(await sb.rpc("claim_queued_calls", { p_campaign_id: campaignId, p_n: n })) as Call[]) ?? [];
    },
  };
}

export function isLive(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let cached: Store | null = null;
export function db(): Store {
  if (cached) return cached;
  if (isLive()) {
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    cached = supaStore(sb);
  } else {
    cached = memStore();
  }
  return cached;
}
