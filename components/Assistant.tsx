"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

interface Action { id: string; label: string; detail: string; request: { path: string; method: "POST" | "PATCH"; json: unknown }; state?: "done" | "failed" | "busy"; error?: string }
interface Msg { role: "user" | "assistant"; content: string; actions?: Action[] }

const STARTERS = ["What needs a truck?", "Who should I call today?", "How are we doing today?"];
// The browser's speech recognition isn't in TypeScript's DOM types.
type Recog = { start(): void; stop(): void; lang: string; interimResults: boolean; onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };

/** Talk to your command center. Type or speak; it answers out loud if you want. Anything that dials needs your click. */
export function Assistant() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const recog = useRef<Recog | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Recog; webkitSpeechRecognition?: new () => Recog };
    setCanListen(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  const say = useCallback((t: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t.replace(/\(Practice brain[^)]*\)/, ""));
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  }, []);

  const send = useCallback(async (content: string, aloud = speak) => {
    const q = content.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next); setText(""); setBusy(true);
    try {
      const r = await api<{ reply: string; actions: Action[] }>("/api/assistant", { json: { messages: next.map(({ role, content }) => ({ role, content })) } });
      setMsgs([...next, { role: "assistant", content: r.reply, actions: r.actions }]);
      if (aloud) say(r.reply);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: e instanceof Error ? e.message : String(e) }]);
    } finally { setBusy(false); }
  }, [busy, msgs, say, speak]);

  const mic = () => {
    if (listening) return recog.current?.stop();
    const w = window as unknown as { SpeechRecognition?: new () => Recog; webkitSpeechRecognition?: new () => Recog };
    const R = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!R) return;
    const r = new R();
    r.lang = "en-US"; r.interimResults = false;
    r.onresult = (e) => { setSpeak(true); void send(e.results[0][0].transcript, true); };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recog.current = r; setListening(true); r.start();
  };

  const confirm = async (mi: number, a: Action) => {
    const patch = (p: Partial<Action>) => setMsgs((m) => m.map((x, i) => (i === mi ? { ...x, actions: x.actions?.map((y) => (y.id === a.id ? { ...y, ...p } : y)) } : x)));
    patch({ state: "busy" });
    try { await api(a.request.path, { method: a.request.method, json: a.request.json }); patch({ state: "done" }); }
    catch (e) { patch({ state: "failed", error: e instanceof Error ? e.message : String(e) }); }
  };

  return (
    <>
      <button className={"orb" + (busy || listening ? " busy" : "")} onClick={() => setOpen((o) => !o)} aria-label="Open assistant" title="Talk to your command center">
        <span className="orb-ring" /><span className="orb-ring r2" /><span className="orb-core">{open ? "✕" : "AI"}</span>
      </button>
      {open && (
        <div className="ai-panel card" role="dialog" aria-label="Assistant">
          <div className="ai-head">
            <span className={"ai-pulse" + (busy ? " on" : "")} />
            <div className="grow"><b>Dispatch AI</b><div className="tiny muted">{busy ? "Working on it…" : listening ? "Listening…" : "Online — ask me anything about your board"}</div></div>
            <button className={"btn sm" + (speak ? " primary" : "")} onClick={() => { if (speak) window.speechSynthesis?.cancel(); setSpeak(!speak); }} title="Read answers out loud">{speak ? "🔊 Voice on" : "🔈 Voice off"}</button>
          </div>
          <div className="ai-body">
            {!msgs.length && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="muted small">Ask about loads, carriers, customers or calls. I can set up calls for you — nothing dials until you press Confirm.</div>
                {STARTERS.map((s) => <button key={s} className="btn sm" style={{ justifyContent: "flex-start" }} onClick={() => send(s)}>{s}</button>)}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={"turn " + (m.role === "assistant" ? "user" : "agent")}>
                <div className="bubble">
                  {m.content}
                  {m.actions?.map((a) => (
                    <div key={a.id} className="ai-action">
                      <b>{a.label}</b>
                      <div className="small muted">{a.detail}</div>
                      {a.state === "done" ? <div className="small" style={{ color: "var(--good)", fontWeight: 800, marginTop: 6 }}>✓ Started — watch the map</div>
                        : <button className="btn go sm" style={{ marginTop: 8 }} disabled={a.state === "busy"} onClick={() => confirm(i, a)}>{a.state === "busy" ? "Starting…" : a.state === "failed" ? "Try again" : "Confirm"}</button>}
                      {a.state === "failed" && <div className="small" style={{ color: "var(--bad)", marginTop: 6 }}>{a.error}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {busy && <div className="turn user"><div className="bubble"><span className="dots"><i /><i /><i /></span></div></div>}
            <div ref={end} />
          </div>
          <form className="ai-foot" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            {canListen && <button type="button" className={"icon-btn" + (listening ? " rec" : "")} onClick={mic} aria-label={listening ? "Stop listening" : "Speak"} title="Speak">🎙️</button>}
            <input className="input" placeholder="Type or tap the mic…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" />
            <button className="btn primary" disabled={busy || !text.trim()}>Send</button>
          </form>
        </div>
      )}
    </>
  );
}
