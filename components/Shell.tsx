"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { LiveState } from "@/lib/client";
import { Assistant } from "./Assistant";

const TABS = [
  { href: "/", label: "Command Center" },
  { href: "/customers", label: "Customers" },
  { href: "/carriers", label: "Carriers" },
  { href: "/history", label: "History" },
  { href: "/setup", label: "Go Live" },
];

export function Shell({ children, mode, offline }: { children: ReactNode; mode?: LiveState["mode"]; offline?: boolean }) {
  const path = usePathname();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("fc-theme"); } catch {}
    if (saved === "light" || saved === "dark") { setTheme(saved); document.documentElement.dataset.theme = saved; }
  }, []);
  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("fc-theme", next); } catch {}
  };
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand"><span className="brand-mark">🚚</span>Freight Command</Link>
        <nav className="nav">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={path === t.href ? "on" : ""}>{t.label}</Link>
          ))}
        </nav>
        <div className="grow" />
        {offline && <span className="pill" style={{ color: "var(--bad)" }}><span className="dot" />Reconnecting…</span>}
        {mode && (
          mode.calls === "real"
            ? <span className="pill live" title="Calls are placed for real through ElevenLabs"><span className="dot" />Live calls</span>
            : <span className="pill demo" title="No phone rings. Add your ElevenLabs keys to go live."><span className="dot" />Practice mode — calls are simulated</span>
        )}
        {mode && mode.data === "demo" && <span className="pill" title="Your data is saved in a file on this machine. Connect a database later to keep it permanently and share it.">Saved locally — no database yet</span>}
        <button className="icon-btn" onClick={flip} title="Switch light / dark" aria-label="Switch light or dark theme">{theme === "dark" ? "☀️" : "🌙"}</button>
      </header>
      <div className="page">{children}</div>
      <Assistant />
    </>
  );
}
