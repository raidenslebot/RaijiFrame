/**
 * UNIVERSAL CAPABILITY, MADE COMPUTABLE.
 *
 * THE GAP THIS CLOSES
 * ───────────────────
 * Q2 scored every build against one target: 2,700 armour, health behind it, no
 * faction. A build tuned for that target is not a universal build, and the
 * objective could not tell the difference - which matters most for exactly the
 * two things this module's neighbours reward. `optimise.ts` derives a corrosive
 * strip and a viral multiplier from the build's own damage vector, and the
 * game halves BOTH somewhere:
 *
 *   viral      x0.5 against Infested Deimos and The Murmur
 *   corrosive  x0.5 against Sentient
 *
 * So the harder Q2 pushed a build toward the strip and the multiplier, the more
 * confidently it recommended something that falls over against two or three of
 * the factions a level-9999 player actually meets. The objective could not see
 * it because nothing in `src/data` carried the faction table.
 *
 * WHERE THE NUMBERS COME FROM
 * ───────────────────────────
 * `vendor/damage-factions.json`, captured off wiki.warframe.com's Damage page:
 * a 16 x 15 grid of `+`, blank and `-`. The magnitudes are the page's own
 * sentence, recorded at `docs/research/armour-and-status.md:499` - "Vulnerable
 * + = x1.5 and Resistant - = x0.5 incoming damage multiplier" - so nothing here
 * is interpolated: every cell is 1.5, 1 or 0.5 and there are 27, 188 and 10 of
 * them.
 *
 * It had to be read through a browser. `wiki.warframe.com` sits behind a
 * Cloudflare JS challenge and returns a 403 challenge page to `curl` on
 * `?action=raw`, on `api.php` and on the Fandom mirror alike - all three were
 * tried. `docs/DATA-SOURCES.md` already said so; this is the first thing in the
 * repo that needed it and got it anyway.
 *
 * WHY THE WORST CASE AND NOT AN AVERAGE
 * ─────────────────────────────────────
 * "Universal capability" has a precise meaning and it is not the mean. A build
 * that is devastating against Grineer and halved against the Murmur is a
 * Grineer build; averaging hides that behind the good half. The worst faction
 * is what a universal build is judged on, which makes this a maximin objective
 * - maximise the minimum - and that is the standard form of "works everywhere"
 * rather than "works somewhere".
 *
 * A consequence worth stating because it looks like a bug: a `+` cell CANNOT
 * raise the worst case, so vulnerabilities do not improve this figure. That is
 * correct. Being strong against one faction is a bonus and being weak against
 * one is a capability gap, and only the second is a fact about universality.
 * `bestFaction` exposes the other half for anything that wants to say it.
 */
import table from './vendor/damage-factions.json' with { type: 'json' };
import layers from './vendor/damage-health-types.json' with { type: 'json' };

export interface FactionRow {
  readonly [faction: string]: number;
}

/** Every faction the table names, in its own order. */
export const FACTIONS: readonly string[] = table.factions;
/** Every damage type it scores, lowercased to match the app's own vector. */
export const FACTION_TYPES: readonly string[] = table.types.map((t) => t.toLowerCase());

/** `type` -> `faction` -> multiplier, lowercased on both the app's axis and kept verbatim on the game's. */
const MATRIX: Record<string, FactionRow> = Object.fromEntries(
  Object.entries(table.matrix as Record<string, FactionRow>).map(([type, row]) => [type.toLowerCase(), row]),
);

export const VULNERABLE = table.vulnerable;
export const NEUTRAL = table.neutral;
export const RESISTANT = table.resistant;

/**
 * What one damage type does to one faction.
 *
 * A type the table does not name returns NEUTRAL rather than throwing. The
 * app's `DAMAGE_ORDER` carries six types the grid has no row for - shielddrain,
 * healthdrain, energydrain and the cinematic ones - and none of them is a
 * damage type an enemy resists; they are drains and script effects. Returning 1
 * is the honest reading, and `unknownTypes` below is what stops that from
 * silently absorbing a REAL type the table stopped naming.
 */
export function factionMultiplier(type: string, faction: string): number {
  return MATRIX[type.toLowerCase()]?.[faction] ?? NEUTRAL;
}

/** Types in a damage vector that the table has no row for - a drift alarm, not a filter. */
export function unknownTypes(damage: ReadonlyArray<{ type: string }>): string[] {
  return damage.map((d) => d.type.toLowerCase()).filter((t) => !(t in MATRIX));
}

/**
 * A build's effective multiplier against one faction: its damage vector
 * weighted by what that faction does to each part of it.
 *
 * Share-weighted rather than summed, so the result is a multiplier on the whole
 * figure and a weapon that is half corrosive against a corrosive-vulnerable
 * faction reads x1.25, not x1.5. A vector with no damage at all is x1 - there
 * is nothing to be resistant to.
 */
export function againstFaction(damage: ReadonlyArray<{ type: string; amount: number }>, faction: string): number {
  let total = 0;
  let weighted = 0;
  for (const d of damage) {
    const a = Math.max(0, d.amount);
    if (a === 0) continue;
    total += a;
    weighted += a * factionMultiplier(d.type, faction);
  }
  return total > 0 ? weighted / total : NEUTRAL;
}

/*
 * ── THE EXACT LAYER ────────────────────────────────────────────────────────
 *
 * The faction grid above is a SUMMARY. `Damage 2.0/Overview Table` is the thing
 * it summarises: 16 damage types against the 14 health types an enemy is
 * actually built from, with the game's own signed percentages rather than a
 * blanket +/-50 %. Corrosive is +75 % against Ferrite Armor and -50 % against
 * Proto Shield; slash is +50 % against Infested Flesh and -50 % against Alloy
 * Armor. Sixty-five non-zero cells.
 *
 * IT IS ALSO WHERE SHIELDS FINALLY ENTER THE MODEL. Q2 has always been a
 * question about health behind armour, and the objection to modelling shields
 * was that they are a separate POOL rather than a percentage - true, and beside
 * the point, because what a build needs to know is whether its damage is
 * PENALISED on the way through. This table says so exactly: puncture is -20 %
 * against Shield and -50 % against Proto Shield, magnetic is +75 % against
 * both, and toxin does not interact with either.
 *
 * A BYPASS IS SCORED AS NEUTRAL, deliberately and conservatively. The page
 * prints N/A in exactly four cells - toxin against both shields, true against
 * both armours - which means that damage skips the layer entirely and lands on
 * what is behind it. That is BETTER than neutral, and saying how much better
 * needs the pool sizes this app does not have. Scoring it as 1 never overstates
 * a build, which keeps Q2 the floor it has always been.
 */
export const HEALTH_TYPES: readonly string[] = layers.healthTypes;

const LAYERS: Record<string, Record<string, number | null>> = Object.fromEntries(
  Object.entries(layers.matrix as Record<string, Record<string, number | null>>).map(([type, row]) => [type.toLowerCase(), row]),
);

/** What one damage type does to one health layer: `1 + modifier`, or 1 where it bypasses. */
export function healthMultiplier(type: string, healthType: string): number {
  const mod = LAYERS[type.toLowerCase()]?.[healthType];
  if (mod === undefined || mod === null) return NEUTRAL;
  return 1 + mod;
}

/** A build's effective multiplier against one health layer, share-weighted like `againstFaction`. */
export function againstHealthType(damage: ReadonlyArray<{ type: string; amount: number }>, healthType: string): number {
  let total = 0;
  let weighted = 0;
  for (const d of damage) {
    const a = Math.max(0, d.amount);
    if (a === 0) continue;
    total += a;
    weighted += a * healthMultiplier(d.type, healthType);
  }
  return total > 0 ? weighted / total : NEUTRAL;
}

export interface FactionVerdict {
  /** The multiplier this build suffers against its WORST faction. The objective. */
  readonly worst: number;
  readonly worstFaction: string;
  /** The other half, for anything that wants to name a strength rather than a gap. */
  readonly best: number;
  readonly bestFaction: string;
}

/**
 * THE UNIVERSAL FIGURE: the multiplier the build carries against its weakest
 * matchup, and which faction that is.
 *
 * The faction is as much the point as the number. "Your build is at 0.83
 * against The Murmur" is something a player can act on - it names the element
 * to trade - where a lone 0.83 is a mark nobody can chase. This is the sort of
 * thing the brief means by knowing more than a human could: nobody carries a
 * 16 x 15 grid in their head, and nobody re-checks it every time they swap a
 * mod.
 */
/*
 * ── THE HOT PATH ───────────────────────────────────────────────────────────
 *
 * `universal` is called once per SCORED CANDIDATE, and the beam evaluates
 * thousands of them per plan. The straightforward version - loop 29 targets,
 * and inside each loop the damage vector doing a map lookup per entry - is
 * about 145 hash lookups and a closure allocation every call, and measured, it
 * DOUBLED the optimiser: the Braton's plan went 861 ms to 1,617 and the
 * Skiajati's 786 to 2,714. That is a real regression against a brief whose
 * first complaint is "slow, laggy, unoptimized".
 *
 * The arithmetic is linear in the damage shares, which is what makes it
 * avoidable rather than a cost of the feature:
 *
 *     against(target) = SUM over types of share(type) x mult(type, target)
 *
 * So each damage type's 29 multipliers are packed ONCE into a `Float64Array`
 * at module load, and a build is one pass over its own vector - at most six
 * entries - accumulating 29 multiply-adds each into a scratch buffer that is
 * reused rather than allocated. No hash lookups in the inner loop, no garbage,
 * and the result is identical to the loop it replaces: the gate asserts that
 * against the readable `againstFaction` and `againstHealthType` above, which
 * stay exactly as they were and are what the rest of the app reads.
 */
const TARGETS: readonly string[] = [...FACTIONS, ...HEALTH_TYPES];
const COLUMNS = new Map<string, Float64Array>();
for (const type of new Set([...Object.keys(MATRIX), ...Object.keys(LAYERS)])) {
  const col = new Float64Array(TARGETS.length);
  for (let i = 0; i < TARGETS.length; i++) {
    col[i] = i < FACTIONS.length ? factionMultiplier(type, TARGETS[i]!) : healthMultiplier(type, TARGETS[i]!);
  }
  COLUMNS.set(type, col);
}
/** Reused across calls: `universal` is synchronous and never re-entered. */
const SCRATCH = new Float64Array(TARGETS.length);

/**
 * THE UNIVERSAL FIGURE: the multiplier the build carries against its weakest
 * matchup, and which target that is.
 *
 * The target is as much the point as the number. "Your build is at 0.76
 * against Infested Deimos" is something a player can act on - it names the
 * element to trade - where a lone 0.76 is a mark nobody can chase. This is the
 * sort of thing the brief means by knowing more than a human could: nobody
 * carries a 16 x 15 and a 16 x 14 grid in their head, and nobody re-checks
 * them every time they swap a mod.
 */
export function universal(damage: ReadonlyArray<{ type: string; amount: number }>): FactionVerdict {
  SCRATCH.fill(0);
  let total = 0;
  for (const d of damage) {
    const a = d.amount > 0 ? d.amount : 0;
    if (a === 0) continue;
    total += a;
    const col = COLUMNS.get(d.type.toLowerCase());
    if (col === undefined) {
      // A drain or a script effect: no enemy resists it, so it weighs neutral.
      for (let i = 0; i < SCRATCH.length; i++) SCRATCH[i] = (SCRATCH[i] ?? 0) + a * NEUTRAL;
      continue;
    }
    for (let i = 0; i < SCRATCH.length; i++) SCRATCH[i] = (SCRATCH[i] ?? 0) + a * (col[i] ?? NEUTRAL);
  }
  if (total <= 0) {
    const only = TARGETS[0] ?? '';
    return { worst: NEUTRAL, worstFaction: only, best: NEUTRAL, bestFaction: only };
  }
  let worst = Infinity;
  let best = -Infinity;
  let wi = 0;
  let bi = 0;
  for (let i = 0; i < SCRATCH.length; i++) {
    const m = SCRATCH[i]! / total;
    if (m < worst) {
      worst = m;
      wi = i;
    }
    if (m > best) {
      best = m;
      bi = i;
    }
  }
  return { worst, worstFaction: TARGETS[wi] ?? '', best, bestFaction: TARGETS[bi] ?? '' };
}

