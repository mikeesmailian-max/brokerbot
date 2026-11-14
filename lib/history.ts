import type { Carrier, Customer, CustomerHistory, Load } from "./types";
import { money, place } from "./repo";

const DAY = 86400000;

/** Study a customer's past loads: what they ship, how often, what it pays, and whether they're due. */
export function studyCustomer(customer: Customer, allLoads: Load[]): CustomerHistory {
  const loads = allLoads
    .filter((l) => l.customer_id === customer.id && l.status !== "cancelled" && l.status !== "draft")
    .sort((a, b) => dateOf(a) - dateOf(b));
  const rates = loads.map((l) => l.customer_rate).filter((r): r is number => r != null);
  const revenue = rates.reduce((a, b) => a + b, 0);

  const laneMap = new Map<string, { count: number; rates: number[] }>();
  const eqCount = new Map<string, number>();
  for (const l of loads) {
    const lane = `${place(l.origin_city, l.origin_state)} to ${place(l.dest_city, l.dest_state)}`;
    const e = laneMap.get(lane) ?? { count: 0, rates: [] as number[] };
    e.count++;
    if (l.customer_rate != null) e.rates.push(l.customer_rate);
    laneMap.set(lane, e);
    if (l.equipment) eqCount.set(l.equipment, (eqCount.get(l.equipment) ?? 0) + 1);
  }
  const top_lanes = [...laneMap.entries()]
    .map(([lane, v]) => ({ lane, count: v.count, avg_rate: v.rates.length ? avg(v.rates) : null }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  const top_equipment = [...eqCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const dates = loads.map(dateOf).filter((d) => d > 0);
  const last = dates.length ? dates[dates.length - 1] : null;
  const days_since_last = last ? Math.max(0, Math.round((Date.now() - last) / DAY)) : null;
  let avg_gap_days: number | null = null;
  if (dates.length >= 2) avg_gap_days = Math.max(1, Math.round((dates[dates.length - 1] - dates[0]) / DAY / (dates.length - 1)));

  // "Due" score: how far into their usual shipping rhythm they are.
  let due_score = 0;
  if (days_since_last != null) {
    if (avg_gap_days) {
      const ratio = days_since_last / avg_gap_days;
      due_score = ratio < 0.5 ? ratio * 60 : ratio <= 2.5 ? 55 + Math.min(ratio - 0.5, 1) * 45 : Math.max(35, 100 - (ratio - 2.5) * 20);
    } else {
      due_score = days_since_last >= 14 ? 55 : 30;
    }
    due_score = Math.round(Math.min(100, due_score + Math.min(loads.length, 10)));
  }

  const first = (customer.contact_name || "").split(" ")[0];
  let summary: string;
  if (!loads.length) {
    summary = `No past loads on file for ${customer.name}. This is an introduction call.`;
  } else {
    const t = top_lanes[0];
    const parts = [
      `${customer.name} has moved ${loads.length} load${loads.length === 1 ? "" : "s"} with us.`,
      `Most common lane: ${t.lane} (${t.count} load${t.count === 1 ? "" : "s"}${top_equipment ? ", usually " + top_equipment.toLowerCase() : ""}${t.avg_rate ? ", around " + money(t.avg_rate) : ""}).`,
    ];
    if (top_lanes[1]) parts.push(`Also ships ${top_lanes[1].lane}.`);
    if (days_since_last != null) parts.push(`Last shipment was ${days_since_last} day${days_since_last === 1 ? "" : "s"} ago.`);
    if (avg_gap_days) parts.push(`They usually ship about every ${avg_gap_days} days.`);
    if (first) parts.push(`Ask for ${first}.`);
    summary = parts.join(" ");
  }

  return {
    loads: loads.length,
    revenue,
    avg_rate: rates.length ? avg(rates) : null,
    last_ship: last ? new Date(last).toISOString().slice(0, 10) : null,
    days_since_last,
    avg_gap_days,
    top_lanes,
    top_equipment,
    due_score,
    summary,
  };
}

const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
const dateOf = (l: Load) => {
  const t = Date.parse(l.pickup_date || l.created_at);
  return Number.isNaN(t) ? 0 : t;
};

/** Rank carriers for a load so the best fits get dialled first. */
export function rankCarriers(load: Load, carriers: Carrier[], pastLoads: Load[]) {
  const norm = (s: string | null) => (s || "").toLowerCase();
  const eq = norm(load.equipment);
  return carriers
    .map((c) => {
      let score = 0;
      const why: string[] = [];
      if (eq && c.equipment_types.some((e) => norm(e) === eq || norm(e).includes(eq) || eq.includes(norm(e)))) {
        score += 40;
        why.push(`Runs ${load.equipment}`);
      } else if (c.equipment_types.length && eq) {
        score -= 25;
      }
      if (load.origin_state && c.home_state && norm(c.home_state) === norm(load.origin_state)) {
        score += 25;
        why.push(`Based in ${c.home_state}`);
      } else if (load.dest_state && c.home_state && norm(c.home_state) === norm(load.dest_state)) {
        score += 15;
        why.push(`Heads home to ${c.home_state}`);
      }
      const lanes = norm(c.preferred_lanes);
      if (lanes && [load.origin_state, load.dest_state, load.origin_city, load.dest_city].some((x) => x && lanes.includes(norm(x)))) {
        score += 15;
        why.push("Likes this lane");
      }
      const sameLane = pastLoads.filter(
        (l) =>
          l.covered_by_carrier_id === c.id &&
          norm(l.origin_state) === norm(load.origin_state) &&
          norm(l.dest_state) === norm(load.dest_state),
      ).length;
      if (sameLane) {
        score += 20;
        why.push(`Hauled this lane ${sameLane}×`);
      }
      if (c.loads_hauled) score += Math.min(c.loads_hauled, 10);
      return { carrier: c, score, why };
    })
    .sort((a, b) => b.score - a.score);
}
