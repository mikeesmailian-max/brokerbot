"use client";
import { use, useCallback, useEffect, useState } from "react";
import { money } from "@/lib/format";

interface Bid {
  company: string; broker: string; carrier: string; mc_number: string | null;
  state: "open" | "covered" | "won"; agreed_rate: number | null; counter: number | null; final?: boolean;
  load: { ref: string; origin: string; destination: string; pickup: string; delivery: string; equipment: string | null; commodity: string | null; weight_lbs: number | null; miles: number | null; offering: number | null; notes: string | null };
}

/** The page a carrier lands on from the load email: see the load, send a rate. First yes wins. */
export default function BidPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [bid, setBid] = useState<Bid | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rate, setRate] = useState("");
  const [mc, setMc] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/bid/${token}`, { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) return setErr(body.error);
    setBid(body);
    setMc((m) => m || body.mc_number || "");
    setRate((r) => r || (body.load.offering ? String(body.load.offering) : ""));
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const send = async (amount: number) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/bid/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rate: amount, mc_number: mc }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setBid((b) => (b ? { ...b, ...body } : b));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  if (!bid) return <div className="center-page"><div className="card center-card">{err ?? <span className="spinner" />}</div></div>;
  const l = bid.load;
  const rows: [string, string | null][] = [
    ["Pickup", [l.origin, l.pickup].filter(Boolean).join(" · ")], ["Delivery", [l.destination, l.delivery].filter(Boolean).join(" · ")],
    ["Equipment", l.equipment], ["Freight", l.commodity], ["Weight", l.weight_lbs ? l.weight_lbs.toLocaleString() + " lbs" : null], ["Miles", l.miles ? String(l.miles) : null], ["Notes", l.notes],
  ];
  return (
    <div className="center-page">
      <div className="card center-card stack">
        <div className="muted small">{bid.company} · Load {l.ref}</div>
        <div className="h1">{l.origin} → {l.destination}</div>
        <table className="t"><tbody>{rows.filter(([, v]) => v).map(([k, v]) => <tr key={k}><td className="muted" style={{ width: 110, paddingLeft: 0 }}>{k}</td><td><b>{v}</b></td></tr>)}</tbody></table>

        {bid.state === "won" && <div className="hint good"><b>It&apos;s yours at {money(bid.agreed_rate)}.</b> {bid.broker} will send the rate confirmation shortly. Thank you!</div>}
        {bid.state === "covered" && <div className="hint">Looks like we found capacity, no longer needed, and thank you. We&apos;ll send you the next one.</div>}
        {bid.state === "open" && (
          <>
            {bid.counter != null && (
              <div className="hint warn">
                {bid.final ? <>The best we can do on this one is <b>{money(bid.counter)}</b>.</> : <>That&apos;s a little high for this load. We can do <b>{money(bid.counter)}</b>.</>}
                <div style={{ marginTop: 10 }}><button className="btn go" disabled={busy} onClick={() => send(bid.counter!)}>Accept {money(bid.counter)}</button></div>
              </div>
            )}
            <div className="fields">
              <div className="f"><label htmlFor="rate">Your all-in rate ($)</label><input id="rate" className="input money num" inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} /></div>
              <div className="f"><label htmlFor="mc">MC number</label><input id="mc" className="input" value={mc} onChange={(e) => setMc(e.target.value)} /></div>
            </div>
            {err && <div className="hint bad">{err}</div>}
            <button className="btn primary big" disabled={busy || !rate} onClick={() => send(Number(rate))}>{busy ? "Sending…" : "I have a truck — send my rate"}</button>
            <div className="tiny muted">We&apos;re offering {money(l.offering)}. First carrier to confirm gets the load.</div>
          </>
        )}
      </div>
    </div>
  );
}
