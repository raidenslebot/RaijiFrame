/**
 * WHICH POLARITIES TO FORMA, AND HOW FEW.
 *
 * The brief asks the overlay to take "future proofing and expandability" into
 * account and to show "what you need to do next to push the build past what you
 * currently are capable of doing". For a Warframe weapon that is almost always
 * one thing: a Forma. Capacity is finite, a matched polarity halves a mod's
 * drain, and a build that does not fit fits the moment the right slots carry the
 * right symbols.
 *
 * WHAT THIS ANSWERS, AND WHAT IT REFUSES TO
 * -----------------------------------------
 * It answers "how many Forma, and to which polarities" - a multiset question
 * with an exact answer. It does NOT answer "which physical slot", because the
 * index order of the game's grid is a named unknown: nothing in the log states
 * which position an installed mod occupies. A per-slot instruction would be a
 * guess wearing the clothes of a fact, and the player does not need one anyway:
 * they pick a slot in the game and the game asks which polarity.
 *
 * THE ARITHMETIC IS A DEFICIT, NOT A SEARCH
 * -----------------------------------------
 * Every mod in the build wants one slot of its own polarity. The grid supplies
 * some of them. A universal slot satisfies anything except Umbra - that is the
 * game's rule, in `slotDrain` - so universals are spent last and on whatever is
 * left. What the grid cannot supply is the deficit, and the deficit IS the
 * Forma count: one Forma turns one slot into one polarity.
 *
 * That is exact and it is minimal. No arrangement can need fewer Forma than the
 * number of demanded polarities the grid cannot cover, and assigning the
 * universals greedily to the largest deficits achieves it.
 */

import type { Polarity } from './modded';

export interface FormaPlan {
  /** How many slots must be re-polarised. Zero when the build already fits its grid. */
  count: number;
  /** How many of each polarity to Forma TO, largest first. */
  to: Array<{ polarity: Polarity; count: number }>;
  /** Mods whose polarity the grid already supplies, so nothing is spent on them. */
  alreadyMatched: number;
  /** Unpolarised slots the build leaves empty - room a later mod can use for free. */
  spare: number;
}

/**
 * What it would take for every mod in this build to sit in a matching slot.
 *
 * `wanted` is the build's mods' own polarities; `grid` is the slots the account
 * actually has. Both are multisets - two Madurai mods want two Madurai slots.
 */
export function formaPlan(wanted: readonly Polarity[], grid: readonly Polarity[]): FormaPlan {
  const need = new Map<Polarity, number>();
  for (const p of wanted) {
    if (p === 'none') continue; // a mod with no polarity is happy anywhere
    need.set(p, (need.get(p) ?? 0) + 1);
  }

  const have = new Map<Polarity, number>();
  for (const p of grid) have.set(p, (have.get(p) ?? 0) + 1);

  let matched = 0;
  for (const [p, n] of need) {
    const supplied = Math.min(n, have.get(p) ?? 0);
    matched += supplied;
    need.set(p, n - supplied);
    have.set(p, (have.get(p) ?? 0) - supplied);
  }

  /*
   * Universals cover anything but Umbra, and they are spent AFTER the exact
   * matches - spending one on a polarity the grid could already supply would
   * waste it and invent a Forma that is not needed. Largest deficit first, so a
   * scarce universal goes where it removes the most.
   */
  let universals = have.get('universal') ?? 0;
  const deficits = [...need.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  for (const entry of deficits) {
    if (universals <= 0) break;
    if (entry[0] === 'umbra') continue; // the one polarity a universal will not take
    const use = Math.min(entry[1], universals);
    universals -= use;
    entry[1] -= use;
    matched += use;
  }

  const to = deficits
    .filter(([, n]) => n > 0)
    .map(([polarity, count]) => ({ polarity, count }))
    .sort((a, b) => b.count - a.count || a.polarity.localeCompare(b.polarity));

  return {
    count: to.reduce((n, t) => n + t.count, 0),
    to,
    alreadyMatched: matched,
    /*
     * What is left over after the build is seated: unpolarised slots nobody
     * wanted. It is the "expandability" half of the question - room a future mod
     * can take without costing a Forma - and it is reported rather than used.
     */
    spare: (have.get('none') ?? 0) + universals,
  };
}

/** The plan in the overlay's few words. Empty string when there is nothing to do. */
export function formaText(plan: FormaPlan): string {
  if (plan.count === 0) return '';
  /*
   * A ONE is printed only when it stands with a number, and the reason is that
   * both readings are right in different places.
   *
   * "1 forma - naramon" is correct: a count of one beside the word would read as
   * a mod name ("1 Madurai"). But the player's own screen showed
   * "5 forma - 2 madurai, 2 naramon, umbra", and in a list of counted words an
   * uncounted one looks like a number that went missing, not like one of a kind.
   *
   * So: bare when nothing in the list is counted, counted when anything is.
   */
  return `${String(plan.count)} forma · ${formaPolarities(plan)}`;
}

/**
 * The polarity list alone, for a place that has already said the word "forma".
 *
 * Split out rather than sliced off the sentence above: a caller that wants half
 * of a display string and takes it with a regular expression has coupled itself
 * to the wording, and the wording is exactly what the comment above says is
 * allowed to change. Both callers now read the same rule about the lone one.
 */
export function formaPolarities(plan: FormaPlan): string {
  const counted = plan.to.some((t) => t.count > 1);
  return plan.to.map((t) => (t.count === 1 && !counted ? t.polarity : `${String(t.count)} ${t.polarity}`)).join(', ');
}
