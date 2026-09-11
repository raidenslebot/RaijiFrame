/**
 * WHICH SLOT EACH MOD IS IN, SOLVED FROM THE GAME'S OWN DUMP.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The overlay used to mark the game's own mod slots and that layer was deleted,
 * because nothing the app can read is known to be in the screen's order.
 * `docs/research/eelog-upgrade-screen.md` and five separate probes agree: the
 * log narrates every mod placed and never says WHERE, and the only slot numbers
 * in it are the arsenal's 0-3.
 *
 * But the game's own build dump carries two things that constrain each other,
 * and nothing in this app had ever tried to solve them against one another:
 *
 *   Slots:           AP_UNIVERSAL|AP_ATTACK|...   eleven polarities, IN INDEX ORDER
 *   Modded Capacity: 19|ModA-7|ModB-14            every mod with its
 *                                                 polarity-ADJUSTED drain
 *
 * A mod's adjusted drain is a known function of its base drain, its own
 * polarity and the SLOT's polarity - `slotDrain` in `modded.ts`, gated and
 * exact: a matching slot halves it rounded up, a universal slot halves anything
 * but umbra, a mismatched slot adds a quarter rounded half-up, and an
 * unpolarised slot leaves it alone. Run that backwards and an observed drain
 * excludes every slot polarity that could not have produced it.
 *
 * WHAT IT CAN AND CANNOT SETTLE, stated plainly because the difference is the
 * whole point:
 *
 *   IT CAN pin a mod to a slot INDEX whenever the drain admits one polarity and
 *   only one slot carries it. On a mixed grid that is most of the build.
 *
 *   IT CANNOT tell you where that index is on the SCREEN. Whether `Slots[i]` is
 *   the i-th card the game draws is the open question, and this module does not
 *   answer it - it makes the question answerable, because a solved index plus
 *   one screenshot settles it, where a screenshot alone settles nothing.
 *
 * So this is the half of the problem that is pure arithmetic, built now and
 * gated now, so that the moment a mixed-polarity dump exists there is nothing
 * left to write.
 */
import { slotDrain, type Polarity } from './modded.ts';

/** One installed mod as the dump states it: what it is, and what it actually cost. */
export interface DumpedMod {
  /** The catalogue path or name the dump printed. */
  readonly mod: string;
  /** The drain the game charged, AFTER the slot's polarity was applied. */
  readonly drain: number;
  /**
   * The mod's own polarity and its base drain at the rank it is installed at.
   * Both come from the catalogue, not from the dump - the dump states only the
   * adjusted figure, which is exactly why this has to be solved rather than read.
   */
  readonly polarity: Polarity;
  readonly baseDrain: number;
}

export interface SlotSolution {
  readonly mod: string;
  /** Every slot index whose polarity could have produced the observed drain. */
  readonly candidates: readonly number[];
  /** The index when exactly one survives, else null. */
  readonly slot: number | null;
}

/**
 * The slots a mod could be in, from what the game charged for it.
 *
 * A slot is possible when `slotDrain(base, slotPolarity, modPolarity)` equals
 * the observed drain. That is the forward rule this repo already gates; running
 * it over eleven slots and keeping the matches is the whole inverse.
 */
export function slotsFor(mod: DumpedMod, slots: readonly Polarity[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    if (slotDrain(mod.baseDrain, slots[i]!, mod.polarity) === mod.drain) out.push(i);
  }
  return out;
}

/**
 * THE ASSIGNMENT, with the constraint that makes it more than eleven independent
 * lookups: two mods cannot share a slot.
 *
 * Constraint propagation rather than a search, because the shape is small and
 * the answer must be explicable. Repeatedly: any mod with exactly one candidate
 * claims that slot, and every other mod loses it. Iterate until nothing
 * changes. What is left ambiguous is genuinely ambiguous - three madurai mods
 * in three madurai slots are indistinguishable by drain alone, and no amount of
 * arithmetic will separate them.
 *
 * Returning the candidate SETS rather than a guess is the point. A mod this
 * cannot place is reported unplaced, never assigned to whichever slot happened
 * to be free - that is the coincidence-placement that produced "a complete
 * disaster visually" the last time this layer existed.
 */
export function solveSlots(mods: readonly DumpedMod[], slots: readonly Polarity[]): SlotSolution[] {
  const candidates = mods.map((m) => new Set(slotsFor(m, slots)));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < candidates.length; i++) {
      const only = candidates[i]!;
      if (only.size !== 1) continue;
      const taken = [...only][0]!;
      for (let j = 0; j < candidates.length; j++) {
        if (j === i) continue;
        if (candidates[j]!.delete(taken)) changed = true;
      }
    }
  }
  return mods.map((m, i) => {
    const set = [...candidates[i]!].sort((a, b) => a - b);
    return { mod: m.mod, candidates: set, slot: set.length === 1 ? set[0]! : null };
  });
}

/** How much of a build a dump actually pins: the fraction with exactly one slot. */
export function pinnedFraction(solved: readonly SlotSolution[]): number {
  if (solved.length === 0) return 0;
  return solved.filter((s) => s.slot !== null).length / solved.length;
}
