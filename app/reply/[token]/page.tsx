"use client";
import { use, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

interface Info { company: string; broker: string; phone: string; customer: string; contact: string | null; answered: string | null }
const BLANK = { origin: "", destination: "", pickup_date: "", equipment: "", commodity: "", weight_lbs: "", rate: "", notes: "" };

/** The page a customer lands on from the check-in email: send a load, say "nothing now", or ask for a call. */
export default function ReplyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"choose" | "load" | "done-load" | "done-none" | "done-call">("choose");
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/reply/${token}`, { cache: "no-store" })
      .then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error); setInfo(b); })
      .catch((e) => setErr(e.message));
    const a = new URLSearchParams(window.location.search).get("a");
    if (a === "load") setView("load");
  }, [token]);

  const send = async (body: Record<string, unknown>, then: typeof view) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/reply/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error);
      setView(then);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  // "Nothing right now" and "Call me" in the email are one tap: confirm here, then record.
  const quick = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("a") : null;

  if (!info) return <div className="center-page"><div className="card center-card">{err ?? <span className="spinner" />}</div></div>;
  const hi = (info.contact || "").split(" ")[0];
  const field = (k: keyof typeof BLANK, label: string, cls = "", extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className={"f " + cls}><label htmlFor={"r-" + k}>{label}</label><input id={"r-" + k} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></div>
  );

  return (
    <div className="center-page">
      <div className="card center-card stack" style={{ width: "min(560px, 100%)" }}>
        <div className="brand"><span className="brand-mark"><Icon name="truck" size={18} /></span>{info.company}</div>

        {view === "choose" && (
          <>
            <div>
              <div className="h1" style={{ fontSize: 26 }}>{hi ? `Hi ${hi},` : "Hi,"} anything moving?</div>
              <div className="muted" style={{ marginTop: 6 }}>{info.broker} is checking in to see if {info.customer} has freight this week or next.</div>
            </div>
            {quick === "none" || quick === "call" ? (
              <button className="btn primary big block" disabled={busy} onClick={() => send({ answer: quick }, quick === "none" ? "done-none" : "done-call")}>
                {quick === "none" ? "Confirm: nothing right now" : "Confirm: please call me"}
              </button>
            ) : null}
            <button className={"btn big block" + (quick ? "" : " primary")} onClick={() => setView("load")}>Yes — I have a load</button>
            {quick !== "none" && <button className="btn block" disabled={busy} onClick={() => send({ answer: "none" }, "done-none")}>Nothing right now</button>}
            {quick !== "call" && <button className="btn block" disabled={busy} onClick={() => send({ answer: "call" }, "done-call")}>Call me instead</button>}
          </>
        )}

        {view === "load" && (
          <>
            <div className="h1" style={{ fontSize: 24 }}>Tell us about the load</div>
            <div className="fields">
              {field("origin", "Picks up in (city, state)", "", { placeholder: "Dallas, TX" })}
              {field("destination", "Delivers to (city, state)", "", { placeholder: "Atlanta, GA" })}
              {field("pickup_date", "Pickup date", "", { type: "date" })}
              {field("equipment", "Equipment", "", { placeholder: "Dry van, reefer, flatbed…" })}
              {field("commodity", "What is it?", "")}
              {field("weight_lbs", "Weight (lbs)", "s3", { inputMode: "numeric" })}
              {field("rate", "Your rate ($)", "s3", { inputMode: "numeric", placeholder: "Optional" })}
              <div className="f s12"><label htmlFor="r-notes">Anything else</label><textarea id="r-notes" className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
            </div>
            {err && <div className="hint bad">{err}</div>}
            <button className="btn primary big block" disabled={busy || !f.origin.trim() || !f.destination.trim()} onClick={() => send({ answer: "load", ...f }, "done-load")}>{busy ? "Sending…" : "Send to " + info.broker}</button>
            <button className="btn ghost block" onClick={() => setView("choose")}>Back</button>
          </>
        )}

        {view === "done-load" && (
          <>
            <div className="hint good"><b>Got it — thank you.</b> {info.broker} will confirm the rate and details by email shortly.</div>
            <button className="btn block" onClick={() => { setF(BLANK); setView("load"); }}>Add another load</button>
          </>
        )}
        {view === "done-none" && <div className="hint">Thanks for letting us know. We&apos;ll check back another time.</div>}
        {view === "done-call" && <div className="hint good">Will do — {info.broker} will call you.{info.phone ? ` You can also reach us at ${info.phone}.` : ""}</div>}
        {err && view === "choose" && <div className="hint bad">{err}</div>}
      </div>
    </div>
  );
}
