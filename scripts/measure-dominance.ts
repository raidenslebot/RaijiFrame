/**
 * CAN THE SEARCH BE MADE EXHAUSTIVE AFTER ALL?
 *
 * The brief asks for "every single possible mod combination". The optimiser
 * runs a beam because choosing 8 of the Braton's 105 eligible mods is 3.5e11
 * sets. But most of those mods cannot be in ANY optimal build, and there is a
 * rule that says so without evaluating a single set:
 *
 *   A mod B is DOMINATED by a mod A when A costs no more drain and contributes
 *   at least as much to every bucket the objective reads. Swapping B for A can
 *   never make a build worse.
 *
 * Dominance alone does not let B be deleted - an optimal build might hold both
 * A and B. But the grid holds only EIGHT mods, so if at least eight distinct
 * mods dominate B, then any build containing B has at most seven others and one
 * of those eight dominators must be free to replace it. B can never be needed.
 *
 * That is a proof, not a heuristic. If it left a small enough pool, exhaustive
 * enumeration over that pool would BE the answer to "every single possible
 * combination", and the beam could go.
 *
 * IT DOES NOT WORK, AND THIS FILE EXISTS TO SAY SO.
 * ------------------------------------------------
 * Measured: the Braton's 105 eligible mods reduce to 67 that the objective can
 * read at all, and dominance removes exactly ONE of those. Broken War: 63 in,
 * 63 out, nothing removed. 5.7e9 sets of eight remain.
 *
 * The reason is not a bug in the rule - it is that the mods are genuinely
 * diverse. Dominance needs A to match B in EVERY bucket, and a damage mod and a
 * crit mod share no bucket, so neither dominates the other. Almost the only
 * pairs that dominate are a mod and its own weaker variant, and those are
 * already excluded by the family rule.
 *
 * So the beam is not a corner cut, it is a measured necessity, and the honest
 * claim about it is the one `check-optimise` proves: it matches exhaustive
 * enumeration wherever exhaustive enumeration is computable, and beats it where
 * ranking down matters. Do not try this again without a fundamentally different
 * bound - a per-bucket admissible over-estimate for branch-and-bound is the
 * next idea, and it is much harder to get provably right.
 *
 * Run: node scripts/measure-dominance.ts
 */
import { loadItemDb } from '../src/data/itemdb.ts';
import { loadModDb } from '../src/data/moddb.ts';
import { eligibleSlots, family, GRID_SLOTS } from '../src/data/optimise.ts';
import { drainAtRank } from '../src/data/modded.ts';
import type { ModRow } from '../src/data/moddb.ts';

const WEAPONS = [
  ['Braton', '/Lotus/Weapons/Tenno/Rifle/Rifle'],
  ['Broken War', '/Lotus/Weapons/Tenno/Melee/Swords/StalkerTwo/StalkerTwoSmallSword'],
] as const;

const items = await loadItemDb();
const mods = await loadModDb();

/**
 * The buckets the objective actually reads, as one vector per mod.
 *
 * Taken from the mod's own effects rather than from a scored build, because
 * dominance has to be a statement about the MOD - true whatever else is
 * installed - and a marginal gain measured against one partial build is not.
 *
 * Exactly the stat keys Q1 reads; anything else is invisible to the objective.
 */
const SCORED = new Set(['damage', 'multishot', 'critical chance', 'critical damage', 'fire rate', 'attack speed', 'reload speed', 'magazine capacity', 'melee damage']);

function buckets(row: ModRow, rank: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of row.effects) {
    if (e.rank !== rank || e.conditions.length > 0 || e.target !== 'self' || e.value === null) continue;
    // An effect the objective cannot read contributes nothing to a build, so it
    // must contribute nothing to dominance either. The first version of this
    // counted every stat and let Ammo Drum "survive" on a bucket Q1 never sees.
    const elemental = e.damageType !== undefined;
    if (!elemental && !SCORED.has(e.stat)) continue;
    const key = elemental ? `dmg:${e.damageType!.toLowerCase()}` : e.stat;
    out.set(key, (out.get(key) ?? 0) + e.value);
  }
  return out;
}

/** A dominates B: no more drain, and at least as much of everything B gives. */
function dominates(a: { drain: number; b: Map<string, number> }, b: { drain: number; b: Map<string, number> }): boolean {
  if (a.drain > b.drain) return false;
  for (const [k, v] of b.b) {
    if (v <= 0) continue; // a penalty on B is not something A must match
    if ((a.b.get(k) ?? 0) < v) return false;
  }
  // and A must give something, or "dominating" is vacuous
  return [...a.b.values()].some((v) => v > 0);
}

for (const [label, path] of WEAPONS) {
  const item = items.byType.get(path);
  if (!item) {
    console.log(`\n${label}: not in the catalogue`);
    continue;
  }
  const slots = eligibleSlots(item);
  const eligible = [...mods.byPath.values()].filter((m) => m.slot !== null && slots.has(m.slot) && m.ranks > 0 && !m.isAura);
  // A mod with no bucket the objective reads can never change any build's score.
  const scored = eligible.filter((r) => buckets(r, r.fusionLimit ?? r.ranks - 1).size > 0);

  const pool = scored.map((row) => {
    const rank = row.fusionLimit ?? row.ranks - 1;
    return { row, rank, drain: drainAtRank(row.baseDrain ?? 0, rank), b: buckets(row, rank), fam: family(row) };
  });

  /*
   * A mod survives unless at least GRID_SLOTS OTHER mods, of other families,
   * dominate it. Same-family dominators do not count: they can never sit beside
   * it, so they cannot be the one that replaces it in a build that holds it.
   */
  const survivors = pool.filter((b) => {
    let n = 0;
    for (const a of pool) {
      if (a === b || a.fam === b.fam) continue;
      if (dominates(a, b)) n++;
      if (n >= GRID_SLOTS) return false;
    }
    return true;
  });

  const choose = (n: number, k: number) => {
    let r = 1;
    for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
    return r;
  };
  console.log(`\n${label}`);
  console.log(`  eligible ${String(eligible.length)}  ·  contributes something ${String(scored.length)}  ·  survives dominance ${String(survivors.length)}`);
  console.log(`  sets of 8 before: ${choose(scored.length, 8).toExponential(2)}   after: ${choose(survivors.length, 8).toExponential(2)}`);
  const removed = scored.length - survivors.length;
  console.log(`  dominance removed ${String(removed)} of ${String(scored.length)} - ${removed <= 2 ? 'not nearly enough to enumerate' : 'worth pursuing'}`);
}

console.log('\nThe rule is correct and the pruning is negligible: a damage mod and a crit mod');
console.log('share no bucket, so neither dominates the other, and almost the only pairs that');
console.log('do are a mod and its own weaker variant - which the family rule already excludes.');
console.log('The beam stays, and check-optimise holds what can honestly be claimed for it.');
