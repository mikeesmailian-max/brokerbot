"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { Modal, useToast } from "@/components/ui";
import { api, clock, OUTCOME, useLive } from "@/lib/client";
import { money } from "@/lib/format";
import type { Call, Offer } from "@/lib/types";

type Row = Call & { has_transcript: boolean };
type Lanes = Record<string, { ref: string; lane: string; customer_rate: number | null }>;
const FILTERS: [string, string, (c: Row) => boolean][] = [
  ["all", "Everything", () => true],
  ["won", "Wins", (c) => c.outcome === "booked" || c.outcome === "load_found"],
  ["talked", "Talked", (c) => ["declined", "no_loads", "callback", "covered_elsewhere", "booked", "load_found"].includes(c.outcome ?? "")],
  ["missed", "No answer", (c) => ["no_answer", "voicemail", "failed"].includes(c.outcome ?? "")],
  ["carriers", "Carriers", (c) => c.type === "capacity"],
  ["customers", "Customers", (c) => c.type === "customer"],
];

export default function History() {
  const { state, offline } = useLive(4000);
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [lanes, setLanes] = useState<Lanes>({});
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<{ call: Call; offers: Offer[] } | null>(null);

  const load = useCallback(async () => {
    try { const r = await api<{ calls: Row[]; lanes: Lanes }>("/api/history"); setRows(r.calls); setLanes(r.lanes); }
    catch (e) { toast.show(e instanceof Error ? e.message : String(e), "bad"); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x[0] === filter)![2];
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((c) => c.outcome !== "cancelled" && f(c) && (!s || [c.company_name, c.contact_name, lanes[c.load_id ?? ""]?.lane, c.stage].join(" ").toLowerCase().includes(s)));
  }, [rows, filter, q, lanes]);

  const openCall = async (id: string) => {
    try { setDetail(await api<{ call: Call; offers: Offer[] }>(`/api/calls/${id}`)); }
    catch (e) { toast.show(e instanceof Error ? e.message : String(e), "bad"); }
  };

  return (
    <Shell mode={state?.mode} offline={offline}>
      <div className="toolbar">
        <div className="grow">
          <div className="h1">History</div>
          <div className="muted">Every call and email, what was said, and every price that was offered.</div>
        </div>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search company, lane…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" onClick={load}>Refresh</button>
      </div>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        {FILTERS.map(([id, label]) => (
          <button key={id} className={"btn sm" + (filter === id ? " primary" : "")} onClick={() => setFilter(id)}>{label}</button>
        ))}
        <span className="grow" /><span className="muted small">{shown.length} shown</span>
      </div>

      <div className="card table-wrap">
        <table className="t">
          <thead><tr><th>When</th><th>Who</th><th>About</th><th>Result</th><th>Their ask</th><th>Agreed</th><th>Length</th><th>How it went</th></tr></thead>
          <tbody>
            {!rows && <tr><td colSpan={8}><div className="empty"><span className="spinner" /></div></td></tr>}
            {rows && !shown.length && <tr><td colSpan={8}><div className="empty">Nothing here yet. Calls show up as soon as they finish.</div></td></tr>}
            {shown.map((c) => {
              const o = OUTCOME[c.outcome ?? ""];
              const l = lanes[c.load_id ?? ""];
              return (
                <tr key={c.id} className="click" onClick={() => openCall(c.id)}>
                  <td className="small muted num" style={{ whiteSpace: "nowrap" }}>{new Date(c.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  <td><b>{c.company_name}</b><div className="tiny muted">{c.contact_name ?? ""}{c.channel === "email" ? " · email" : ""}</div></td>
                  <td>{c.type === "customer" ? <span className="chip teal">Asked for freight</span> : l ? <>{l.lane}<div className="tiny muted">{l.ref}</div></> : "—"}</td>
                  <td><span className={"chip " + (o?.chip ?? "")}>{o?.label ?? c.outcome ?? "—"}</span></td>
                  <td className="num">{money(c.last_ask)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{money(c.agreed_rate)}</td>
                  <td className="num small muted">{c.channel === "call" && c.duration_secs != null ? `${Math.floor(c.duration_secs / 60)}:${String(c.duration_secs % 60).padStart(2, "0")}` : "—"}</td>
                  <td className="small muted">{c.stage ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detail && (
        <Modal title={<>{detail.call.company_name} <span className={"chip " + (OUTCOME[detail.call.outcome ?? ""]?.chip ?? "")} style={{ marginLeft: 8 }}>{OUTCOME[detail.call.outcome ?? ""]?.label ?? "—"}</span></>} onClose={() => setDetail(null)}>
          <div className="small muted">
            {[detail.call.contact_name, detail.call.phone ?? detail.call.email, lanes[detail.call.load_id ?? ""]?.lane, detail.call.channel === "call" ? clock(detail.call.started_at, detail.call.ended_at) + " on the line" : "by email"].filter(Boolean).join(" · ")}
          </div>
          {detail.call.summary && <div className="hint" style={{ marginTop: 12 }}><b>Summary:</b> {detail.call.summary}</div>}
          {detail.call.stage && <div className="hint" style={{ marginTop: 8 }}>{detail.call.stage}</div>}
          {detail.offers.length > 0 && (
            <>
              <div className="section-label">The negotiation</div>
              <table className="t">
                <thead><tr><th>Round</th><th>They asked</th><th>We said</th><th>Result</th></tr></thead>
                <tbody>
                  {detail.offers.map((o, i) => (
                    <tr key={o.id}><td>{i + 1}</td><td className="num">{money(o.carrier_ask)}</td><td className="num">{money(o.our_offer)}</td>
                      <td>{{ accepted: "Deal", counter: "We countered", final: "Our best and final", covered: "Too late — already covered" }[o.decision]}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div className="section-label">What was said</div>
          {detail.call.transcript?.length ? (
            detail.call.transcript.map((t, i) => (
              <div key={i} className={"turn " + t.role}><div className="bubble"><div className="tiny muted">{t.role === "agent" ? "You (bot)" : detail.call.contact_name ?? "Them"}</div>{t.message}</div></div>
            ))
          ) : (
            <div className="muted small">{state?.mode.calls === "simulated" ? "Practice calls have no transcript. Real calls save the full conversation here." : "No transcript for this one."}</div>
          )}
        </Modal>
      )}
      {toast.node}
    </Shell>
  );
}
