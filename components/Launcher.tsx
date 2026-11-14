"use client";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "./ui";
import { api, type LiveState } from "@/lib/client";
import { laneOf, money } from "@/lib/format";
import type { Carrier, Load } from "@/lib/types";

type Ranked = Carrier & { score: number; why: string[] };

/** Pick who to call, how many lines to run at once, and go. */
export function Launcher({ load, mode, onClose, onStarted }: {
  load: Load; mode: LiveState["mode"]; onClose: () => void; onStarted: () => void;
}) {
  const [ranked, setRanked] = useState<Ranked[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [lines, setLines] = useState(5);
  const [email, setEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    api<{ ranked: Ranked[] }>(`/api/loads/${load.id}/carriers`)
      .then((r) => {
        setRanked(r.ranked);
        // Start with the best fits ticked.
        const good = r.ranked.filter((c) => c.score >= 40 && c.phone).slice(0, 15);
        setPicked(new Set((good.length ? good : r.ranked.filter((c) => c.phone).slice(0, 10)).map((c) => c.id)));
      })
      .catch((e) => setErr(e.message));
  }, [load.id]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (ranked ?? []).filter((c) => !s || [c.name, c.home_state, c.home_city, c.mc_number, c.equipment_types.join(" ")].join(" ").toLowerCase().includes(s));
  }, [ranked, q]);
  const chosen = (ranked ?? []).filter((c) => picked.has(c.id));
  const callable = chosen.filter((c) => c.phone).length;
  const emailable = chosen.filter((c) => c.email).length;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const top = (n: number) => setPicked(new Set((ranked ?? []).filter((c) => c.phone || c.email).slice(0, n).map((c) => c.id)));

  const go = async () => {
    setBusy(true); setErr(null);
    try {
      // Send ids in ranked order so the best fits are dialed first.
      await api("/api/campaigns", { json: { type: "capacity", loadId: load.id, carrierIds: (ranked ?? []).filter((c) => picked.has(c.id)).map((c) => c.id), concurrency: lines, alsoEmail: email } });
      onStarted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title={<>Find a truck · <span className="muted">{laneOf(load)}</span></>}
      onClose={onClose}
      foot={
        <>
          {err && <span className="grow small" style={{ color: "var(--bad)", fontWeight: 700 }}>{err}</span>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn go big" disabled={busy || (!callable && !(email && emailable))} onClick={go}>
            {busy ? "Starting…" : `Start — call ${callable}${email && emailable ? `, email ${emailable}` : ""}`}
          </button>
        </>
      }
    >
      <div className="hint" style={{ marginBottom: 12 }}>
        Opens at <b>{money(load.target_rate)}</b>, can go up to <b>{money(load.max_rate)}</b>. <b>First carrier to say yes gets it.</b> The
        moment that happens, everyone else on the line hears: <i>“Looks like we found capacity, no longer needed, and thank you.”</i>
      </div>
      {mode.calls === "simulated" && (
        <div className="hint warn" style={{ marginBottom: 12 }}><b>Practice mode:</b> no phones will ring and no emails go out. You&apos;ll see a realistic simulation.</div>
      )}
      {mode.calls === "real" && !mode.cutIn && (
        <div className="hint warn" style={{ marginBottom: 12 }}>Twilio keys aren&apos;t set, so I can&apos;t cut in on other calls instantly — they&apos;ll be told on the agent&apos;s next turn instead.</div>
      )}

      <div className="row wrap" style={{ marginBottom: 10 }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search carriers…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">Quick pick:</span>
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
              {!c.phone && <span className="chip amber">No phone{c.email ? " — email only" : ""}</span>}
            </div>
          </label>
        ))}
      </div>

      <div className="fields" style={{ marginTop: 16 }}>
        <div className="f">
          <label htmlFor="lines">Calls at the same time: <b style={{ color: "var(--text)" }}>{lines}</b></label>
          <input id="lines" type="range" min={1} max={20} value={lines} onChange={(e) => setLines(Number(e.target.value))} />
          <span className="tiny muted">As one call ends, the next carrier in line is dialed automatically.</span>
        </div>
        <div className="f">
          <label>&nbsp;</label>
          <label className="switch"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Also email them the load</label>
          <span className="tiny muted">Each email has a private link to send a rate. Email replies compete with the calls — first yes wins.</span>
        </div>
      </div>
    </Modal>
  );
}
