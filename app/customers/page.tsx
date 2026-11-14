"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { DropZone, Modal, useToast } from "@/components/ui";
import { MethodPicker, type Mode } from "@/components/MethodPicker";
import { Icon } from "@/components/Icon";
import { Ecosystem, type EcoNode } from "@/components/Ecosystem";
import { api, countdown, mergeByCompany, nodeLabel, OUTCOME, toneOf, useLive, useTick } from "@/lib/client";
import { laneOf, money, shortDate } from "@/lib/format";
import type { Customer, CustomerHistory, Load } from "@/lib/types";

type Row = Customer & { history: CustomerHistory; recent: Load[] };

const dueText = (h: CustomerHistory) =>
  !h.loads ? "New — no history yet"
  : h.due_score >= 75 ? "Due now — call today"
  : h.due_score >= 50 ? "Probably has freight soon"
  : "Shipped recently";

export default function Customers() {
  const { state, offline, refresh: refreshLive } = useLive();
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [lines, setLines] = useState(3);
  const [how, setHow] = useState<Mode>("email_first");
  const [wait, setWait] = useState(15);
  const [sheet, setSheet] = useState(false);
  useTick();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", contact_name: "", phone: "", email: "" });

  const load = useCallback(async () => {
    try { setRows((await api<{ customers: Row[] }>("/api/customers")).customers); }
    catch (e) { toast.show(e instanceof Error ? e.message : String(e), "bad"); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  // Latest customer-call campaign drives the live map.
  const custCalls = useMemo(() => {
    const all = (state?.calls ?? []).filter((c) => c.type === "customer");
    return all.filter((c) => c.campaign_id === all[0]?.campaign_id).sort((a, b) => a.position - b.position);
  }, [state]);
  const running = state?.campaigns.find((c) => c.type === "customer") ?? null;
  const nodes: EcoNode[] = mergeByCompany(custCalls).map(({ call: c, emailed }) => ({ id: c.id, name: c.company_name, tone: toneOf(c), label: nodeLabel(c), emailed }));
  const found = new Set(custCalls.filter((c) => c.outcome === "load_found").map((c) => c.customer_id)).size;
  const waiting = Boolean(running && !running.calls_started && running.calls_start_at);
  const emailsOut = custCalls.filter((c) => c.channel === "email" && c.status === "sent").length;
  const drafts = (state?.loads ?? []).filter((l) => l.status === "draft" && l.source === "customer_call");

  // Refresh history when a campaign wraps up.
  const runningId = running?.id;
  useEffect(() => { if (!runningId) void load(); }, [runningId, load]);

  const onRateCon = useCallback(async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("purpose", "customer_history");
    try {
      const r = await api<{ duplicate?: boolean; customer: Customer | null; customerCreated?: boolean; load: Load; demo: boolean }>("/api/extract", { method: "POST", body: fd });
      if (r.duplicate) toast.show(`${file.name}: already in ${r.customer?.name ?? "their"} history — skipped.`);
      else toast.show(`${r.customer?.name ?? "Customer"}${r.customerCreated ? " (new)" : ""}: ${laneOf(r.load)} · paid ${money(r.load.customer_rate)}${r.demo ? " — demo sample" : ""}`, "good");
      await load();
    } catch (e) {
      toast.show(`${file.name}: ${e instanceof Error ? e.message : String(e)}`, "bad");
    }
  }, [load, toast]);

  const onList = useCallback(async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await api<{ added: number; duplicates: number; badPhones: number }>("/api/customers/import", { method: "POST", body: fd });
      toast.show(`Added ${r.added} customers${r.duplicates ? `, ${r.duplicates} already on file` : ""}${r.badPhones ? `, ${r.badPhones} phone numbers I couldn't read` : ""}.`, "good");
      await load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), "bad");
    }
  }, [load, toast]);

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chosen = (rows ?? []).filter((r) => picked.has(r.id) && (r.phone || r.email) && !r.do_not_call);
  const emails = how === "call_only" ? 0 : chosen.filter((r) => r.email).length;
  const calls = how === "email_only" ? 0 : chosen.filter((r) => r.phone).length;
  const pickDue = () => setPicked(new Set((rows ?? []).filter((r) => (r.phone || r.email) && !r.do_not_call && r.history.due_score >= 50).map((r) => r.id)));

  const start = async () => {
    setBusy(true);
    try {
      await api("/api/campaigns", { json: { type: "customer", customerIds: chosen.map((r) => r.id), concurrency: lines, mode: how, waitMinutes: wait } });
      setSheet(false);
      setPicked(new Set());
      await refreshLive();
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast.show(how === "call_only" ? "Calling your customers. Watch the map." : "Emails are going out to your customers.", "good");
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), "bad");
    } finally { setBusy(false); }
  };

  const addCustomer = async () => {
    try {
      await api("/api/customers", { json: form });
      setAdding(false); setForm({ name: "", contact_name: "", phone: "", email: "" });
      await load();
    } catch (e) { toast.show(e instanceof Error ? e.message : String(e), "bad"); }
  };

  return (
    <Shell mode={state?.mode} offline={offline}>
      <div className="toolbar">
        <div className="grow">
          <div className="h1">Customers</div>
          <div className="muted">I study every past job, work out who&apos;s due to ship again, and call them for repeat work.</div>
        </div>
        <button className="btn" onClick={() => setAdding((a) => !a)}><Icon name="plus" size={17} stroke={2.5} />Add customer</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: 16 }}>
        <DropZone icon="receipt" title="Drop customer rate confirmations" sub="As many as you like. I save the contact's name, email and phone, what the job was and what it paid." accept=".pdf,image/*,.txt,.eml" multiple onFile={onRateCon} />
        <DropZone icon="users" title="Or import a customer list" sub="Excel or CSV with company, contact, phone, email" accept=".xlsx,.csv" onFile={onList} />
      </div>

      {adding && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div className="fields">
            {(["name", "contact_name", "phone", "email"] as const).map((k) => (
              <div key={k} className="f s3">
                <label htmlFor={"c-" + k}>{{ name: "Company", contact_name: "Contact", phone: "Phone", email: "Email" }[k]}</label>
                <input id={"c-" + k} className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn primary" disabled={!form.name.trim()} onClick={addCustomer}>Save customer</button>
          </div>
        </div>
      )}

      {custCalls.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <span className="card-title">{waiting ? "Emails are out" : running ? "Reaching out to customers now" : "Last round of customer outreach"}</span>
            <div className="row">
              <span className="chip green">{found} with freight</span>
              {running && <button className="btn sm danger" onClick={async () => { await api(`/api/campaigns/${running.id}/stop`, { method: "POST" }); await refreshLive(); }}><Icon name="stop" size={14} />Stop</button>}
            </div>
          </div>
          {waiting && running && (
            <div className="banner-wait" style={{ margin: "14px 18px 0" }}>
              <div className="grow"><b>{emailsOut} email{emailsOut === 1 ? " is" : "s are"} waiting for an answer.</b> Anyone who hasn&apos;t replied gets a call in <span className="count">{countdown(running.calls_start_at)}</span>.</div>
              <button className="btn sm primary" onClick={async () => { await api(`/api/campaigns/${running.id}/call-now`, { method: "POST" }); await refreshLive(); }}><Icon name="phone" size={14} />Call now</button>
            </div>
          )}
          <Ecosystem compact hub={{ line1: "You", sub: waiting ? "WAITING ON EMAIL" : running ? "CALLING…" : "DONE", done: !running && found > 0, busy: Boolean(running) }} nodes={nodes} idle="" />
          {drafts.length > 0 && (
            <div className="banner-win" style={{ margin: "0 16px 16px" }}>
              <span className="badge-ico"><Icon name="box" size={18} /></span>
              <div className="grow">{drafts.length} new load{drafts.length === 1 ? "" : "s"} captured from these calls — waiting for you on the <a className="link" href="/">Command Center</a>.</div>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-head" style={{ paddingBottom: 12 }}>
          <span className="card-title">Who to call — most likely to have freight first</span>
          <button className="btn sm" onClick={pickDue}>Pick everyone who&apos;s due</button>
        </div>
        {!rows && <div className="empty"><span className="spinner" /></div>}
        {rows && !rows.length && <div className="empty">No customers yet. Drop a few rate confirmations above and I&apos;ll build this for you.</div>}
        {rows?.map((r) => {
          const h = r.history;
          const lastCall = (state?.calls ?? []).find((c) => c.customer_id === r.id && c.status === "ended");
          return (
            <div key={r.id} className="cust" style={r.do_not_call ? { opacity: 0.55 } : undefined}>
              <input type="checkbox" style={{ marginTop: 3 }} aria-label={`Select ${r.name}`}
                checked={picked.has(r.id)} disabled={(!r.phone && !r.email) || r.do_not_call} onChange={() => toggle(r.id)} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 17 }}>{r.name}</div>
                <div className="small muted">{[r.contact_name, r.phone, r.email].filter(Boolean).join(" · ") || "No contact details yet"}</div>
                <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
                  {!r.phone && <span className="chip amber">No phone{r.email ? " — email only" : ""}</span>}
                  {!r.email && r.phone && <span className="chip amber">No email — phone only</span>}
                  {r.do_not_call && <span className="chip red">Do not call</span>}
                  {lastCall && <span className={"chip " + (OUTCOME[lastCall.outcome ?? ""]?.chip ?? "")}>Last call: {OUTCOME[lastCall.outcome ?? ""]?.label ?? "done"}</span>}
                </div>
              </div>
              <div>
                <div className="stat-row">
                  <div className="stat"><b className="num">{h.loads}</b><span>loads</span></div>
                  <div className="stat"><b className="num">{money(h.revenue)}</b><span>total paid</span></div>
                  <div className="stat"><b className="num">{money(h.avg_rate)}</b><span>avg per load</span></div>
                  <div className="stat"><b className="num">{h.days_since_last != null ? h.days_since_last + "d" : "—"}</b><span>since last load</span></div>
                  <div className="stat"><b className="num">{h.avg_gap_days ? "every " + h.avg_gap_days + "d" : "—"}</b><span>usual rhythm</span></div>
                </div>
                <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
                  {h.top_lanes.map((l) => <span key={l.lane} className="chip">{l.lane.replace(" to ", " → ")} · {l.count}×{l.avg_rate ? " · " + money(l.avg_rate) : ""}</span>)}
                </div>
                {h.loads > 0 && <button className="link small" style={{ marginTop: 8 }} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "Hide" : "Show"} past jobs &amp; what the bot will say</button>}
                {open === r.id && (
                  <div style={{ marginTop: 10 }}>
                    <div className="hint small" style={{ marginBottom: 8 }}><b>What the bot knows going in:</b> {h.summary}</div>
                    <table className="t">
                      <thead><tr><th>Picked up</th><th>Job</th><th>Equipment</th><th>Paid</th></tr></thead>
                      <tbody>
                        {r.recent.map((l) => (
                          <tr key={l.id}><td>{shortDate(l.pickup_date)}</td><td>{laneOf(l)}{l.commodity ? ` · ${l.commodity}` : ""}</td><td>{l.equipment ?? "—"}</td><td className="num">{money(l.customer_rate)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div>
                <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>{dueText(h)}</div>
                <div className="meter" title={`Score ${h.due_score}/100`}><i style={{ width: `${h.due_score}%` }} /></div>
                <div className="tiny muted" style={{ marginTop: 4 }}>{h.loads ? `Chance they have freight: ${h.due_score}/100` : "Introduce yourself"}</div>
              </div>
            </div>
          );
        })}
      </div>

      {picked.size > 0 && (
        <div className="card sticky-bar">
          <b>{chosen.length} customer{chosen.length === 1 ? "" : "s"} picked</b>
          <span className="grow" />
          <button className="btn" onClick={() => setPicked(new Set())}>Clear</button>
          <button className="btn go big" disabled={!chosen.length || Boolean(running)} onClick={() => setSheet(true)}>
            {running ? "Outreach already running" : `Ask ${chosen.length} for loads`}
          </button>
        </div>
      )}

      {sheet && (
        <Modal
          wide
          title={<>Ask {chosen.length} customer{chosen.length === 1 ? "" : "s"} for freight</>}
          onClose={() => setSheet(false)}
          foot={
            <>
              <button className="btn" onClick={() => setSheet(false)}>Cancel</button>
              <button className="btn go big" disabled={busy || (!emails && !calls)} onClick={start}>
                {busy ? "Starting…" : how === "email_first" ? `Email ${emails} now${calls ? ", call later if needed" : ""}` : how === "email_only" ? `Email ${emails}` : how === "call_only" ? `Call ${calls}` : `Email ${emails} and call ${calls}`}
              </button>
            </>
          }
        >
          <div className="hint" style={{ marginBottom: 14 }}>
            Each customer gets a short, personal check-in built from their history (their usual lane), with one-tap answers: <b>send a load</b>, <b>nothing right now</b>, or <b>call me</b>. Loads they send land on your Command Center as drafts.
          </div>
          {state?.mode.calls === "simulated" && <div className="hint warn" style={{ marginBottom: 14 }}><b>Practice mode:</b> no emails go out and no phones ring. You&apos;ll see a realistic simulation.</div>}
          <div className="section-label" style={{ marginTop: 4 }}>How to reach them</div>
          <MethodPicker mode={how} setMode={setHow} wait={wait} setWait={setWait} practice={state?.mode.calls === "simulated"} />
          {how !== "email_only" && (
            <div className="f" style={{ marginTop: 18, maxWidth: 420 }}>
              <label htmlFor="clines">Calls at the same time: <b style={{ color: "var(--text)" }}>{lines}</b></label>
              <input id="clines" type="range" min={1} max={10} value={lines} onChange={(e) => setLines(Number(e.target.value))} />
            </div>
          )}
          <div className="small muted" style={{ marginTop: 14 }}>
            {chosen.filter((r) => !r.email).length > 0 && how !== "call_only" && <>{chosen.filter((r) => !r.email).length} picked customer(s) have no email{how === "email_only" ? " and will be skipped" : " and will only be called"}. </>}
            {chosen.filter((r) => !r.phone).length > 0 && how !== "email_only" && <>{chosen.filter((r) => !r.phone).length} have no phone{how === "call_only" ? " and will be skipped" : " and will only be emailed"}.</>}
          </div>
        </Modal>
      )}
      {toast.node}
    </Shell>
  );
}
