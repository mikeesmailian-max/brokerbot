"use client";
import { useState } from "react";
import { api } from "@/lib/client";

export default function Login() {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await api("/api/login", { json: { password } }); window.location.href = "/"; }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  return (
    <div className="center-page">
      <form className="card center-card stack" onSubmit={go}>
        <div className="brand"><span className="brand-mark">🚚</span>Freight Command</div>
        <div className="muted">Sign in to your command center.</div>
        <div className="f">
          <label htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <div className="hint bad">{err}</div>}
        <button className="btn primary big" disabled={busy || !password}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
