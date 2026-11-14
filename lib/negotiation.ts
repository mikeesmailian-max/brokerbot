import type { Call, Load } from "./types";

export type Decision =
  | { decision: "accepted"; rate: number }
  | { decision: "counter"; offer: number }
  | { decision: "final"; offer: number };

const round25 = (n: number) => Math.round(n / 25) * 25;

/**
 * The ladder we climb from the opening offer to the ceiling.
 * The ceiling is only ever spoken once we are standing on it.
 */
export function ladder(load: Pick<Load, "target_rate" | "max_rate">): number[] {
  const max = load.max_rate ?? load.target_rate ?? 0;
  const start = Math.min(load.target_rate ?? max, max);
  const span = max - start;
  const steps = [start, round25(start + span * 0.45), round25(start + span * 0.78), max];
  return steps.map((s) => Math.min(Math.max(s, start), max));
}

/**
 * Decide how to answer a carrier's asking price.
 *  fast     – take anything at or under the ceiling right away (cover it now).
 *  balanced – step up the ladder; take any ask that lands at or under our next step.
 *  firm     – make them work for every step; only take an ask at or under what we already offered,
 *             or anything under the ceiling once the ladder is used up.
 */
export function decide(load: Load, call: Pick<Call, "rounds" | "last_offer">, ask: number): Decision {
  const steps = ladder(load);
  const max = steps[3];
  const current = call.last_offer ?? steps[0];
  const nextIdx = Math.min(call.rounds + 1, 3);
  const next = Math.max(steps[nextIdx], current);

  if (ask <= current) return { decision: "accepted", rate: ask };

  if (ask <= max) {
    if (load.negotiation_style === "fast") return { decision: "accepted", rate: ask };
    if (load.negotiation_style === "balanced" && ask <= next) return { decision: "accepted", rate: ask };
    if (current >= max || call.rounds >= 3) return { decision: "accepted", rate: ask };
    // Meet in the middle rather than jumping straight to their number.
    const offer = load.negotiation_style === "firm" ? next : Math.min(next, round25((current + ask) / 2) || next);
    if (offer >= ask) return { decision: "accepted", rate: ask };
    return { decision: "counter", offer: Math.max(offer, current) };
  }

  // They are above our ceiling.
  if (next >= max) return { decision: "final", offer: max };
  return { decision: "counter", offer: next };
}
