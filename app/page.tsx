"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { DropZone, useToast } from "@/components/ui";
import { Ecosystem, type EcoNode } from "@/components/Ecosystem";
import { LoadEditor } from "@/components/LoadEditor";
import { Launcher } from "@/components/Launcher";
import { api, clock, mergeByCompany, nodeLabel, toneOf, useLive, useTick } from "@/lib/client";
import { initials, laneOf, money, place, shortDate, timeAgo } from "@/lib/format";
import { ACTIVE_CALL, type Load } from "@/lib/types";

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  draft: { label: "Needs your OK", cls: "amber" },
  open: { label: "Needs a truck", cls: "blue" },
  searching: { label: "Calling…", cls: "violet" },
  covered: { label: "Covered", cls: "green" },
};

export default function CommandCenter() {
  const { state, offline, refresh } = useLive();
  useTick();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ load: Load | null; note?: string | null } | null>(null);
  const [launching, setLaunching] = useState<Load | null>(null);

  const loads = useMemo(() => state?.loads ?? [], [state]);
  const working = loads.filter((l) => l.status !== "covered");
  const covered = loads.filter((l) => l.status === "covered").sort((a, b) => (b.covered_at ?? "").localeCompare(a.covered_at ?? "")).slice(0, 8);

  // Keep something useful selected.
  useEffect(() => {
    if (!state) return;
    if (selectedId && loads.some((l) => l.id === selectedId)) return;
    const pick = loads.find((l) => l.status === "searching") ?? loads.find((l) => l.status === "open") ?? loads[0];
    setSelectedId(pick?.id ?? null);
  }, [state, loads, selectedId]);

  const load = loads.find((l) => l.id === selectedId) ?? null;
  const loadCalls = useMemo(() => {
    if (!state || !load) return [];
    const mine = state.calls.filter((c) => c.load_id === load.id);
    const latest = mine[0]?.campaign_id; // calls arrive newest first
    return mine.filter((c) => c.campaign_id === latest).sort((a, b) => a.position - b.position);
  }, [state, load]);
  const campaign = state?.campaigns.find((c) => c.load_id === load?.id) ?? null;
  const winner = loadCalls.find((c) => c.outcome === "booked");
  const heard = loadCalls.filter((c) => c.channel === "call" && c.outcome === "covered_elsewhere" && c.stage?.startsWith("Told")).length;
  const nodes: EcoNode[] = mergeByCompany(loadCalls).map(({ call: c, emailed }) => ({ id: c.id, name: c.company_name, tone: toneOf(c), label: nodeLabel(c), emailed }));
  const liveCalls = (state?.calls ?? []).filter((c) => c.channel === "call" && ACTIVE_CALL.includes(c.status));

  const onDoc = useCallback(async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("purpose", "new_load");
    try {
      const r = await api<{ load: Load; extracted: { needs_review: string | null }; demo: boolean }>("/api/extract", { method: "POST", body: fd });
      await refresh();
      setSelectedId(r.load.id);
      setEditing({ load: r.load, note: r.extracted.needs_review });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), "bad");
    }
  }, [refresh, toast]);

  const stop = async () => {
    if (!campaign) return;
    try { await api(`/api/campaigns/${campaign.id}/stop`, { method: "POST" }); toast.show("Search stopped. Calls already in progress will finish."); await refresh(); }
    catch (e) { toast.show(e instanceof Error ? e.message : String(e), "bad"); }
  };
  const remove = async (l: Load) => {
    if (!window.confirm(`Remove ${laneOf(l)} from the board?`)) return;
    try { await api(`/api/loads/${l.id}`, { method: "DELETE" }); await refresh(); }
    catch (e) { toast.show(e instanceof Error ? e.message : String(e), "bad"); }
  };

  const k = state?.kpis;
  return (
    <Shell mode={state?.mode} offline={offline}>
      <div className="kpis">
        <Kpi ico="📞" cls="hot" val={k ? String(k.activeCalls) : "–"} label={k?.waiting ? `On the phone now · ${k.waiting} in line` : "On the phone now"} />
        <Kpi ico="📦" val={k ? String(k.needTruck) : "–"} label="Loads that need a truck" />
        <Kpi ico="✅" cls="win" val={k ? String(k.coveredToday) : "–"} label="Covered today" />
        <Kpi ico="💵" cls="win" val={k ? money(k.marginToday) : "–"} label="Margin booked today" />
        <Kpi ico="📈" val={k ? `${k.callsToday}` : "–"} label={k?.reachRate != null ? `Calls today · ${k.reachRate}% picked up` : "Calls today"} />
      </div>

      <div className="grid3">
        {/* ── Left: loads ── */}
        <div className="stack">
          <div className="card card-pad stack">
            <DropZone icon="📄" title="Drop a rate con or load sheet" sub="PDF, photo or screenshot — I'll pull out the load" accept=".pdf,image/*,.txt,.eml,.csv,.xlsx" onFile={onDoc} />
            <button className="btn" onClick={() => setEditing({ load: null })}>＋ Add a load by hand</button>
          </div>
          <div className="card">
            <div className="card-head"><span className="card-title">Your board</span><span className="tiny muted">{working.length} open</span></div>
            <div style={{ padding: 8 }}>
              {!state && <div className="empty"><span className="spinner" /></div>}
              {state && !loads.length && <div className="empty">No loads yet. Drop a document above to add your first one.</div>}
              {working.map((l) => <LoadRow key={l.id} l={l} on={l.id === selectedId} onClick={() => setSelectedId(l.id)} />)}
              {covered.length > 0 && <div className="card-title" style={{ padding: "12px 14px 4px" }}>Recently covered</div>}
              {covered.map((l) => <LoadRow key={l.id} l={l} on={l.id === selectedId} onClick={() => setSelectedId(l.id)} />)}
            </div>
          </div>
        </div>

        {/* ── Center: the mission ── */}
        <div className="card">
          {!load ? (
            <div className="empty" style={{ padding: "90px 20px" }}>
              <div style={{ fontSize: 44 }}>🛰️</div>
              <div className="h1" style={{ marginTop: 8 }}>Ready when you are</div>
              <p style={{ marginTop: 6 }}>Drop a rate confirmation on the left and I&apos;ll set up the load for you.</p>
            </div>
          ) : (
            <>
              <div className="mission-head">
                <div className="grow">
                  <div className="row wrap" style={{ gap: 8, marginBottom: 6 }}>
                    <span className={"chip " + STATUS_CHIP[load.status]?.cls}>{STATUS_CHIP[load.status]?.label ?? load.status}</span>
                    <span className="small muted">{load.ref}{load.customer_name ? ` · ${load.customer_name}` : ""}</span>
                  </div>
                  <div className="mission-lane">{place(load.origin_city, load.origin_state)} <span className="arrow">→</span> {place(load.dest_city, load.dest_state)}</div>
                </div>
                <div className="row wrap">
                  {load.status !== "covered" && <button className="btn" onClick={() => setEditing({ load })}>Edit</button>}
                  {load.status !== "covered" && !campaign && <button className="btn danger ghost" onClick={() => remove(load)}>Remove</button>}
                  {campaign ? (
                    <button className="btn danger" onClick={stop}>■ Stop search</button>
                  ) : load.status === "draft" ? (
                    <button className="btn primary big" onClick={() => setEditing({ load })}>Check &amp; confirm</button>
                  ) : load.status === "open" ? (
                    <button className="btn go big" onClick={() => (load.target_rate && load.max_rate ? setLaunching(load) : setEditing({ load }))}>📞 Find a truck</button>
                  ) : null}
                </div>
              </div>

              <div className="facts">
                <Fact k="Pickup" v={[shortDate(load.pickup_date), load.pickup_time].filter(Boolean).join(" · ")} />
                <Fact k="Delivery" v={[shortDate(load.delivery_date), load.delivery_time].filter(Boolean).join(" · ")} />
                <Fact k="Equipment" v={load.equipment} />
                <Fact k="Freight" v={load.commodity} />
                <Fact k="Weight" v={load.weight_lbs ? load.weight_lbs.toLocaleString() + " lbs" : null} />
                <Fact k="Miles" v={load.miles ? load.miles.toLocaleString() : null} />
                {load.special_instructions && <Fact k="Notes" v={load.special_instructions} />}
              </div>

              <RateBar load={load} />

              {winner && (
                <div className="banner-win">
                  <span style={{ fontSize: 26 }}>🎉</span>
                  <div className="grow">
                    Truck found — <b>{winner.company_name}</b> took it at <b>{money(winner.agreed_rate)}</b>
                    {load.customer_rate != null && winner.agreed_rate != null ? <> · you keep <b>{money(load.customer_rate - winner.agreed_rate)}</b></> : null}.
                    <div className="small" style={{ fontWeight: 600, marginTop: 2 }}>{heard > 0 ? `${heard} carrier${heard === 1 ? "" : "s"} still on the line heard “Looks like we found capacity, no longer needed, and thank you.” ` : ""}Everyone else was released.</div>
                  </div>
                </div>
              )}
              {load.status === "covered" && !winner && (
                <div className="banner-win"><span style={{ fontSize: 22 }}>✅</span><div>Covered by <b>{load.covered_by_name}</b> at <b>{money(load.covered_rate)}</b>.</div></div>
              )}
              {load.status === "draft" && <div className="banner-note">I read this from your document. Give it a quick check and set your low and high numbers — then I can start calling.</div>}

              <Ecosystem
                hub={{
                  line1: load.origin_city ?? "Pickup",
                  line2: "→ " + (load.dest_city ?? "Delivery"),
                  sub: load.status === "covered" ? "COVERED" : campaign ? "SEARCHING…" : "READY",
                  done: load.status === "covered",
                  busy: Boolean(campaign),
                }}
                nodes={nodes}
                idle={load.status === "open" ? "Press “Find a truck” and carriers will appear here as I call them." : ""}
              />
            </>
          )}
        </div>

        {/* ── Right: live lines + activity ── */}
        <div className="stack right">
          <div className="card">
            <div className="card-head" style={{ paddingBottom: 10 }}>
              <span className="card-title">On the phone now</span>
              <span className="chip blue num">{liveCalls.length}</span>
            </div>
            {!liveCalls.length && <div className="empty">All quiet. Lines light up here when calls are out.</div>}
            {liveCalls.map((c) => {
              const tone = toneOf(c);
              return (
                <div key={c.id} className="line-item">
                  <div className={"avatar " + tone}>{initials(c.company_name)}</div>
                  <div className="grow">
                    <div className="row" style={{ gap: 6 }}>
                      <b className="ellipsis">{c.company_name}</b>
                      {c.type === "customer" && <span className="chip teal">Customer</span>}
                    </div>
                    <div className="small muted ellipsis">{c.stage}</div>
                  </div>
                  <span className="small muted num">{clock(c.started_at)}</span>
                </div>
              );
            })}
          </div>

          <div className="card">
            <div className="card-head" style={{ paddingBottom: 10 }}><span className="card-title">What&apos;s happening</span></div>
            <div className="feed">
              {!state?.events.length && <div className="empty">Nothing yet.</div>}
              {state?.events.map((e) => (
                <div key={e.id} className={"feed-item " + e.level}>
                  <span className="feed-dot" />
                  <div className="grow">
                    <div>{e.message}</div>
                    <div className="tiny muted">{timeAgo(e.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {editing && (
        <LoadEditor
          load={editing.load}
          note={editing.note}
          onClose={() => setEditing(null)}
          onSaved={async (saved, thenLaunch) => {
            setEditing(null);
            await refresh();
            setSelectedId(saved.id);
            if (thenLaunch) setLaunching(saved);
            else toast.show("Saved.", "good");
          }}
        />
      )}
      {launching && state && (
        <Launcher
          load={launching}
          mode={state.mode}
          onClose={() => setLaunching(null)}
          onStarted={async () => { setLaunching(null); await refresh(); toast.show("Calls are going out. Watch the map.", "good"); }}
        />
      )}
      {toast.node}
    </Shell>
  );
}

function Kpi({ ico, val, label, cls = "" }: { ico: string; val: string; label: string; cls?: string }) {
  return (
    <div className={"card kpi " + cls}>
      <div className="kpi-ico">{ico}</div>
      <div className="grow"><div className="kpi-val num">{val}</div><div className="kpi-label ellipsis">{label}</div></div>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v || v === "—") return null;
  return <div className="fact"><b>{k}</b>{v}</div>;
}

function LoadRow({ l, on, onClick }: { l: Load; on: boolean; onClick: () => void }) {
  const chip = STATUS_CHIP[l.status];
  return (
    <button className={"load-item" + (on ? " on" : "")} onClick={onClick}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        <span className="load-lane ellipsis">{l.origin_city ?? "—"}<span className="arrow">→</span>{l.dest_city ?? "—"}</span>
        {chip && <span className={"chip " + chip.cls}>{chip.label}</span>}
      </div>
      <div className="small muted ellipsis" style={{ marginTop: 3 }}>
        {[l.customer_name, shortDate(l.pickup_date), l.equipment, l.status === "covered" ? `${l.covered_by_name} · ${money(l.covered_rate)}` : l.customer_rate ? `pays ${money(l.customer_rate)}` : null].filter((x) => x && x !== "—").join(" · ")}
      </div>
    </button>
  );
}

/** Where your money sits: opening offer, room to negotiate, and what you keep. */
function RateBar({ load }: { load: Load }) {
  const low = load.target_rate, high = load.max_rate, pay = load.customer_rate;
  if (!low || !high) return null;
  const top = Math.max(pay ?? 0, high) || high;
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / top) * 100))}%`;
  const paid = load.covered_rate;
  return (
    <div className="ratebar-wrap">
      <div className="ratebar" aria-hidden="true">
        <div className="seg base" style={{ left: 0, width: pct(low) }} />
        <div className="seg room" style={{ left: pct(low), width: pct(high - low) }} />
        {pay != null && pay > high && <div className="seg margin" style={{ left: pct(high), width: pct(pay - high) }} />}
      </div>
      <div className="rate-legend">
        <div><div className="k"><span className="swatch" style={{ background: "var(--accent)" }} />Bot opens at</div><div className="v num">{money(low)}</div></div>
        <div><div className="k"><span className="swatch" style={{ background: "var(--warn)" }} />Can go up to</div><div className="v num">{money(high)}</div></div>
        <div><div className="k">Customer pays</div><div className="v num">{money(pay)}</div></div>
        <div>
          <div className="k"><span className="swatch" style={{ background: "var(--good)" }} />{paid != null ? "You keep" : "You keep at least"}</div>
          <div className="v num" style={{ color: "var(--good)" }}>{pay != null ? money(pay - (paid ?? high)) : "—"}</div>
        </div>
      </div>
    </div>
  );
}
