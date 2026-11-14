"use client";
import type { Tone } from "@/lib/client";
import { initials } from "@/lib/format";

export interface EcoNode { id: string; name: string; tone: Tone; label: string; emailed?: boolean }

const CX = 450, CY = 285, HUB = 70, R = 25;
const RINGS = [
  { cap: 10, rx: 255, ry: 165 },
  { cap: 16, rx: 388, ry: 228 },
];
const MAX = RINGS[0].cap + RINGS[1].cap;
const short = (s: string, n = 17) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/**
 * The living map: your load (or you) in the middle, every carrier or customer
 * we are reaching out to around it. Lines light up as calls ring, connect and negotiate.
 */
export function Ecosystem({ hub, nodes, idle, compact }: {
  hub: { line1: string; line2?: string; sub: string; done?: boolean; busy?: boolean };
  nodes: EcoNode[];
  idle: string;
  compact?: boolean;
}) {
  // Most interesting first, so live calls sit on the inner ring.
  const order: Record<Tone, number> = { won: 0, haggle: 1, talk: 2, ring: 3, mail: 4, wait: 5, told: 6, off: 7 };
  const sorted = [...nodes].sort((a, b) => order[a.tone] - order[b.tone]);
  const shown = sorted.slice(0, MAX);
  const hidden = sorted.length - shown.length;
  const inner = shown.slice(0, RINGS[0].cap);
  const outer = shown.slice(RINGS[0].cap);

  const placed = [
    ...inner.map((n, i) => ({ n, ring: RINGS[0], a: -90 + (360 * i) / Math.max(inner.length, 1) })),
    ...outer.map((n, i) => ({ n, ring: RINGS[1], a: -90 + (360 * (i + 0.5)) / Math.max(outer.length, 1) })),
  ].map(({ n, ring, a }) => {
    const rad = (a * Math.PI) / 180;
    const x = CX + ring.rx * Math.cos(rad), y = CY + ring.ry * Math.sin(rad);
    const d = Math.hypot(x - CX, y - CY);
    const ux = (x - CX) / d, uy = (y - CY) / d;
    return { n, x, y, x1: CX + ux * (HUB + 4), y1: CY + uy * (HUB + 4), x2: x - ux * (R + 3), y2: y - uy * (R + 3) };
  });

  const lineClass = (t: Tone) => (t === "told" || t === "off" || t === "wait" ? "off" : t);

  return (
    <div className={"eco" + (compact ? " compact" : "")}>
      <svg viewBox="0 0 900 590" role="img" aria-label={`Live map: ${nodes.length} contacts`}>
        <ellipse className={"orbit" + (hub.busy ? " spin" : "")} cx={CX} cy={CY} rx={RINGS[0].rx} ry={RINGS[0].ry} />
        <ellipse className="orbit" cx={CX} cy={CY} rx={RINGS[1].rx} ry={RINGS[1].ry} />

        {placed.map((p) => (
          <line key={"l" + p.n.id} className={"link-line " + lineClass(p.n.tone)} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} />
        ))}

        <circle className={"hub-halo" + (hub.done ? " done" : "")} cx={CX} cy={CY} r={HUB + 22} />
        <circle className={"hub-core" + (hub.done ? " done" : "")} cx={CX} cy={CY} r={HUB} />
        <text className="hub-text" x={CX} y={CY - (hub.line2 ? 14 : 2)} fontSize={15}>{short(hub.line1, 15)}</text>
        {hub.line2 && <text className="hub-text" x={CX} y={CY + 6} fontSize={15}>{short(hub.line2, 15)}</text>}
        <text className="hub-sub" x={CX} y={CY + 30} style={hub.done ? { fill: "var(--good)" } : undefined}>{hub.sub}</text>

        {placed.map((p) => (
          <g key={p.n.id} className={"node " + p.n.tone}>
            <title>{`${p.n.name} — ${p.n.label}${p.n.emailed ? " (also emailed)" : ""}`}</title>
            {(p.n.tone === "ring" || p.n.tone === "talk" || p.n.tone === "haggle" || p.n.tone === "won") && (
              <circle className="pulse" cx={p.x} cy={p.y} r={R} />
            )}
            <circle className="body" cx={p.x} cy={p.y} r={R} />
            <text className="ini" x={p.x} y={p.y}>{p.n.tone === "won" ? "✓" : p.n.tone === "mail" ? "✉" : initials(p.n.name)}</text>
            {p.n.emailed && p.n.tone !== "mail" && (
              <>
                <circle className="badge" cx={p.x + R - 5} cy={p.y - R + 5} r={8} />
                <text className="badge-t" x={p.x + R - 5} y={p.y - R + 5}>✉</text>
              </>
            )}
            <text className="name" x={p.x} y={p.y + R + 15}>{short(p.n.name)}</text>
            <text className="stage" x={p.x} y={p.y + R + 29}>{short(p.n.label, 24)}</text>
          </g>
        ))}

        {hidden > 0 && <text className="hub-sub" x={CX} y={578}>+ {hidden} more not shown</text>}
      </svg>
      {nodes.length === 0 && <div className="eco-empty">{idle}</div>}
      <div className="eco-legend">
        <span><i style={{ background: "var(--warn)" }} />Ringing</span>
        <span><i style={{ background: "var(--accent)" }} />Talking</span>
        <span><i style={{ background: "var(--violet)" }} />Negotiating price</span>
        <span><i style={{ background: "var(--teal)" }} />Emailed</span>
        <span><i style={{ background: "var(--good)" }} />Got it</span>
        <span><i style={{ background: "var(--faint)" }} />Done / released</span>
      </div>
    </div>
  );
}
