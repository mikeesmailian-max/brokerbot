"use client";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "./ui";
import { MethodPicker, waitLabel, type Mode } from "./MethodPicker";
import { api, type LiveState } from "@/lib/client";
import { laneOf, money } from "@/lib/format";
import type { Carrier, Load } from "@/lib/types";

type Ranked = Carrier & { score: number; why: string[] };

/** Pick who to reach, how (email first by default), and go. */
export function Launcher({ load, mode: live, onClose, onStarted }: {
  load: Load; mode: LiveState["mode"]; onClose: () => void; onStarted: (how: Mode) => void;
}) {
  const [ranked, setRanked] = useState<Ranked[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [lines, setLines] = useState(5);
  const [how, setHow] = useState<Mode>("email_first");
  const [wait, setWait] = useState(15);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    api<{ ranked: Ranked[] }>(`/api/loads/${load.id}/carriers`)
      .then((r) => {
        setRanked(r.ranked);
        // Start with the best fits ticked.
        const good = r.ranked.filter((c) => c.score >= 40 && (c.phone || c.email)).slice(0, 15);
        setPicked(new Set((good.length ? good : r.ranked.filter((c) => c.phone || c.email).slice(0, 10)).map((c) => c.id)));
      })
      .catch((e) => setErr(e.message));
  }, [load.id]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (ranked ?? []).filter((c) => !s || [c.name, c.home_state, c.home_city, c.mc_number, c.equipment_types.join(" ")].join(" ").toLowerCase().includes(s));
  }, [ranked, q]);
  const chosen = (ranked ?? []).filter((c) => picked.has(c.id));
  const emails = how === "call_only" ? 0 : chosen.filter((c) => c.email).length;
  const calls = how === "email_only" ? 0 : chosen.filter((c) => c.phone).length;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const top = (n: number) => setPicked(new Set((ranked ?? []).filter((c) => c.phone || c.email).slice(0, n).map((c) => c.id)));

  const go = async () => {
    setBusy(true); setErr(null);
    try {
      // Send ids in ranked order so the best fits are reached first.
      await api("/api/campaigns", { json: { type: "capacity", loadId: load.id, carrierIds: (ranked ?? []).filter((c) => picked.has(c.id)).map((c) => c.id), concurrency: lines, mode: how, waitMinutes: wait } });
      onStarted(how);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const label =
    how === "email_first" ? `Email ${emails} now${calls ? ", call later if needed" : ""}`
    : how === "email_only" ? `Email ${emails} carriers`
    : how === "call_only" ? `Call ${calls} carriers`
    : `Email ${emails} and call ${calls}`;

  return (
    <Modal
      wide
      title={<>Find a truck · <span className="muted">{laneOf(load)}</span></>}
      onClose={onClose}
      foot={
        <>
          {err && <span className="grow small" style={{ color: "var(--bad-text)", fontWeight: 600 }}>{err}</span>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn go big" disabled={busy || (!calls && !emails)} onClick={go}>{busy ? "Starting…" : label}</button>
        </>
      }
    >
      <div className="hint" style={{ marginBottom: 14 }}>
        Opens at <b>{money(load.target_rate)}</b>, can go up to <b>{money(load.max_rate)}</b>. <b>First carrier to say yes gets it</b> — by email or by phone.
        Everyone else is told: <i>“Looks like we found capacity, no longer needed, and thank you.”</i>
      </div>
      {live.calls === "simulated" && (
        <div className="hint warn" style={{ marginBottom: 14 }}><b>Practice mode:</b> no emails go out and no phones ring. You&apos;ll see a realistic simulation.</div>
      )}
      {live.calls === "real" && !live.email && how !== "call_only" && (
        <div className="hint warn" style={{ marginBottom: 14 }}>Email isn&apos;t set up yet (see Go Live), so emails won&apos;t actually be sent.</div>
      )}

      <div className="section-label" style={{ marginTop: 4 }}>How to reach them</div>
      <MethodPicker mode={how} setMode={setHow} wait={wait} setWait={setWait} practice={live.calls === "simulated"} />

      <div className="section-label">Who</div>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <input className="input" style={{ maxWidth: 240 }} placeholder="Search carriers…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn sm" onClick={() => top(10)}>Best 10</button>
        <button className="btn sm" onClick={() => top(25)}>Best 25</button>
        <button className="btn sm" onClick={() => top(9999)}>Everyone</button>
        <button className="btn sm ghost" onClick={() => setPicked(new Set())}>Clear</button>
        <span className="grow" />
        <b>{picked.size} picked</b>
      </div>

      <div className="pick-list">
        {!ranked && <div className="empty"><span className="spinner" /> Ranking your carriers for this load…</div>}
        {ranked && !ranked.length && <div className="empty">No carriers yet. Go to <b>Carriers</b> and drop in your Excel list.</div>}
        {visible.map((c) => (
          <label key={c.id} className="pick">
            <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
            <div className="grow">
              <div className="row" style={{ gap: 8 }}>
                <b className="ellipsis">{c.name}</b>
                {c.mc_number && <span className="tiny muted">{c.mc_number}</span>}
              </div>
              <div className="small muted ellipsis">
                {[c.contact_name, [c.home_city, c.home_state].filter(Boolean).join(", "), c.equipment_types.join(" / ")].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="row wrap" style={{ gap: 6, justifyContent: "flex-end", maxWidth: 330 }}>
              {c.why.map((w) => <span key={w} className="chip green">{w}</span>)}
              {!c.email && <span className="chip amber">No email{c.phone ? " — phone only" : ""}</span>}
              {!c.phone && c.email && <span className="chip amber">No phone — email only</span>}
            </div>
          </label>
        ))}
      </div>

      {how !== "email_only" && (
        <div className="f" style={{ marginTop: 16, maxWidth: 420 }}>
          <label htmlFor="lines">Calls at the same time: <b style={{ color: "var(--text)" }}>{lines}</b></label>
          <input id="lines" type="range" min={1} max={20} value={lines} onChange={(e) => setLines(Number(e.target.value))} />
          <span className="tiny muted">
            {how === "email_first"
              ? `Phones start after ${live.calls === "simulated" ? "15 seconds (practice)" : waitLabel(wait)}, and only if the load is still open.`
              : "As one call ends, the next carrier in line is dialed automatically."}
          </span>
        </div>
      )}
    </Modal>
  );
}
