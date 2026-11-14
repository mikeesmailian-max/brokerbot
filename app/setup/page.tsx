"use client";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, useLive } from "@/lib/client";

interface Group { id: string; title: string; unlocks: string; where: string; keys: { name: string; help: string; set: boolean }[] }

export default function Setup() {
  const { state, offline } = useLive(5000);
  const [data, setData] = useState<{ appUrl: string; groups: Group[] } | null>(null);
  useEffect(() => { api<{ appUrl: string; groups: Group[] }>("/api/setup").then(setData).catch(() => {}); }, []);
  const total = data?.groups.flatMap((g) => g.keys).length ?? 0;
  const done = data?.groups.flatMap((g) => g.keys).filter((k) => k.set).length ?? 0;

  return (
    <Shell mode={state?.mode} offline={offline}>
      <div className="toolbar">
        <div className="grow">
          <div className="h1">Go live</div>
          <div className="muted">Each key you add switches on a real feature. Until then, that part runs in practice mode.</div>
        </div>
        {data && <span className={"chip " + (done === total ? "green" : "amber")}>{done} of {total} set</span>}
      </div>

      <div className="hint" style={{ marginBottom: 16 }}>
        <b>Where do the keys go?</b> Never in this screen and never in a chat.
        <br />• <b>On your computer:</b> copy the file <code>.env.example</code> to <code>.env.local</code>, paste each key after its name, and restart the app.
        <br />• <b>Once deployed:</b> in your host&apos;s settings under <b>Environment Variables</b> (on Vercel: Project → Settings → Environment Variables), then redeploy.
        <br />This page only shows whether each key is present — it can never show a key&apos;s value.
      </div>

      <div className="stack">
        {!data && <div className="card empty"><span className="spinner" /></div>}
        {data?.groups.map((g) => {
          const ok = g.keys.every((k) => k.set);
          return (
            <div key={g.id} className="card card-pad">
              <div className="row wrap" style={{ justifyContent: "space-between" }}>
                <div style={{ fontWeight: 800, fontSize: 17 }}>{g.title}</div>
                <span className={"chip " + (ok ? "green" : "amber")}>{ok ? "✓ On" : "Practice mode"}</span>
              </div>
              <div style={{ marginTop: 4 }}>{g.unlocks}</div>
              <div className="small muted" style={{ marginTop: 4 }}><b>Where to get it:</b> {g.where}</div>
              <table className="t" style={{ marginTop: 10 }}>
                <tbody>
                  {g.keys.map((k) => (
                    <tr key={k.name}>
                      <td style={{ width: 30, paddingLeft: 0 }}>{k.set ? "✅" : "⬜"}</td>
                      <td style={{ width: 300 }}><code>{k.name}</code></td>
                      <td className="small muted">{k.help}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {data && (
        <div className="hint" style={{ marginTop: 16 }}>
          <b>Two addresses to paste into ElevenLabs</b> (the setup script does the first for you):
          <br />• Agent tools call: <code>{data.appUrl}/api/tools/…</code>
          <br />• Post-call webhook: <code>{data.appUrl}/api/webhooks/elevenlabs</code>
        </div>
      )}
    </Shell>
  );
}
