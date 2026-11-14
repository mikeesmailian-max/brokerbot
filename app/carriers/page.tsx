"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { DropZone, useToast } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { api, useLive } from "@/lib/client";
import { timeAgo } from "@/lib/format";
import type { Carrier } from "@/lib/types";

interface ImportResult { added: number; duplicates: number; skipped: number; badPhones: number; noPhone: number; unmatchedHeaders: string[]; total: number }
const BLANK = { name: "", mc_number: "", contact_name: "", phone: "", email: "", equipment: "", home_city: "", home_state: "" };

export default function Carriers() {
  const { state, offline } = useLive(4000);
  const toast = useToast();
  const [rows, setRows] = useState<Carrier[] | null>(null);
  const [q, setQ] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);

  const load = useCallback(async () => {
    try { setRows((await api<{ carriers: Carrier[] }>("/api/carriers")).carriers); }
    catch (e) { toast.show(e instanceof Error ? e.message : String(e), "bad"); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  const onFile = useCallback(async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      setResult(await api<ImportResult>("/api/carriers/import", { method: "POST", body: fd }));
      await load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), "bad");
    }
  }, [load, toast]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((c) => !s || [c.name, c.mc_number, c.contact_name, c.home_city, c.home_state, c.equipment_types.join(" "), c.preferred_lanes].join(" ").toLowerCase().includes(s));
  }, [rows, q]);

  const dnc = async (c: Carrier) => {
    await api(`/api/carriers/${c.id}`, { method: "PATCH", json: { do_not_call: !c.do_not_call } });
    await load();
  };
  const add = async () => {
    try { await api("/api/carriers", { json: form }); setAdding(false); setForm(BLANK); await load(); }
    catch (e) { toast.show(e instanceof Error ? e.message : String(e), "bad"); }
  };

  return (
    <Shell mode={state?.mode} offline={offline}>
      <div className="toolbar">
        <div className="grow">
          <div className="h1">Carriers</div>
          <div className="muted">Your truck list. When you look for a truck, I rank these by best fit for the load.</div>
        </div>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" onClick={() => setAdding((a) => !a)}><Icon name="plus" size={17} stroke={2.5} />Add carrier</button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <DropZone icon="table" title="Drop your carrier list here" sub="Excel (.xlsx) or CSV. Any column names work — name, MC, contact, phone, email, equipment, city, state, lanes." accept=".xlsx,.csv" onFile={onFile} />
      </div>
      {result && (
        <div className="hint good" style={{ marginBottom: 16 }}>
          <b>Added {result.added} carriers</b> from {result.total} rows.
          {result.duplicates > 0 && <> {result.duplicates} {result.duplicates === 1 ? "was" : "were"} already on your list.</>}
          {result.skipped > 0 && <> {result.skipped} row{result.skipped === 1 ? "" : "s"} had no company name and {result.skipped === 1 ? "was" : "were"} skipped.</>}
          {result.badPhones > 0 && <> {result.badPhones} phone number{result.badPhones === 1 ? "" : "s"} couldn&apos;t be read.</>}
          {result.noPhone > 0 && <> {result.noPhone} have no phone, so they can only be emailed.</>}
          {result.unmatchedHeaders.length > 0 && <> Columns I didn&apos;t use: {result.unmatchedHeaders.join(", ")}.</>}
        </div>
      )}

      {adding && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div className="fields">
            {([["name", "Company", "s4"], ["mc_number", "MC #", "s2"], ["contact_name", "Contact", "s3"], ["phone", "Phone", "s3"], ["email", "Email", "s4"], ["equipment", "Equipment (comma separated)", "s4"], ["home_city", "Home city", "s2"], ["home_state", "State", "s2"]] as const).map(([k, label, cls]) => (
              <div key={k} className={"f " + cls}>
                <label htmlFor={"k-" + k}>{label}</label>
                <input id={"k-" + k} className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn primary" disabled={!form.name.trim()} onClick={add}>Save carrier</button>
          </div>
        </div>
      )}

      <div className="card table-wrap">
        <table className="t">
          <thead><tr><th>Carrier</th><th>Contact</th><th>Phone / email</th><th>Equipment</th><th>Home</th><th>Likes</th><th>Loads with you</th><th>Last contact</th><th>Calling</th></tr></thead>
          <tbody>
            {!rows && <tr><td colSpan={9}><div className="empty"><span className="spinner" /></div></td></tr>}
            {rows && !shown.length && <tr><td colSpan={9}><div className="empty">{rows.length ? "No match." : "No carriers yet. Drop your Excel list above."}</div></td></tr>}
            {shown.map((c) => (
              <tr key={c.id} style={c.do_not_call ? { opacity: 0.5 } : undefined}>
                <td><b>{c.name}</b><div className="tiny muted">{c.mc_number ?? ""}</div></td>
                <td>{c.contact_name ?? "—"}</td>
                <td className="num">{c.phone ?? <span className="chip amber">No phone</span>}<div className="tiny muted">{c.email ?? ""}</div></td>
                <td><div className="row wrap" style={{ gap: 4 }}>{c.equipment_types.map((e) => <span key={e} className="chip">{e}</span>)}</div></td>
                <td>{[c.home_city, c.home_state].filter(Boolean).join(", ") || "—"}</td>
                <td className="small muted">{c.preferred_lanes ?? "—"}</td>
                <td className="num">{c.loads_hauled}</td>
                <td className="small muted">{timeAgo(c.last_contacted_at) || "—"}</td>
                <td><button className={"btn sm" + (c.do_not_call ? " danger" : "")} onClick={() => dnc(c)}>{c.do_not_call ? "Do not call" : "OK to call"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {toast.node}
    </Shell>
  );
}
