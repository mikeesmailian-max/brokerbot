"use client";

export type Mode = "email_first" | "email_only" | "call_only" | "both";

const OPTIONS: { id: Mode; name: string; text: string }[] = [
  { id: "email_first", name: "Email first, then call", text: "Email everyone now. Phone only those who haven't answered." },
  { id: "email_only", name: "Email only", text: "Send the email and wait for replies." },
  { id: "call_only", name: "Call only", text: "Skip email and start dialing." },
  { id: "both", name: "Email + call together", text: "Fastest: both go out at the same moment." },
];
export const WAITS = [5, 15, 30, 60, 120];
export const waitLabel = (m: number) => (m < 60 ? `${m} minutes` : m === 60 ? "1 hour" : `${m / 60} hours`);

/** Choose how to reach people. Email goes first by default; the phone is the follow-up. */
export function MethodPicker({ mode, setMode, wait, setWait, practice }: {
  mode: Mode; setMode: (m: Mode) => void; wait: number; setWait: (m: number) => void; practice: boolean;
}) {
  return (
    <div>
      <div className="seg4" role="radiogroup" aria-label="How to reach them">
        {OPTIONS.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={mode === o.id} className={mode === o.id ? "on" : ""} onClick={() => setMode(o.id)}>
            <b>{o.name}</b><span>{o.text}</span>
          </button>
        ))}
      </div>
      {mode === "email_first" && (
        <div className="row wrap" style={{ marginTop: 12 }}>
          <label htmlFor="wait" style={{ fontWeight: 500 }}>Start calling if no one answers after</label>
          <select id="wait" className="input" style={{ width: "auto" }} value={wait} onChange={(e) => setWait(Number(e.target.value))}>
            {WAITS.map((m) => <option key={m} value={m}>{waitLabel(m)}</option>)}
          </select>
          {practice && <span className="small muted">Practice mode waits 15 seconds instead, so you can watch it happen.</span>}
        </div>
      )}
    </div>
  );
}
