"use client";
import { useState } from "react";
import { Modal } from "./ui";
import { api } from "@/lib/client";
import { money } from "@/lib/format";
import type { Load, NegotiationStyle } from "@/lib/types";

const EQUIP = ["Dry Van", "Reefer", "Flatbed", "Step Deck", "Power Only", "Box Truck", "Hotshot", "Conestoga"];
const STYLES: { id: NegotiationStyle; name: string; text: string }[] = [
  { id: "fast", name: "Cover it fast", text: "Say yes to anything at or under your top number." },
  { id: "balanced", name: "Balanced", text: "Counter once or twice, then meet them." },
  { id: "firm", name: "Hold the line", text: "Make them work for every step up." },
];

type Form = Record<string, string>;
const toForm = (l: Partial<Load>): Form => {
  const f: Form = {};
  for (const k of ["customer_name", "ref", "origin_city", "origin_state", "dest_city", "dest_state", "pickup_date", "pickup_time", "delivery_date", "delivery_time", "equipment", "commodity", "weight_lbs", "miles", "special_instructions", "customer_rate", "target_rate", "max_rate"] as const)
    f[k] = l[k] == null ? "" : String(l[k]);
  return f;
};

/** Confirm what was read from the document, then set how low to start and how high you'll go. */
export function LoadEditor({ load, note, onClose, onSaved }: {
  load: Load | null; note?: string | null;
  onClose: () => void; onSaved: (load: Load, thenLaunch: boolean) => void;
}) {
  const [f, setF] = useState<Form>(toForm(load ?? { equipment: "Dry Van" }));
  const [style, setStyle] = useState<NegotiationStyle>(load?.negotiation_style ?? "balanced");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [allowLoss, setAllowLoss] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const pay = Number(f.customer_rate) || null, low = Number(f.target_rate) || null, high = Number(f.max_rate) || null;
  const inverted = low != null && high != null && high < low;
  const loss = pay != null && high != null && high > pay;
  const ready = Boolean(f.origin_city && f.dest_city && low && high && !inverted && (!loss || allowLoss));

  const save = async (thenLaunch: boolean) => {
    setBusy(true); setErr(null);
    try {
      const body = { ...f, negotiation_style: style, allow_loss: allowLoss, status: "open" };
      const { load: saved } = load
        ? await api<{ load: Load }>(`/api/loads/${load.id}`, { method: "PATCH", json: body })
        : await api<{ load: Load }>("/api/loads", { json: body });
      onSaved(saved, thenLaunch);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = (k: string, label: string, cls = "", extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className={"f " + cls}>
      <label htmlFor={"f-" + k}>{label}</label>
      <input id={"f-" + k} className="input" value={f[k]} onChange={set(k)} {...extra} />
    </div>
  );

  return (
    <Modal
      wide
      title={load ? (load.status === "draft" ? "Check this load" : "Edit load") : "Add a load"}
      onClose={onClose}
      foot={
        <>
          {err && <span className="grow small" style={{ color: "var(--bad-text)", fontWeight: 600 }}>{err}</span>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy || !ready} onClick={() => save(false)}>Save</button>
          <button className="btn go" disabled={busy || !ready} onClick={() => save(true)}>Save &amp; find a truck →</button>
        </>
      }
    >
      {note && <div className="hint warn" style={{ marginBottom: 12 }}><b>Please double-check:</b> {note}</div>}
      <div className="section-label" style={{ marginTop: 4 }}>The load</div>
      <div className="fields">
        {field("customer_name", "Customer", "s8")}
        {field("ref", "Reference #", "s4")}
        {field("origin_city", "Pickup city", "s4")}
        {field("origin_state", "State", "s2", { maxLength: 2, style: { textTransform: "uppercase" } })}
        {field("pickup_date", "Pickup date", "s3", { type: "date" })}
        {field("pickup_time", "Time / window", "s3", { placeholder: "08:00–14:00" })}
        {field("dest_city", "Delivery city", "s4")}
        {field("dest_state", "State", "s2", { maxLength: 2, style: { textTransform: "uppercase" } })}
        {field("delivery_date", "Delivery date", "s3", { type: "date" })}
        {field("delivery_time", "Time / window", "s3")}
        <div className="f s4">
          <label htmlFor="f-equipment">Equipment</label>
          <input id="f-equipment" className="input" list="equip" value={f.equipment} onChange={set("equipment")} />
          <datalist id="equip">{EQUIP.map((e) => <option key={e} value={e} />)}</datalist>
        </div>
        {field("commodity", "Freight", "s4")}
        {field("weight_lbs", "Weight (lbs)", "s2", { inputMode: "numeric" })}
        {field("miles", "Miles", "s2", { inputMode: "numeric" })}
        <div className="f s12">
          <label htmlFor="f-notes">Notes for the carrier</label>
          <textarea id="f-notes" className="input" rows={2} value={f.special_instructions} onChange={set("special_instructions")} />
        </div>
      </div>

      <div className="section-label">The money</div>
      <div className="fields">
        <div className="f s4">
          <label htmlFor="f-pay">Customer pays you</label>
          <input id="f-pay" className="input money num" inputMode="numeric" placeholder="$" value={f.customer_rate} onChange={set("customer_rate")} />
        </div>
        <div className="f s4">
          <label htmlFor="f-low">Start the offer at (low)</label>
          <input id="f-low" className="input money num" inputMode="numeric" placeholder="$" value={f.target_rate} onChange={set("target_rate")} />
        </div>
        <div className="f s4">
          <label htmlFor="f-high">The most you&apos;ll pay (high)</label>
          <input id="f-high" className="input money num" inputMode="numeric" placeholder="$" value={f.max_rate} onChange={set("max_rate")} />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        {inverted ? (
          <div className="hint bad">Your top number is lower than your starting offer. Swap them or raise the top.</div>
        ) : loss ? (
          <div className="hint bad">
            Your top number ({money(high)}) is more than the customer pays ({money(pay)}) — you could lose {money(high! - pay!)} on this load.
            <label className="switch" style={{ marginTop: 8, display: "flex" }}>
              <input type="checkbox" checked={allowLoss} onChange={(e) => setAllowLoss(e.target.checked)} /> I understand — allow it
            </label>
          </div>
        ) : low && high ? (
          <div className="hint good">
            The bot opens at <b>{money(low)}</b> and can climb to <b>{money(high)}</b> — that&apos;s <b>{money(high - low)}</b> of room to negotiate.
            {pay ? <> You keep between <b>{money(pay - high)}</b> and <b>{money(pay - low)}</b> ({Math.round(((pay - high) / pay) * 100)}–{Math.round(((pay - low) / pay) * 100)}%).</> : null}
            {" "}Your top number is never said out loud unless the bot gets there.
          </div>
        ) : (
          <div className="hint">Set a low starting offer and the most you&apos;ll pay. The bot negotiates between the two.</div>
        )}
      </div>

      <div className="section-label">How hard to negotiate</div>
      <div className="seg3">
        {STYLES.map((s) => (
          <button key={s.id} type="button" className={style === s.id ? "on" : ""} onClick={() => setStyle(s.id)}>
            <b>{s.name}</b><span>{s.text}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
