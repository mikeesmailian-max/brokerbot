// Client-safe formatting helpers (no server imports).
export const place = (city: string | null | undefined, state: string | null | undefined) =>
  [city, state].filter(Boolean).join(", ") || "—";
export const laneOf = (l: { origin_city: string | null; origin_state: string | null; dest_city: string | null; dest_state: string | null }) =>
  `${place(l.origin_city, l.origin_state)} → ${place(l.dest_city, l.dest_state)}`;
export const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
export const shortDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const t = new Date(d.length <= 10 ? d + "T12:00:00" : d);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};
export const timeAgo = (iso: string | null | undefined) => {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
};
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
