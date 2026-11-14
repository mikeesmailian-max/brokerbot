"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { LiveState } from "@/lib/client";
import { Assistant } from "./Assistant";
import { Icon } from "./Icon";

const TABS = [
  { href: "/", label: "Command Center", short: "Home", icon: "grid" },
  { href: "/customers", label: "Customers", short: "Customers", icon: "users" },
  { href: "/carriers", label: "Carriers", short: "Carriers", icon: "truck" },
  { href: "/history", label: "History", short: "History", icon: "clock" },
  { href: "/setup", label: "Go Live", short: "Go Live", icon: "bolt" },
];

export function Shell({ children, mode, offline }: { children: ReactNode; mode?: LiveState["mode"]; offline?: boolean }) {
  const path = usePathname();
  const [theme, setTheme] = useState<"dark" | "light">("light");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("fc-look"); } catch {}
    if (saved === "light" || saved === "dark") { setTheme(saved); document.documentElement.dataset.theme = saved; }
  }, []);
  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("fc-look", next); } catch {}
  };
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand"><span className="brand-mark"><Icon name="truck" size={18} /></span>Freight Command</Link>
        <nav className="nav">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={path === t.href ? "on" : ""}><Icon name={t.icon} size={23} /><span className="lbl-full">{t.label}</span><span className="lbl-short">{t.short}</span></Link>
          ))}
        </nav>
        <div className="grow" />
        {offline && <span className="pill off"><span className="dot" />Reconnecting…</span>}
        {mode && (
          mode.calls === "real"
            ? <span className="pill live" title="Calls are placed for real through ElevenLabs"><span className="dot" />Live calls</span>
            : <span className="pill demo" title="No phone rings. Add your ElevenLabs keys to go live."><span className="dot" />Practice mode</span>
        )}
        {mode && mode.data === "demo" && <span className="pill nodb" title="Your data is saved in a file on this machine. Connect a database later to keep it permanently and share it.">No database yet</span>}
        <button className="icon-btn" onClick={flip} title="Switch light / dark" aria-label="Switch light or dark theme"><Icon name={theme === "dark" ? "sun" : "moon"} size={17} /></button>
      </header>
      <div className="page">{children}</div>
      <Assistant />
    </>
  );
}
