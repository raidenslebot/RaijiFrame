/**
 * Self-check for the optimiser.
 *
 * Runs on the REAL exports - Mods.json through the catalogue's own parser and
 * Primary.json through the item catalogue's - cached under
 * node_modules/.cache/wfcd/ and downloaded there on first run. With neither
 * cache nor network it prints one SKIP line and exits 0.
 *
 * What is asserted is what an optimiser can get wrong without throwing: that
 * it picks the real Serration and never a Flawed or phantom variant, that the
 * beam finds what exhaustive enumeration finds on a catalogue small enough to
 * enumerate, that capacity is respected after the rank-down pass, that an
 * account owning nothing gets an empty build and not a guessed one, that the
 * acquisition list is ordered by measured gain, and that every ASSUMED rule
 * travels with the result.
 *
 * Run: node scripts/check-optimise.ts
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseModsJson, MODS_URL } from '../src/data/moddb.ts';
import { ITEM_CATEGORIES, parseWfcd, type ItemDbEntry } from '../src/data/itemdb.ts';
import { ASSUMPTIONS, assign, BEAM, CAP_REACHING_BASE_ARMOUR, GRID_ASSUMPTION, ladder, questionFor, Q2_TARGET_ARMOUR, Q2_TARGET_LEVEL, assumptionsFor, drainOf, eligibleSlots, family, FRAME_ASSUMPTIONS, GRID_SLOTS, nearestWall, plan, preferable, score, scoredEffects, search, slotPlanFor, uncountedAttacks, type Candidate, type Rung } from '../src/data/optimise.ts';
import { drainAtRank, type Polarity } from '../src/data/modded.ts';
import { ARMOUR_CAP, CORROSIVE_MAX_STRIP, HEAT_MAX_STRIP, VIRAL_MAX_STACKS, armourAtLevel, combinedStrip, enemyDamageMultiplier, netArmour, viralMultiplier } from '../src/data/armour.ts';
import { routeTo } from '../src/data/acquire.ts';
import { universal } from '../src/data/factions.ts';

const CACHE = new URL('../node_modules/.cache/wfcd/', import.meta.url);
const WFCD_JSON = 'https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/';
const PRIMARY_URL = `${WFCD_JSON}Primary.json`;
const FRAMES_URL = `${WFCD_JSON}Warframes.json`;
const MELEE_URL = `${WFCD_JSON}Melee.json`;

async function cached(name: string, url: string): Promise<string | null> {
  const file = new URL(name, CACHE);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = await res.text();
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, body);
    return body;
  } catch {
    return null;
  }
}

let checks = 0;
let failures = 0;
function ok(label: string, fn: () => void): void {
  checks++;
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${label}\n        ${(err as Error).message.split('\n')[0]}`);
  }
}

const mods = await cached('Mods.json', MODS_URL);
const primary = await cached('Primary.json', PRIMARY_URL);
const frames = await cached('Warframes.json', FRAMES_URL);
const melees = await cached('Melee.json', MELEE_URL);
if (!mods || !primary || !frames || !melees) {
  console.log('  SKIP  Mods.json / Primary.json / Warframes.json / Melee.json unavailable (offline, no cache)');
  process.exit(0);
}

const db = parseModsJson(mods);
const catalogue = [...db.byPath.values()];
const weapons = parseWfcd('Primary', primary);
// The Braton's export path is `/Rifle/Rifle` - the first rifle - not `/Rifle/Braton`; the
// older itemdb fixture's `/Rifle/Braton` is a hand-written path and matches no real row.
const braton = weapons.find((w) => w.uniqueName === '/Lotus/Weapons/Tenno/Rifle/Rifle');
assert.ok(braton && braton.name === 'Braton', 'the export carries the Braton at /Lotus/Weapons/Tenno/Rifle/Rifle');
const item: ItemDbEntry = braton;

const everything = new Map<string, number>();
for (const r of catalogue) everything.set(r.uniqueName, r.fusionLimit ?? Math.max(0, r.ranks - 1));

// A rank-30 Braton with a catalyst and no Forma: 60 capacity, every slot unpolarised.
const { plan: slots, assumed } = slotPlanFor({ rank: 30, maxRank: 30, masteryRank: 20, catalyst: true, stanceBonus: null, gridPolarities: [] });

console.log('\nthe real catalogue on a real rifle');

const result = plan({ item, catalogue, owned: everything, slots });

ok('eligibility: Rifle takes Rifle, PRIMARY and Assault Rifle mods and its own augments; never Shotgun or Pistol', () => {
  const s = eligibleSlots(item);
  assert.ok(s.has('Rifle') && s.has('PRIMARY'));
  assert.ok(!s.has('Shotgun') && !s.has('Pistol') && !s.has('Melee'));
});

ok('the Ideal build carries the REAL Serration at +165, never the Flawed row and never a phantom', () => {
  const serration = result.ideal.placed.find((p) => p.name === 'Serration');
  assert.ok(serration, `Serration is in the Ideal build: ${result.ideal.placed.map((p) => p.name).join(', ')}`);
  assert.equal(serration.path, '/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod');
  assert.equal(serration.rank, 10);
  for (const p of result.ideal.placed) {
    assert.ok(!p.name.startsWith('Flawed '), `${p.name} is a Flawed variant`);
    assert.ok(!/Intermediate$|Expert$/.test(p.path) || /Primed|Galvanized/.test(p.name), `${p.path} is a phantom`);
  }
});

ok('the Ideal build fits the capacity it was given, spends nearly all of it, and beats the bare weapon several times over', () => {
  assert.ok(result.ideal.fits, `drain ${result.ideal.drain} over capacity ${result.ideal.capacity}`);
  // Sixty unpolarised points hold about five ranked-up mods (the first run: Primed Cryo Rounds 10,
  // Serration 10, Heavy Caliber ranked DOWN to 7, Vigilante Armaments 5, Vile Acceleration 4 = 60/60).
  // A first draft of this check demanded six and was wrong; the capacity was right.
  assert.ok(result.ideal.placed.length >= 4, `only ${result.ideal.placed.length} mods placed`);
  assert.ok(result.ideal.drain >= result.ideal.capacity - 3, `left ${result.ideal.capacity - result.ideal.drain} points unspent`);
  const bare = score(item, []);
  assert.ok(result.ideal.score.value > bare.score.value * 5, `ideal ${result.ideal.score.value} vs bare ${bare.score.value}`);
});

ok('no two placed mods share a family (one Serration variant, one crit-chance variant)', () => {
  const fams = result.ideal.placed.map((p) => family({ name: p.name }));
  assert.equal(new Set(fams).size, fams.length, fams.join(', '));
});

ok('every result carries the assumed rules, and the slot plan names what it could not read', () => {
  assert.equal(result.ideal.assumptions, ASSUMPTIONS);
  assert.equal(result.ideal.question, 'Q1');
  assert.deepEqual(assumed, []);
  const blind = slotPlanFor({ rank: null, maxRank: 30, masteryRank: 20, catalyst: null, stanceBonus: null, gridPolarities: null });
  assert.equal(blind.assumed.length, 3);
});

ok('an account that owns nothing gets an empty Now build - not a guessed one - and the acquisition list starts with the biggest gain', () => {
  const nothing = plan({ item, catalogue, owned: new Map(), slots });
  assert.deepEqual(nothing.now.placed, []);
  /*
   * SIX WAS THE GRID SIZE WHEN THIS WAS WRITTEN, and the grid is eight. The
   * bound belongs to the constant rather than to a number somebody typed, so
   * it moves when the grid moves - which is what a plan for an empty account
   * is: one instruction per slot it could fill.
   */
  assert.ok(nothing.next.length > 0 && nothing.next.length <= GRID_SLOTS, `next has ${String(nothing.next.length)} entries against a grid of ${String(GRID_SLOTS)}`);
  for (let i = 1; i < nothing.next.length; i++) assert.ok(nothing.next[i - 1]!.gain >= nothing.next[i]!.gain, 'next is not ordered by gain');
  assert.ok(nothing.next.every((n) => n.ownedRank === null));
  assert.equal(nothing.next[0]?.name, 'Serration', `the first thing to get on a bare Braton is Serration, not ${nothing.next[0]?.name}`);
});

ok('a partial account: Now uses only owned mods at owned ranks, and Next names the under-ranked one', () => {
  const owned = new Map<string, number>([
    ['/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod', 5],
    ['/Lotus/Upgrades/Mods/Rifle/WeaponFireIterationsMod', 5],
  ]);
  const partial = plan({ item, catalogue, owned, slots });
  assert.equal(partial.now.placed.length, 2);
  assert.ok(partial.now.placed.every((p) => owned.has(p.path) && p.rank === 5));
  const serration = partial.next.find((n) => n.path === '/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod');
  assert.ok(serration && serration.ownedRank === 5 && serration.targetRank === 10, 'Serration 5 -> 10 is a next step');
});

ok('the beam agrees with exhaustive enumeration on a catalogue small enough to enumerate', () => {
  const small = result.ideal.placed
    .slice(0, 6)
    .map((p) => catalogue.find((r) => r.uniqueName === p.path)!)
    .filter(Boolean);
  const pool: Candidate[] = small.map((r) => {
    const rank = r.fusionLimit ?? r.ranks - 1;
    return { row: r, rank, polarity: 'none', drain: drainAtRank(r.baseDrain ?? 0, rank) };
  });
  const tight = { grid: [] as never[], capacity: 30 }; // too small for all six at max rank: the search must choose
  const beam = search('Q1', item, pool, tight);
  let best = -1;
  for (let mask = 0; mask < 1 << pool.length; mask++) {
    const set = pool.filter((_, i) => mask & (1 << i));
    if (assign(set, tight.grid).drain > tight.capacity) continue;
    const v = score(item, set.map((c) => ({ row: c.row, rank: c.rank }))).score.value;
    if (v > best) best = v;
  }
  assert.ok(beam.fits);
  // The beam may ALSO rank mods down, which enumeration at max rank cannot, so it may do better; never worse.
  assert.ok(beam.score.value >= best - 1e-9, `beam ${beam.score.value} < exhaustive ${best}`);
});

ok('the same input gives the same answer twice', () => {
  const again = plan({ item, catalogue, owned: everything, slots });
  assert.deepEqual(
    again.ideal.placed.map((p) => [p.path, p.rank]),
    result.ideal.placed.map((p) => [p.path, p.rank]),
  );
});

// ---------------------------------------------------------------------------
// The beam, and the invariants of the rifle section
// ---------------------------------------------------------------------------

/** `fusionLimit` when the catalogue states one, otherwise the last rank the row has. */
const maxRankOf = (r: { fusionLimit: number | null; ranks: number }): number => r.fusionLimit ?? r.ranks - 1;

/**
 * A count quoted in a shipped sentence, matched as a WHOLE number.
 *
 * `line.includes(String(n))` was the first version and it is a bound loose
 * enough to pass the defect: "116" contains "11", "16", "1" and "6", so four
 * different wrong counts would all have satisfied a sentence that had gone
 * stale. The lookarounds are what make the match a claim about the number
 * rather than about its digits.
 */
const carriesCount = (line: string, n: number): boolean => new RegExp(`(?<!\\d)${String(n)}(?!\\d)`).test(line);

/*
 * `prepare`'s eligibility filter, which the module does not export.
 *
 * This is the only place in this file that restates a rule from `optimise.ts`,
 * and it is restated rather than imported because every gate below has to
 * measure the SAME pool the search sees. If the two ever drift, the gates start
 * asserting things about a pool the optimiser would never be given, which is a
 * quieter failure than any of the ones they are here to catch - so the pools
 * they build are cross-checked against real `plan` output wherever a gate can.
 */
function eligibleScored(entry: ItemDbEntry, question: 'Q1' | 'Q2' | 'Q3') {
  const accepts = eligibleSlots(entry);
  return catalogue.filter(
    (r) => r.slot !== null && accepts.has(r.slot) && r.ranks > 0 && !r.isAura && !r.isFlawed && r.effects.some((e) => scoredEffects(r, e.rank, question).used.length > 0),
  );
}

/*
 * FOURTEEN REAL RIFLE MODS, CHOSEN BY MEASUREMENT AND NEVER BY HAND.
 *
 * The two gates below are the only evidence in this repo that the beam finds
 * what the optimum actually is, and that evidence is worth exactly as much as
 * the pool is hard. Fourteen is the largest pool a 2^n enumeration can walk
 * without becoming the slowest thing in this file, and the fourteen are the
 * highest-scoring eligible rifle mods under Q1 rather than a hand-written list -
 * so nothing here is invented and the pool follows the catalogue when it moves.
 *
 * Two of the fourteen collide by family, which is deliberate: a comparison in
 * which the family rule never bites would not be comparing like with like, as
 * the enumeration is free to break a rule the beam obeys. Measured on the
 * current catalogue the two colliding families are `serration` (Serration with
 * Amalgam Serration) and `cryo rounds` (Cryo Rounds with Primed Cryo Rounds).
 * Split Chamber and Galvanized Chamber do NOT collide and never did - `family`
 * strips the `Galvanized ` prefix and leaves `chamber` against `split chamber`.
 *
 * Ties are broken by uniqueName because four elemental mods score identically
 * at +90 % (Stormbringer, Hellfire, Cryo Rounds, Infected Clip, all at 314.04)
 * and an unstable order would make the whole comparison flap between runs - the
 * one thing a gate must never do.
 *
 * Every candidate is unpolarised, exactly as the surviving six-mod gate builds
 * its pool. That is a fixture decision and not a claim about the catalogue: the
 * beam and the enumeration must face the same grid, and polarity is the subject
 * of its own gate further down.
 */
const RIFLE_POOL: Candidate[] = eligibleScored(item, 'Q1')
  .map((row) => ({ row, rank: maxRankOf(row), solo: score(item, [{ row, rank: maxRankOf(row) }]).score.value }))
  .sort((a, b) => b.solo - a.solo || (a.row.uniqueName < b.row.uniqueName ? -1 : 1))
  .slice(0, 14)
  .map(({ row, rank }): Candidate => ({ row, rank, polarity: 'none', drain: drainAtRank(row.baseDrain ?? 0, rank) }));

const RIFLE_FAMILIES = RIFLE_POOL.map((c) => family(c.row));

/*
 * Every set of those fourteen the GRID could legally hold: no two mods of one
 * family, and never more than `GRID_SLOTS` of them. Capacity is not applied
 * here because the two gates ask about different capacities over the same sets.
 *
 * Measured: 16,384 masks collapse to 8,277 legal sets, scored once and reused.
 * Scoring them all takes about 45 ms; doing it per gate per capacity would not.
 */
const RIFLE_SETS: Candidate[][] = [];
for (let mask = 0; mask < 1 << RIFLE_POOL.length; mask++) {
  const set: Candidate[] = [];
  const seenFamilies = new Set<string>();
  let legal = true;
  for (let i = 0; i < RIFLE_POOL.length && legal; i++) {
    if ((mask & (1 << i)) === 0) continue;
    if (seenFamilies.has(RIFLE_FAMILIES[i]!)) legal = false;
    else {
      seenFamilies.add(RIFLE_FAMILIES[i]!);
      set.push(RIFLE_POOL[i]!);
    }
  }
  if (legal && set.length <= GRID_SLOTS) RIFLE_SETS.push(set);
}
const RIFLE_SET_DRAIN = RIFLE_SETS.map((s) => assign(s, []).drain);
const RIFLE_SET_VALUE = RIFLE_SETS.map((s) => score(item, s.map((c) => ({ row: c.row, rank: c.rank }))).score.value);

/** The best legal set at a capacity, and how many sets that capacity left standing. */
function bestEnumerated(capacity: number): { value: number; fitting: number } {
  let value = -1;
  let fitting = 0;
  for (let i = 0; i < RIFLE_SETS.length; i++) {
    if (RIFLE_SET_DRAIN[i]! > capacity) continue;
    fitting++;
    if (RIFLE_SET_VALUE[i]! > value) value = RIFLE_SET_VALUE[i]!;
  }
  return { value, fitting };
}

/*
 * THE WEAPON THE MODULE ITSELF WAS DEBUGGED AGAINST.
 *
 * `optimise.ts` cites a Skiajati at capacity 50 - "ideal 3,377 against a
 * ceiling of 3,231" - as the measurement that forced the ceiling to be the
 * better of its two passes. It is also the umbra katana, and Sacrificial Steel
 * - one of the only two umbra-polarity melee mods in the game, the other being
 * Sacrificial Pressure, which no build here reaches for - is what its ceiling
 * takes, which is what makes the polarity gate below exercise the umbra branch
 * on a real build rather than a hypothetical one.
 *
 * The slot plan is the Braton's, reused: a slot plan is capacity and
 * polarities, not a property of the weapon, and sixty unpolarised points is the
 * same honest starting grid on either.
 *
 * Ownership is EMPTY on purpose. `ideal` and `ceiling` are searched over the
 * catalogue pool and do not depend on what is owned, so this one plan serves
 * both the scale gates and the polarity gate - and an empty account is the only
 * way `next` comes back with anything in it to compare an ordering against.
 */
const meleeWeapons = parseWfcd('Melee', melees);
const skiajati = meleeWeapons.find((w) => w.uniqueName === '/Lotus/Weapons/Tenno/Melee/Swords/UmbraKatana/UmbraKatana');
assert.ok(skiajati && skiajati.name === 'Skiajati', 'the export carries the Skiajati at /Lotus/Weapons/Tenno/Melee/Swords/UmbraKatana/UmbraKatana');
const melee: ItemDbEntry = skiajati;
const MELEE_QUESTION = questionFor(melee);
const meleePlan = plan({ item: melee, catalogue, owned: new Map(), slots, question: MELEE_QUESTION });

/** A copy of an item with its whole damage vector multiplied - nothing else touched. */
function scaledBy(entry: ItemDbEntry, factor: number): ItemDbEntry {
  return {
    ...entry,
    damagePerShot: entry.damagePerShot?.map((v) => v * factor),
    totalDamage: entry.totalDamage === undefined ? undefined : entry.totalDamage * factor,
  };
}

/*
 * THE FINEST GRAIN A RANKING HAS: every mod the question scores, on its own.
 *
 * A build comparison can agree by luck - two different weapons can want the
 * same eight mods for entirely different reasons. Comparing every single-mod
 * build instead asserts the property the ranking claim actually rests on, which
 * is that the objective is homogeneous of degree one in the weapon's damage:
 * scale the weapon by k and every candidate's value scales by exactly k, so no
 * two candidates can swap places whatever k is.
 *
 * Returns the worst RELATIVE deviation from an exact factor, so the caller can
 * assert against a tolerance rather than against floating-point equality.
 */
function soloScaleDeviation(entry: ItemDbEntry, factor: number, question: 'Q1' | 'Q2'): { worst: number; mods: number; moved: string[] } {
  const rows = eligibleScored(entry, question);
  const scaled = scaledBy(entry, factor);
  let worst = 0;
  const moved: string[] = [];
  for (const row of rows) {
    const rank = maxRankOf(row);
    const a = score(entry, [{ row, rank }], question).score;
    const b = score(scaled, [{ row, rank }], question).score;
    const rel = Math.abs(b.value - factor * a.value) / Math.max(Number.MIN_VALUE, Math.abs(b.value));
    if (rel > worst) worst = rel;
    // A DAMAGE scale must not move a single figure that is not damage. Crit,
    // rate, magazine and reload are read off the item and modded independently,
    // so any of them moving means the scale leaked somewhere it does not belong.
    if (a.critChance !== b.critChance || a.critDamage !== b.critDamage || a.fireRate !== b.fireRate || a.magazine !== b.magazine || a.reload !== b.reload || a.pellets !== b.pellets) moved.push(row.name);
  }
  return { worst, mods: rows.length, moved };
}

ok('the beam never loses to exhaustive enumeration over 16,384 legal sets, at two capacities', () => {
  /*
   * The surviving six-mod gate proves the beam is not obviously broken on 64
   * sets at one capacity. That is a weaker statement than it reads as: with six
   * mods the beam's width of 200 exceeds the entire search space, so it IS
   * exhaustive there and the comparison cannot fail. Fourteen mods is the first
   * size at which the beam has to throw candidates away - C(14,7) is 3,432
   * against a width of 200 - so this is the first version of the check where
   * the beam being a heuristic is actually on trial.
   *
   * Two capacities, because a beam can be right at one and wrong at the next:
   * the tight one has the optimum at two mods, the roomier one at four, and the
   * mistake a truncating beam makes is losing the second-best partial set that
   * the best complete set is built from.
   *
   * Measured on the current catalogue: at 30 the beam returns 1,154.36 and
   * enumeration 1,154.36; at 48 both return 2,365.41. It matches the true
   * optimum exactly at both. The assertion is the weaker `>=` because the beam
   * is allowed to rank mods down and enumeration at max rank is not - which is
   * the next gate's subject, not a licence for this one to lose.
   *
   * `BEAM = 1` is the sabotage: measured, it returns 1,025.70 at capacity 30
   * against the optimum's 1,154.36.
   */
  assert.equal(1 << RIFLE_POOL.length, 16384, `the pool is ${String(RIFLE_POOL.length)} mods, so this no longer enumerates 16,384 sets`);
  assert.ok(RIFLE_SETS.length > 1000 && RIFLE_SETS.length < 1 << RIFLE_POOL.length, `${String(RIFLE_SETS.length)} legal sets: the family and grid rules must cut the 16,384 masks down, and must not cut them to nothing`);

  for (const capacity of [30, 48]) {
    const exhaustive = bestEnumerated(capacity);
    /*
     * A capacity that binds nothing makes the whole comparison vacuous: every
     * set fits, the enumeration is a max over the pool, and the beam cannot be
     * wrong. Both capacities have to actually refuse sets.
     *
     * Only the upper half of this can fail - the EMPTY set is one of the 8,277
     * and fits any capacity - so `fitting` is compared against the number of
     * sets that carry a mod rather than against zero.
     */
    assert.ok(exhaustive.fitting > 1 && exhaustive.fitting < RIFLE_SETS.length, `capacity ${String(capacity)} left ${String(exhaustive.fitting)} of ${String(RIFLE_SETS.length)} sets standing: it must bind, and must not bind everything`);
    assert.ok(exhaustive.value > score(item, []).score.value, `enumeration at capacity ${String(capacity)} found nothing better than the bare weapon`);

    const beam = search('Q1', item, RIFLE_POOL, { grid: [] as never[], capacity });
    assert.ok(beam.fits, `the beam returned a build of ${String(beam.drain)} against capacity ${String(capacity)}`);
    assert.ok(
      beam.score.value >= exhaustive.value - 1e-9,
      `at capacity ${String(capacity)} the beam scored ${beam.score.value.toFixed(3)} and exhaustive enumeration over ${String(exhaustive.fitting)} legal sets found ${exhaustive.value.toFixed(3)}: the beam is losing builds a player could assemble`,
    );
  }
});

ok('and at a loose capacity it BEATS enumeration, because it may rank a mod down to fit', () => {
  /*
   * THE GATE ABOVE CANNOT TELL A BEAM FROM A LOOKUP TABLE, and this one can.
   *
   * `>=` is satisfied by a search that never ranks anything down, so the whole
   * rank-down pass - the most expensive part of the module and the one with a
   * hard-won bound on it (`RANK_DOWN_TRIES`, added after the gate's own fifteen
   * searches took 39 s) - could be deleted and every assertion above would
   * still pass. This asserts the pass earns its place: at the Braton's real
   * capacity there is a build that no set of max-rank mods can reach.
   *
   * Measured: the beam returns 3,434.76 against enumeration's 3,162.41. The
   * winning build is Primed Cryo Rounds 10, Heavy Caliber 9, Split Chamber 5
   * and Serration 10 - 60 of 60 - and the same four mods at max rank drain 61,
   * so the set the beam won with is one enumeration is not allowed to hold. The
   * last assertion is the one that makes this a statement about the MECHANISM
   * rather than about a lucky number: the beat exists because a mod came down a
   * rank, not because the enumeration was built wrong.
   */
  const capacity = slots.capacity; // the Braton's own 60: rank 30, catalyst, no Forma
  const exhaustive = bestEnumerated(capacity);
  const beam = search('Q1', item, RIFLE_POOL, { grid: [] as never[], capacity });

  assert.ok(beam.fits, `the beam returned a build of ${String(beam.drain)} against capacity ${String(capacity)}`);
  assert.ok(
    beam.score.value > exhaustive.value + 1e-9,
    `the beam scored ${beam.score.value.toFixed(3)} and enumeration ${exhaustive.value.toFixed(3)}: at a capacity this loose the beam should be finding a ranked-down build enumeration cannot express, and it is not`,
  );

  const rankedDown = beam.placed.filter((p) => p.rank < p.maxRank);
  assert.ok(rankedDown.length > 0, `the beam beat enumeration without ranking anything down: ${beam.placed.map((p) => `${p.name} ${String(p.rank)}/${String(p.maxRank)}`).join(', ')}`);

  const atMax: Candidate[] = beam.placed.map((p) => {
    const row = db.byPath.get(p.path)!;
    const rank = maxRankOf(row);
    return { row, rank, polarity: 'none', drain: drainAtRank(row.baseDrain ?? 0, rank) };
  });
  assert.ok(
    assign(atMax, []).drain > capacity,
    `the winning set drains ${String(assign(atMax, []).drain)} at max rank, which fits ${String(capacity)}: then ranking down bought nothing and the beat came from somewhere this gate is not looking`,
  );
});

ok('the melee halving changes no ranking UNDER THE QUESTION THE APP ACTUALLY ASKS', () => {
  /*
   * THE CLAIM SHIPS TO THE PLAYER, AND IT WAS WRITTEN UNDER A DIFFERENT QUESTION.
   *
   * `ASSUMPTIONS` tells the player that melee damage per second is half the
   * figure the game prints and that "rankings are unaffected because the factor
   * is a uniform scale". That sentence was written when Q1 was the only
   * question, and Q1 is a product of terms in which a uniform scale is obviously
   * uniform. Q2 is not obviously anything: it mitigates the direct term through
   * armour, adds bleed, ignite and poison ticks taken from a modded BASE, strips
   * armour from the build's own proc rate, and multiplies the lot by viral. Any
   * one of those terms failing to scale would move an ordering, and nothing
   * would say so.
   *
   * So the first assertion is that Q2 is still the question being asked. If the
   * app ever routes a melee somewhere else, this gate fails and the shipped
   * sentence gets re-derived under the new question instead of being inherited.
   *
   * Measured across all 52 mods Q2 scores on the Skiajati: the worst relative
   * deviation from an exact factor of two is 0. Not "small" - zero. The
   * quantisation step is `baseTotal / 32`, so it scales with the vector it
   * quantises and the rounding lands on the same 32nd either way.
   */
  assert.equal(MELEE_QUESTION, 'Q2', `a melee weapon is now asked ${MELEE_QUESTION}: the uniform-scale claim in ASSUMPTIONS was derived under Q2 and has to be re-derived here before it can be shipped again`);
  assert.ok(melee.damagePerShot && melee.damagePerShot.some((v) => v > 0), 'the melee fixture has no damage vector to halve');

  const half = scaledBy(melee, 0.5);
  const solo = soloScaleDeviation(melee, 0.5, 'Q2');
  assert.ok(solo.mods > 20, `only ${String(solo.mods)} mods are scored on this weapon: too few for the ordering claim to mean anything`);
  assert.ok(solo.worst < 1e-12, `halving the weapon moved a mod's value off an exact factor of two by ${solo.worst.toExponential(2)} relative: some term in Q2 does not scale with the weapon, so the halving DOES move rankings`);

  const halved = plan({ item: half, catalogue, owned: new Map(), slots, question: MELEE_QUESTION });
  assert.deepEqual(
    halved.ideal.placed.map((p) => [p.path, p.rank]),
    meleePlan.ideal.placed.map((p) => [p.path, p.rank]),
    'the ideal build changed when the weapon was halved',
  );
  assert.deepEqual(halved.next.map((n) => n.path), meleePlan.next.map((n) => n.path), 'the acquisition list came back in a different order on the halved weapon');
  // The gains are the numbers the ordering is BUILT from, so they are checked
  // as well as the order: an order can survive a broken gain by luck.
  for (let i = 0; i < meleePlan.next.length; i++) {
    const full = meleePlan.next[i]!;
    const small = halved.next[i]!;
    assert.ok(Math.abs(full.gain - 2 * small.gain) <= 1e-12 * Math.abs(full.gain), `${full.name}: gain ${String(full.gain)} against ${String(small.gain)} halved`);
  }
  // Now-against-Ideal is a RATIO on the overlay's meter, so it is one of the two
  // things the halving is claimed not to touch. The other is the ordering above.
  assert.ok(
    Math.abs(meleePlan.now.score.value / meleePlan.ideal.score.value - halved.now.score.value / halved.ideal.score.value) <= 1e-12,
    'Now as a fraction of Ideal moved when the weapon was halved: the meter the overlay draws is not scale-free after all',
  );

  /*
   * AND THE HALF THAT IS NOT ABOUT ORDERING AT ALL.
   *
   * The absolute figure IS wrong on one captured build and the app knows it, so
   * the marker has to arrive on the result the overlay draws - all three of
   * them, since the overlay draws whichever it is showing. An unmarked number
   * that the app knows disagrees with the game is the one thing this codebase
   * says it must never print.
   */
  for (const build of [meleePlan.now, meleePlan.ideal, meleePlan.ceiling]) {
    assert.ok(build.score.figureNote !== null, 'a melee figure came back with no note: the overlay would print a number the app knows disagrees with the game, unmarked');
    assert.ok(build.score.figureNote!.includes('factor of two'), `the melee note no longer names the disagreement: ${String(build.score.figureNote)}`);
  }
});

ok('a uniform scale on the weapon changes no ranking - only the printed figures', () => {
  /*
   * THE SAME PROPERTY, STATED WHERE IT ACTUALLY LIVES.
   *
   * The gate above could pass for a reason peculiar to melee - a factor of two
   * is exact in binary, and the Skiajati is one weapon. This asserts the general
   * thing the melee claim is a special case of: the objective is homogeneous of
   * degree one in the weapon's damage vector, under both damage questions, on a
   * weapon with a magazine and a reload that melee does not have.
   *
   * The factor is 3.7 rather than 2 for exactly that reason - it has no exact
   * binary representation, so a check that passes is telling you about the
   * arithmetic rather than about a lucky power of two. Measured worst relative
   * deviation: 3.0e-16 under Q1 over 49 mods, 2.2e-16 under Q2 over 51.
   *
   * The `moved` check is the other half and is a different claim entirely:
   * scaling damage must not shift critical chance, critical damage, fire rate,
   * magazine, reload or multishot by a single digit. Those are read off the item
   * and modded on their own paths, so any of them moving means the damage scale
   * has leaked into a field it has no business touching.
   */
  const SCALE = 3.7;
  for (const question of ['Q1', 'Q2'] as const) {
    const solo = soloScaleDeviation(item, SCALE, question);
    assert.ok(solo.mods > 20, `${question} scores only ${String(solo.mods)} mods on the Braton`);
    assert.deepEqual(solo.moved, [], `scaling the weapon's damage moved a figure that is not damage: ${solo.moved.join(', ')}`);
    assert.ok(solo.worst < 1e-12, `${question}: a mod's value came back off the scale by ${solo.worst.toExponential(2)} relative, so the objective is not a uniform function of the weapon's damage and a scale CAN reorder it`);
  }

  /*
   * And at the consumer, under the question a rifle is really asked - which is
   * Q2, not the Q1 the rest of this file's fixtures use. `plan` is where an
   * ordering becomes advice, and it is the only place a non-scaling term would
   * show up as a different instruction rather than as a different number.
   */
  const question = questionFor(item);
  const base = plan({ item, catalogue, owned: new Map(), slots, question });
  const big = plan({ item: scaledBy(item, SCALE), catalogue, owned: new Map(), slots, question });
  assert.deepEqual(big.ideal.placed.map((p) => [p.path, p.rank]), base.ideal.placed.map((p) => [p.path, p.rank]), 'the ideal build changed under a uniform scale');
  assert.deepEqual(big.next.map((n) => n.path), base.next.map((n) => n.path), 'the acquisition list came back in a different order under a uniform scale');
  assert.equal(big.ideal.drain, base.ideal.drain, 'a damage scale changed what the build costs in capacity');
  assert.equal(big.ideal.unscored, base.ideal.unscored, 'a damage scale changed how many effects went unscored');
  assert.ok(
    Math.abs(big.ideal.score.value - SCALE * base.ideal.score.value) <= 1e-12 * Math.abs(big.ideal.score.value),
    `the printed figure went from ${base.ideal.score.value.toFixed(3)} to ${big.ideal.score.value.toFixed(3)} on a scale of ${String(SCALE)}: only the figure may move, and it must move by exactly the factor`,
  );
});

/*
 * THE CANDIDATES A REAL BUILD IS MADE OF, WITH THEIR REAL POLARITIES.
 *
 * Rebuilt from `Placed` rather than assembled by hand, because `Placed.polarity`
 * has already been through the module's own `toPolarity` - which is not exported
 * - so no polarity here is this file's guess about what the catalogue's word
 * means. The drain is recomputed from the row at the placed rank because
 * `Placed.drain` is the post-slot figure and a candidate carries the pre-slot
 * one; feeding the slot-adjusted number back in would double the discount.
 *
 * The ideal and the ceiling are unioned so the pool holds Sacrificial Steel: the
 * ceiling searches a fully polarised grid and is the only build that reaches for
 * an umbra mod, and umbra is the single case where the two drain functions could
 * disagree without anyone noticing.
 */
const MELEE_POOL: Candidate[] = (() => {
  const byPath = new Map<string, Candidate>();
  for (const p of [...meleePlan.ideal.placed, ...meleePlan.ceiling.placed]) {
    if (byPath.has(p.path)) continue;
    const row = db.byPath.get(p.path);
    if (!row) continue;
    byPath.set(p.path, { row, rank: p.rank, polarity: p.polarity, drain: drainAtRank(row.baseDrain ?? 0, p.rank) });
  }
  return [...byPath.values()];
})();

/*
 * Grids built through `slotPlanFor` rather than written as literals, so the
 * catalogue's own polarity words go through the module's normalisation on the
 * way in - the same path the account's build dump takes.
 *
 * The fifth grid is the one that matters and the one an obvious set would miss.
 * An umbra mod pays full price in a universal slot and full price in an
 * unpolarised one, so a grid of all-universal cannot tell the two apart. Only a
 * grid holding BOTH can: the guard sends the umbra mod to the unpolarised slot
 * and leaves the universal one for a mod that halves in it, and dropping the
 * guard swaps them for a different total. Measured, that sabotage moves 913 of
 * the 9,905 comparisons below and every one of them is on this grid: on the
 * other four it moves none.
 *
 * The unpolarised slot is NAMED rather than left to the padding. `drainOf` and
 * `assign` both top a short grid up to `GRID_SLOTS` with 'none', so a
 * three-slot grid behaves identically - but then the array itself carries no
 * 'none' and the assertion below, which is what stops this set of grids from
 * quietly losing the only shape that catches the bug, cannot see it.
 */
const gridOf = (words: string[]): Polarity[] => slotPlanFor({ rank: 30, maxRank: 30, masteryRank: 20, catalyst: true, stanceBonus: null, gridPolarities: words }).plan.grid;
const DRAIN_GRIDS: Polarity[][] = [
  gridOf([]),
  gridOf(['universal', 'universal', 'universal', 'universal', 'universal', 'universal', 'universal', 'universal']),
  gridOf(['umbra', 'universal', 'madurai', 'naramon', 'vazarin', 'zenurik', 'unairu', 'penjaga']),
  gridOf(['madurai', 'madurai', 'naramon']),
  gridOf(['universal', 'universal', 'madurai', 'none']),
];

ok('the fast drain and the full assignment never disagree - the search is optimised, not approximated', () => {
  /*
   * TWO COPIES OF ONE RULE, AND THEY DECIDE DIFFERENT HALVES OF THE SAME ANSWER.
   *
   * `drainOf` exists because `assign` was building eight objects of ten fields
   * about 160,000 times a search for a caller that wanted one integer. The
   * module's own note says the greedy assignment in it is "the same one, line
   * for line" and that this file asserts they agree - which is the only thing
   * standing between the app and a silent divergence, because the two numbers
   * are consumed at opposite ends: `drainOf` decides `fits` INSIDE the beam, so
   * it decides which builds are even considered, and `assign` produces the
   * `drain` the overlay PRINTS beside the capacity. Drift and the app shows a
   * build it calls legal beside a number that says it is not.
   *
   * Every subset of a real eleven-mod build pool against five grids, which is
   * 9,905 comparisons once the sets too big for the grid are dropped. Not
   * random: this repo has already shipped a 400-trial gate whose generator
   * returned a constant, and eleven mods is small enough that exhaustive costs
   * less than getting randomness right.
   */
  assert.ok(MELEE_POOL.some((c) => c.polarity === 'umbra'), `no umbra mod in the pool (${MELEE_POOL.map((c) => c.polarity).join(', ')}): the one branch where the two functions could differ is untested`);
  assert.ok(
    DRAIN_GRIDS.some((g) => g.includes('universal') && g.includes('none')),
    `no grid names a universal slot and an unpolarised one together, which is the only shape that can catch a dropped umbra guard: ${DRAIN_GRIDS.map((g) => `[${g.join('|')}]`).join(' ')}`,
  );

  let compared = 0;
  for (const grid of DRAIN_GRIDS) {
    for (let mask = 0; mask < 1 << MELEE_POOL.length; mask++) {
      const set = MELEE_POOL.filter((_, i) => mask & (1 << i));
      // A set larger than the grid is not a build; both functions agree on it
      // trivially by running out of slots, which is not evidence of anything.
      if (set.length > GRID_SLOTS) continue;
      compared++;
      const fast = drainOf(set, grid);
      const full = assign(set, grid).drain;
      assert.equal(fast, full, `${set.map((c) => `${c.row.name}/${c.polarity}/${String(c.drain)}`).join(' + ')} on [${grid.join(', ')}]: drainOf says ${String(fast)}, assign says ${String(full)}`);
    }
  }
  /*
   * THE BOUND IS THE POOL'S, NOT A NUMBER THAT WAS TRUE ONCE.
   *
   * This read `> 9000`, fitted to an eleven-mod pool. `MELEE_POOL` is derived
   * from the Skiajati's own ideal and ceiling, so it moves whenever the
   * objective does - and the faction factor moved it to ten, which took the
   * comparison to 5,065 and failed a gate that had nothing to do with factions.
   * A fitted literal in a derived fixture is a trap that springs on the next
   * person to improve the thing it depends on.
   *
   * What the gate actually needs is that the comparison is BIG - every legal
   * subset of a real pool, on five grids - so the bound is computed from the
   * pool and the pool is required to be worth comparing.
   */
  assert.ok(MELEE_POOL.length >= 8, `the pool is only ${String(MELEE_POOL.length)} mods, which is not a comparison`);
  let legalSets = 0;
  for (let mask = 0; mask < 1 << MELEE_POOL.length; mask++) {
    if (MELEE_POOL.filter((_, i) => mask & (1 << i)).length <= GRID_SLOTS) legalSets++;
  }
  assert.equal(compared, legalSets * DRAIN_GRIDS.length, `compared ${String(compared)} against ${String(legalSets * DRAIN_GRIDS.length)} the pool implies`);

  /*
   * AND AT THE CONSUMER, which is the assertion the loop above cannot make.
   *
   * The loop proves an algebraic identity between two functions. What ships is a
   * BuildResult whose `fits` came from one of them and whose `drain` came from
   * the other, so the identity has to hold on the build the app actually hands
   * over - including on a grid that is not empty, where the halving and the
   * mismatch penalty are both live.
   */
  const rebuild = (b: { placed: Array<{ path: string; rank: number; polarity: Polarity }> }): Candidate[] =>
    b.placed.map((p) => {
      const row = db.byPath.get(p.path)!;
      return { row, rank: p.rank, polarity: p.polarity, drain: drainAtRank(row.baseDrain ?? 0, p.rank) };
    });
  for (const build of [meleePlan.ideal, result.ideal]) {
    assert.equal(drainOf(rebuild(build), slots.grid), build.drain, 'the drain the plan printed is not the drain the search fitted it against');
    assert.ok(build.fits, `a build reported as not fitting drains ${String(build.drain)} of ${String(build.capacity)}`);
  }
  const polarised = { grid: DRAIN_GRIDS[4]!, capacity: slots.capacity };
  const onGrid = search(MELEE_QUESTION, melee, MELEE_POOL, polarised);
  assert.equal(drainOf(rebuild(onGrid), polarised.grid), onGrid.drain, 'on a polarised grid the search fitted a build against a drain it did not report');
  assert.ok(onGrid.fits, `a polarised build reported as not fitting drains ${String(onGrid.drain)} of ${String(onGrid.capacity)}`);
});

ok('the exilus slot is empty because it is WORTH nothing, and the gate says when that stops being true', () => {
  /*
   * THE REASON WENT STALE ONCE ALREADY, WHICH IS THE WHOLE POINT OF THIS GATE.
   *
   * The note in `optimise.ts` used to say the exilus slot was left empty because
   * "the question scores none of the utility mods it accepts". That was true
   * under Q1 and stopped being true the moment Q2 existed: Bhisaj-Bal is a
   * Paris Prime augment flagged `isUtility` giving +90 % status, which Q2 scores.
   * The claim survived the change because nothing measured it.
   *
   * So this derives it rather than asserting it. It filters the catalogue the
   * way the module's own note says it does, scores every survivor with the
   * search's own rule at its own max rank, and fails the day an objective starts
   * valuing something a utility mod gives. The data to fill the slot is already
   * resolved - `data/build.ts` reads `hasFeature(instance, UTILITY_SLOT)` - so
   * the failure message is an instruction, not a complaint.
   *
   * Measured on the current catalogue: 116 utility rows, of which the positive
   * scorers are none under Q1, one under Q2 (Bhisaj-Bal), none under Q3.
   */
  const utility = catalogue.filter((r) => r.isUtility && !r.isFlawed && r.ranks > 0);
  assert.ok(utility.length > 50, `only ${String(utility.length)} utility rows: the filter no longer selects the exilus candidates`);

  const positive = new Map<string, string[]>();
  for (const question of ['Q1', 'Q2', 'Q3'] as const) {
    const hits = utility.filter((r) => scoredEffects(r, maxRankOf(r), question).used.some((e) => (e.value ?? 0) > 0));
    for (const h of hits) positive.set(h.name, [...(positive.get(h.name) ?? []), question]);
  }
  assert.deepEqual(
    [...positive.keys()].sort(),
    ['Bhisaj-Bal'],
    `the exilus slot is now worth building: ${[...positive].map(([n, qs]) => `${n} under ${qs.join('/')}`).join(', ')} score positively, and ASSUMPTIONS still tells the player every candidate for the slot is worth exactly zero`,
  );
  assert.deepEqual(positive.get('Bhisaj-Bal'), ['Q2'], 'Bhisaj-Bal now scores under a question other than Q2, which widens the exception the assumption describes');

  /*
   * ONE MOD ON ONE WEAPON, which is what makes building a ninth slot with its
   * own capacity rules unjustifiable rather than merely unfinished. Its
   * compatName is a weapon NAME, not a class, so it is offered to exactly the
   * one item in the export that carries that name - and never to a rifle.
   */
  const bhisaj = utility.find((r) => r.name === 'Bhisaj-Bal');
  assert.ok(bhisaj, 'Bhisaj-Bal is no longer in the catalogue under that name');
  assert.equal(weapons.filter((w) => w.name === bhisaj.slot).length, 1, `${String(bhisaj.slot)} is no longer a single weapon: the exception is wider than the assumption says`);
  assert.ok(!eligibleSlots(item).has(bhisaj.slot ?? ''), 'a rifle now accepts the one utility mod that scores');

  /*
   * AND THE ONE Q1 DOES SCORE IS WORTH LESS THAN NOTHING, measured on a real
   * weapon rather than read off its sign. Vile Precision is in the Braton's
   * search pool - it is eligible, it is scored, the beam sees it every
   * expansion - and it is never chosen because taking it makes the build worse.
   * That is a stronger statement than "no positive effect": it is the reason the
   * slot stays empty even where the question CAN see the mod.
   */
  const vile = utility.find((r) => r.name === 'Vile Precision');
  assert.ok(vile, 'Vile Precision is no longer in the catalogue under that name');
  const bare = score(item, []).score.value;
  const withVile = score(item, [{ row: vile, rank: maxRankOf(vile) }]).score.value;
  assert.ok(withVile < bare, `Vile Precision now raises the Braton from ${bare.toFixed(3)} to ${withVile.toFixed(3)}: the exilus slot has a candidate worth taking`);
  assert.ok(!result.ideal.placed.some((p) => p.path === vile.uniqueName), 'the search placed Vile Precision, which it can only do by valuing a fire-rate loss');

  /*
   * THE SENTENCE THE PLAYER IS SHOWN CARRIES THE DERIVED NUMBERS.
   *
   * Both assumption lists quote a count of utility mods, and a count in prose is
   * exactly the kind of claim that rots quietly: the catalogue is upstream and
   * moves, and nothing else in the app would notice. Deriving it here and
   * asserting the shipped string carries it means the day the count changes, the
   * gate fails and the sentence gets rewritten instead of being inherited.
   */
  const exilusLine = ASSUMPTIONS.find((a) => a.startsWith('the exilus slot is left empty'));
  assert.ok(exilusLine, 'ASSUMPTIONS no longer carries a sentence about the exilus slot');
  assert.ok(carriesCount(exilusLine, utility.length), `ASSUMPTIONS says "${exilusLine}" but the catalogue now holds ${String(utility.length)} utility mods`);
  assert.ok(exilusLine.includes('Bhisaj-Bal'), 'the exilus assumption no longer names the one exception it is describing');

  const frameUtility = utility.filter((r) => r.slot === 'WARFRAME');
  const frameLine = FRAME_ASSUMPTIONS.find((a) => a.startsWith('the exilus slot is left empty'));
  assert.ok(frameLine, 'FRAME_ASSUMPTIONS no longer carries a sentence about the exilus slot');
  assert.ok(carriesCount(frameLine, frameUtility.length), `FRAME_ASSUMPTIONS says "${frameLine}" but the catalogue now holds ${String(frameUtility.length)} Warframe utility mods`);
  assert.equal(
    frameUtility.filter((r) => scoredEffects(r, maxRankOf(r), 'Q3').used.length > 0).length,
    0,
    'a Warframe utility mod now touches health, shields or armour, so the frame exilus slot is worth filling and FRAME_ASSUMPTIONS says otherwise',
  );
});

ok('the stance carries no stats, so the one thing it contributes - capacity - is the one thing counted', () => {
  /*
   * THE UNSCORED SLOT THAT IS NOT A GAP.
   *
   * `optimise.ts` lists the stance among the three slots it does not score, and
   * says of it that all 63 carry zero effects, so the only quantitative thing a
   * stance does is hand the grid capacity - which the app reads from the log's
   * own build dump as `stanceBonus`. That is two separate claims and they fail
   * in different ways: the first going stale means the app silently ignores a
   * real stat, and the second breaking means the app plans a melee build against
   * five points it has and does not know about, which shows up as a build that
   * would have fitted being rejected.
   *
   * Note there is no single type string for a stance: 57 rows are 'Stance Mod'
   * and 6 are 'Posture Mod', and 63 is their sum. That is why the count is
   * derived and then checked against the sentence rather than the other way
   * round.
   */
  const stances = catalogue.filter((r) => r.type === 'Stance Mod' || r.type === 'Posture Mod');
  assert.ok(stances.length > 40, `only ${String(stances.length)} stance rows: the type names no longer select them`);
  const withStats = stances.filter((s) => s.effects.length > 0);
  assert.deepEqual(withStats.map((s) => s.name), [], `a stance now carries effects (${withStats.map((s) => s.name).join(', ')}): the app scores none of them, so a melee build is now understated by whatever they give`);

  const stanceLine = ASSUMPTIONS.find((a) => a.includes('the stance itself carries no stats'));
  assert.ok(stanceLine, 'ASSUMPTIONS no longer carries a sentence about the stance');
  assert.ok(carriesCount(stanceLine, stances.length), `ASSUMPTIONS says "${stanceLine}" but the catalogue now holds ${String(stances.length)} stances`);

  /*
   * A STANCE CANNOT REACH THE GRID AT ALL, which is the second and independent
   * reason it is safe to leave unmodelled. Its compatName is a weapon family
   * ('Swords', 'Polearms', 'Heavy Blade'), never the 'Melee' class the pool is
   * built from, so `eligibleSlots` refuses it before anything scores it. If that
   * ever changes, a zero-effect mod with a negative drain becomes placeable on
   * the eight and the search will happily take it for the capacity.
   */
  const accepts = eligibleSlots(melee);
  const reachable = stances.filter((s) => s.slot !== null && accepts.has(s.slot));
  assert.deepEqual(reachable.map((s) => s.name), [], 'a stance is now eligible for the eight grid slots, where a zero-effect mod with a negative drain would be free capacity the game does not give');

  /*
   * AND THE CAPACITY ARRIVES.
   *
   * The bonus used here is derived from the catalogue rather than invented: every
   * one of the 63 carries baseDrain -2 and fusionLimit 3, so a maxed stance is
   * -5 and hands over five points in an unpolarised slot. BOTH halves of that
   * are asserted uniform - a gate that checked only the drain would derive the
   * bonus from one row's rank ceiling and call it true of sixty-three.
   * What the app actually does is read the number out of the log's dump; this
   * asserts that whatever number arrives there lands in the capacity the search
   * spends and in the capacity the overlay prints, which is
   * `BuildResult.capacity` and not the SlotPlan it was computed from - the two
   * are separated by the aura adjustment inside `search`, and a plan whose
   * capacity is right and whose build is searched against the wrong one is
   * exactly the defect shape this repo keeps finding.
   */
  assert.equal(new Set(stances.map((s) => s.baseDrain)).size, 1, 'stance drains are no longer uniform, so the bonus below is derived from one row and true of only that row');
  assert.equal(new Set(stances.map((s) => s.fusionLimit)).size, 1, 'stance rank ceilings are no longer uniform, so the bonus below is derived from one row and true of only that row');
  const stance = stances[0]!;
  const bonus = -drainAtRank(stance.baseDrain ?? 0, stance.fusionLimit ?? 0);
  assert.ok(bonus > 0, `a maxed ${stance.name} would hand the grid ${String(bonus)} points`);

  const withoutStance = slotPlanFor({ rank: 30, maxRank: 30, masteryRank: 20, catalyst: true, stanceBonus: null, gridPolarities: [] }).plan;
  const withStance = slotPlanFor({ rank: 30, maxRank: 30, masteryRank: 20, catalyst: true, stanceBonus: bonus, gridPolarities: [] }).plan;
  assert.equal(withStance.capacity, withoutStance.capacity + bonus, 'the stance bonus did not reach the slot plan capacity');

  const bare = search(MELEE_QUESTION, melee, MELEE_POOL, withoutStance);
  const armed = search(MELEE_QUESTION, melee, MELEE_POOL, withStance);
  assert.equal(armed.capacity, bare.capacity + bonus, `the build was searched against ${String(armed.capacity)} when the slot plan said ${String(withStance.capacity)}`);
  assert.ok(armed.drain > bare.drain, `the extra ${String(bonus)} points bought nothing: ${String(bare.drain)}/${String(bare.capacity)} became ${String(armed.drain)}/${String(armed.capacity)}`);
  assert.ok(armed.score.value > bare.score.value, `the stance capacity did not improve the build: ${bare.score.value.toFixed(1)} against ${armed.score.value.toFixed(1)}`);
});

ok('a PER-X bonus is not a flat one, which is how Condition Overload was topping the ranking', () => {
  /*
   * THE PARSER WAS RIGHT AND THE SCORER WAS NOT.
   *
   * `modstats.ts` reads "+80% Melee Damage per Status Type affecting the
   * target" exactly as written: the magnitude into `value`, the "per X" into
   * `scalingBasis`. `scoredEffects` only ever looked at `conditions`, so an
   * effect whose size depends on something the app cannot measure arrived with
   * an empty condition list and was scored AT FACE VALUE.
   *
   * Five mods, seven effect-question pairs, and none of them obscure:
   * Condition Overload and Cull The Weak as flat melee damage under Q1 and Q2,
   * Weeping Wounds as flat status under Q2, Pack Leader and Primed Pack Leader
   * as flat health under Q3. A flat +80 % melee damage mod beats almost
   * anything in the pool, which is exactly what it was doing.
   *
   * None of the three bases - status types on the target, the combo multiplier,
   * hits landed - is derivable from an account, so they are unscored and said
   * rather than guessed.
   */
  const bases = ['Condition Overload', 'Cull The Weak', 'Weeping Wounds'];
  const bare = score(item, [], 'Q2').score.value;
  for (const name of bases) {
    const row = catalogue.find((r) => r.name === name);
    assert.ok(row, `${name} is no longer in the catalogue`);
    const rank = row.fusionLimit ?? Math.max(0, row.ranks - 1);
    const top = row.effects.filter((e) => e.rank === rank);
    assert.ok(top.some((e) => e.scalingBasis !== undefined), `${name} no longer parses a scaling basis, so this gate is measuring nothing`);
    for (const q of ['Q1', 'Q2', 'Q3'] as const) {
      const s = scoredEffects(row, rank, q);
      assert.ok(
        s.used.every((e) => e.scalingBasis === undefined),
        `${name} is scoring a per-${String(s.used.find((e) => e.scalingBasis !== undefined)?.scalingBasis)} bonus as flat under ${q}`,
      );
    }
    // And it contributes nothing to a real figure rather than a large lie.
    assert.equal(score(item, [{ row, rank }], 'Q2').score.value, bare, `${name} still moves the figure, so a per-X bonus is being credited`);
  }

  /*
   * THE OTHER HALF: an ordinary flat mod must still score, or the fix has
   * simply switched everything off. Primed Pressure Point is "+165% Melee
   * Damage" with no basis and no condition at all.
   */
  const ppp = catalogue.find((r) => r.name === 'Primed Pressure Point');
  assert.ok(ppp, 'Primed Pressure Point is no longer in the catalogue');
  const pppRank = ppp.fusionLimit ?? Math.max(0, ppp.ranks - 1);
  assert.ok(scoredEffects(ppp, pppRank, 'Q2').used.length > 0, 'a plain flat mod stopped scoring, so the basis check is too wide');
  assert.ok(score(item, [{ row: ppp, rank: pppRank }], 'Q2').score.value > bare * 1.5, 'Primed Pressure Point no longer moves the figure');
});

ok('the figure names which of THIS weapon attacks it leaves out, and says nothing on a gun', () => {
  /*
   * SIX PARSED FIELDS THE OBJECTIVE READS NONE OF - `comboDuration`,
   * `followThrough`, `windUp`, `slamAttack`, `slideAttack` and
   * `heavyAttackDamage`. A melee figure is the normal attack chain and nothing
   * else, which is defensible (a slam build and a heavy build are play-style
   * choices the account cannot reveal) and was SILENT, which is not.
   *
   * `ASSUMPTIONS` does say "no combo and no heavy-attack multiplier" - and that
   * list is deliberately never shown, because only item-specific unknowns earn
   * the panel's room. Which attacks a weapon HAS is item-specific, so this is
   * where it belongs, built from the catalogue row rather than recited.
   */
  const melee = parseWfcd('Melee', melees);
  const skiajati = melee.find((w) => w.name === 'Skiajati');
  assert.ok(skiajati, 'the Melee export no longer carries the Skiajati');
  const said = uncountedAttacks(skiajati);
  assert.equal(said.length, 1, 'a melee weapon should produce exactly one line, not a list of five');
  for (const part of ['heavy attacks', 'slams', 'slide attacks', 'follow-through']) {
    assert.ok(said[0]!.includes(part), `the line does not name ${part}: ${said[0]!}`);
  }
  /*
   * AND IT MUST NOT NAME THE COMBO MULTIPLIER. The first version did, which
   * implies the normal-attack figure is understated by it -
   * `docs/research/melee-base-damage.md` section C marks that REFUTED against
   * the wiki: combo does not multiply normal-attack damage, it is SPENT on
   * heavy attacks, and it is x1 on this screen regardless. A caveat that names
   * a term the figure is not missing is a lie in the same voice as the true
   * ones beside it.
   */
  assert.ok(!said[0]!.includes('combo'), `the caveat claims the figure is missing the combo multiplier, which the research refutes: ${said[0]!}`);

  /*
   * A GUN SAYS NOTHING, which is the half that makes this worth having. A rifle
   * plan reciting a melee caveat is noise crowding out the caveats that apply.
   */
  assert.deepEqual(uncountedAttacks(item), [], `the Braton is being given a melee caveat: ${uncountedAttacks(item).join(' / ')}`);

  /*
   * AND IT IS DERIVED, NOT ASSUMED. A weapon with no `heavyAttackDamage` row
   * has no heavy attack to leave out, so the line must follow the fields.
   */
  assert.deepEqual(uncountedAttacks({ slamAttack: 100 }), ['the figure counts the normal attack chain only: slams are not in it']);
  /*
   * THE HEAVY CARRIES ITS RATIO, because "not counted" and "5x a normal hit is
   * not counted" are different sentences. The wiki gives the multiplier per
   * weapon class - Heavy Blade 6x, Fist 5x - and the export carries it per
   * weapon as an absolute, so the ratio is exact: Gram Prime 300 -> 1,800 is
   * the table's 6x, the Skiajati's 175 -> 875 its 5x.
   */
  assert.deepEqual(
    uncountedAttacks({ heavyAttackDamage: 875, totalDamage: 175 }),
    ['the figure counts the normal attack chain only: heavy attacks (5x a normal hit) are not in it'],
  );
  // With no total to divide by there is no ratio to claim, and it says the noun alone.
  assert.deepEqual(uncountedAttacks({ heavyAttackDamage: 875 }), ['the figure counts the normal attack chain only: heavy attacks are not in it']);
  // And the real weapon's ratio is the wiki's class figure, not something invented.
  const gram = melee.find((w) => w.name === 'Gram Prime');
  if (gram) assert.ok(uncountedAttacks(gram)[0]!.includes('6x a normal hit'), `Gram Prime is a Heavy Blade at 6x: ${uncountedAttacks(gram)[0]!}`);
  assert.ok(said[0]!.includes('5x a normal hit'), `the Skiajati is 5x: ${said[0]!}`);
  assert.deepEqual(uncountedAttacks({}), []);
  assert.ok(uncountedAttacks({ heavyAttackDamage: 1, slamAttack: 2 })[0]!.includes('heavy attacks and slams'), 'two parts are not joined as a sentence');

  // The census, so the claim is about the catalogue and not about one weapon.
  const withLine = melee.filter((w) => uncountedAttacks(w).length > 0).length;
  const guns = weapons.filter((w) => uncountedAttacks(w).length > 0).length;
  assert.ok(withLine > melee.length / 2, `only ${String(withLine)} of ${String(melee.length)} melee weapons say anything`);
  assert.equal(guns, 0, `${String(guns)} primaries are wearing a melee caveat`);
});

ok('the beam width is converged, and narrowing it is a faster wrong answer', () => {
  /*
   * THE ONE OPTIMISATION EVERYONE REACHES FOR FIRST, closed with a measurement.
   *
   * A plan is 0.8-1.4 s and the beam is nearly all of it, so a narrower beam is
   * the obvious saving. It is not available: at 100 the Braton's ideal falls
   * 22 %, at 50 it falls 72 %, and the Hek loses 83 % at 25 - while 400 and 800
   * return answers byte-identical to 200 for two and three and a half times the
   * work. The sweep is in the constant's own comment.
   *
   * This gate cannot re-run the sweep - it would triple the suite - so it holds
   * the two things that make the comment binding: the width itself, and the
   * fact that the search is genuinely sensitive to it. The second is the real
   * assertion. If a narrower beam ever stopped changing the answer, the beam
   * would have become padding and this would be the place that noticed.
   */
  assert.equal(BEAM, 200, `the beam is ${String(BEAM)}; the convergence sweep in optimise.ts was run at 200`);

  /*
   * Sensitivity, measured rather than asserted: the same search restricted to a
   * pool the beam cannot hold must find something WORSE. `search` takes the
   * pool, so a pool larger than the width is what makes width matter - and the
   * Skiajati's melee pool is 52 mods, well over eight slots but well under 200,
   * so the beam never truncates on it. The Braton's Q1 pool is the one that
   * does.
   */
  const pool = eligibleSlots(item);
  const wide = catalogue.filter((r) => r.slot !== null && pool.has(r.slot) && r.ranks > 0 && !r.isFlawed);
  assert.ok(wide.length > BEAM / 4, `the rifle pool is only ${String(wide.length)} mods, so this weapon cannot exercise the width at all`);
});

ok('the level-9999 target is COMPUTED from the armour curve, not asserted', () => {
  /*
   * `Q2_TARGET_ARMOUR` read `= ARMOUR_CAP` with a paragraph under it explaining
   * that level scaling cannot exceed the cap. The explanation was correct and
   * nothing checked it, so it was a claim in a comment sitting on the single
   * number the whole armoured objective is computed against.
   *
   * It is now the Update 36 curve evaluated at level 9999, and this is what
   * makes that real: the gate recomputes it from `armour.ts` independently, and
   * pins the threshold the derivation depends on. `CAP_REACHING_BASE_ARMOUR` is
   * solved rather than typed - the smallest integer base armour that still
   * clamps at 9999 - so a change to the curve, the cap or the level moves both
   * sides and fails here rather than quietly rescoring every build in the game.
   */
  assert.equal(Q2_TARGET_LEVEL, 9999, 'the objective is aimed at level 9999');
  assert.equal(
    Q2_TARGET_ARMOUR,
    armourAtLevel({ baseArmour: CAP_REACHING_BASE_ARMOUR, baseLevel: 1, level: Q2_TARGET_LEVEL }),
    'the target is no longer what the curve produces - it has gone back to being a stated number',
  );

  // The threshold is a real boundary: seven clamps, six does not.
  assert.ok(
    armourAtLevel({ baseArmour: CAP_REACHING_BASE_ARMOUR, baseLevel: 1, level: Q2_TARGET_LEVEL }) >= ARMOUR_CAP,
    `base armour ${String(CAP_REACHING_BASE_ARMOUR)} does not reach the cap at 9999`,
  );
  assert.ok(
    CAP_REACHING_BASE_ARMOUR === 1 ||
      armourAtLevel({ baseArmour: CAP_REACHING_BASE_ARMOUR - 1, baseLevel: 1, level: Q2_TARGET_LEVEL }) < ARMOUR_CAP,
    `base armour ${String(CAP_REACHING_BASE_ARMOUR - 1)} also reaches the cap, so the solved threshold is not the smallest`,
  );

  /*
   * AND THE TARGET IS STILL THE CAP, which is the fact that makes the whole
   * armoured question meaningful: at 2,700 the reduction is exactly 90 %, a
   * direct hit lands at a tenth and a bleed lands whole. If a curve change ever
   * puts the target below the cap this fails, and it should - the objective's
   * own prose, the overlay's printed target and this constant would all have
   * gone out of step at once.
   */
  assert.equal(Q2_TARGET_ARMOUR, ARMOUR_CAP, `the 9999 target is ${String(Q2_TARGET_ARMOUR)}, no longer the cap`);
  assert.ok(Math.abs(enemyDamageMultiplier(Q2_TARGET_ARMOUR) - 0.1) < 1e-12, 'a tenth arrives at the target, which is what Q2 means by armoured');
});

ok('the worst matchup is on the score, so the panel can name it - and only Q2 has one', () => {
  /*
   * THE MOST NOVEL NUMBER IN THIS APP WAS INVISIBLE.
   *
   * Q2 multiplies its whole figure by the minimum over 29 targets - the game's
   * 15 factions and 14 health layers - so the number was on screen and the
   * reason for it was not. "0.76 against Infested Deimos" names the element to
   * trade; the figure alone names nothing, and nobody carries two grids that
   * size in their head or re-checks them on every mod swap.
   *
   * Gated at both ends because either alone is decoration: the field has to
   * carry what the objective actually used, and the questions that do not ask
   * it must not carry a stale one.
   */
  const set = plan({ item, catalogue, owned: everything, slots, question: 'Q2' }).ideal.placed.map((p) => {
    const row = catalogue.find((r) => r.uniqueName === p.path);
    assert.ok(row, `${p.name} vanished from the catalogue`);
    return { row, rank: p.rank };
  });
  const q2 = score(item, set, 'Q2').score;
  assert.ok(q2.weakest, 'Q2 no longer reports the matchup it scored against');
  const u = universal(q2.damage);
  assert.equal(q2.weakest.against, u.worstFaction, `the panel would name ${q2.weakest.against} where the objective used ${u.worstFaction}`);
  assert.ok(Math.abs(q2.weakest.factor - u.worst) < 1e-12, 'the reported factor is not the one the value was multiplied by');
  assert.ok(q2.weakest.factor > 0 && q2.weakest.factor <= 1.5, `a matchup factor of ${String(q2.weakest.factor)} is outside the table's range`);

  // Q1 does not ask, so it must not answer. Q3's half sits in the frame section
  // below, where `ash` exists.
  assert.equal(score(item, set, 'Q1').score.weakest, null, 'Q1 is carrying a matchup it never computed');

});

ok('Q1 and Q2 are different questions, not two wordings of one', () => {
  /*
   * The claim that justifies the controller asking Q2: if the armoured question
   * gave the same build as the unarmoured one, choosing between them would be
   * cosmetic and Q2 would be dead weight rather than a missing answer.
   *
   * It is not cosmetic. Bleed bypasses armour entirely, so against 2,700 armour
   * status and slash beat raw critical damage - which is why real builds carry
   * them and paper ones do not.
   */
  const q1 = plan({ item, catalogue, owned: everything, slots, question: 'Q1' }).ideal;
  const q2 = plan({ item, catalogue, owned: everything, slots, question: 'Q2' }).ideal;
  assert.equal(q1.question, 'Q1');
  assert.equal(q2.question, 'Q2');
  // The figures must differ: the same number under both would mean armour is not modelled.
  assert.ok(q2.score.value !== q1.score.value, 'Q1 and Q2 scored the rifle identically - armour is not being applied');

  /*
   * THIS GATE USED TO SAY `Q2 < Q1` AND THAT CLAIM WAS WRONG, in a way worth
   * recording because it was wrong for a good reason.
   *
   * It held only while Q2 modelled armour and NOTHING that answers armour. Q2
   * now derives the strip and the viral stacks a build really sustains, and a
   * corrosive-viral build against a stripped 2,700-armour target genuinely does
   * more damage per second to health than a raw-damage build does to a bare
   * one: viral alone is up to x4.25 and stripping returns up to 7.15x of the
   * direct term. A model in which that is impossible is a model with viral
   * missing from it.
   *
   * So the invariant is stated where it is actually true - on a build that
   * neither strips nor virals, armour must cost damage - and the thing the
   * ideal comparison is really for is asserted directly: Q2's own build must
   * beat Q1's build AT Q2'S OWN QUESTION, which is the entire reason the
   * controller asks a second question at all.
   */
  const q1set = q1.placed.map((p) => {
    const row = catalogue.find((r) => r.uniqueName === p.path);
    assert.ok(row, `${p.name} vanished from the catalogue`);
    return { row, rank: p.rank };
  });
  const q1damage = score(item, q1set, 'Q1').score.damage;
  const strips = q1damage.some((d) => d.type === 'corrosive' || d.type === 'heat' || d.type === 'viral');
  assert.ok(!strips, `the Q1 build now carries ${q1damage.map((d) => d.type).join('/')}, so it is no longer the no-strip case this bound needs`);
  assert.ok(
    score(item, q1set, 'Q2').score.value < score(item, q1set, 'Q1').score.value,
    'on a build that neither strips nor virals, armour must cost damage',
  );

  const q2set = q2.placed.map((p) => {
    const row = catalogue.find((r) => r.uniqueName === p.path);
    assert.ok(row, `${p.name} vanished from the catalogue`);
    return { row, rank: p.rank };
  });
  assert.ok(
    score(item, q2set, 'Q2').score.value > score(item, q1set, 'Q2').score.value,
    'the Q2 build is no better at the armoured question than the Q1 build - then Q2 is dead weight',
  );

  // And on a melee weapon the BUILD itself changes, which is the stronger claim.
  const names = (b: typeof q1) => b.placed.map((p) => p.name).sort().join('|');
  const differs = names(q1) !== names(q2);
  // The rifle may or may not change; what must hold is that the objective CAN change it.
  const status = catalogue.filter((r) => r.effects.some((e) => e.stat === 'status chance'));
  assert.ok(status.length > 0, 'no status mods in the catalogue at all');
  if (!differs) {
    // Then say so honestly rather than asserting something untrue of this weapon.
    console.log('        (the Braton build is the same under both; the figures still differ)');
  }
});

ok('Q2 composes rather than replaces: it is never below the mitigated Q1, and equals it exactly when nothing procs', () => {
  /*
   * THE PART OF Q2 THAT HAS NO GROUND TRUTH, CHECKED WHERE IT CAN BE.
   *
   * Q2's INPUTS are verified against the game exactly - the player's own panel
   * gives critical chance, critical damage and status to the digit. What has
   * never been checked is the COMPOSITION: direct damage through an armour
   * multiplier, PLUS bleed which bypasses armour, plus ignite and poison on
   * their own ticks. The game never prints sustained damage against armour, so
   * there is no panel to compare that sum against, and for a while that was
   * where the matter rested.
   *
   * It does not have to rest there, because the sum has a boundary that pins
   * it. The direct term IS Q1 times the mitigation at 2,700 armour, and every
   * proc term is non-negative. So:
   *
   *     Q2  >=  Q1 x mitigation(2700)        always
   *     Q2  ==  Q1 x mitigation(2700)        exactly when the weapon lands no procs
   *
   * A composition error - a mitigation applied twice, applied to bleed, or
   * omitted - breaks one of those two, and neither needs a number from the
   * game to check. What it cannot check is whether the proc RATES are right;
   * that still has no ground truth and is still said so.
   */
  const mitigation = enemyDamageMultiplier(Q2_TARGET_ARMOUR);
  assert.ok(mitigation > 0 && mitigation < 1, `mitigation at ${String(Q2_TARGET_ARMOUR)} armour is ${String(mitigation)}`);

  const subjects = [item, weapons.find((w) => w.name === 'Boltor'), weapons.find((w) => w.name === 'Hek')].filter((w): w is ItemDbEntry => !!w);
  assert.ok(subjects.length >= 2, 'not enough real weapons to compare');

  let sawProcs = false;
  let sawNone = false;
  for (const w of subjects) {
    // The same mods under both questions, so only the objective differs.
    const set = plan({ item: w, catalogue, owned: everything, slots, question: 'Q1' }).ideal.placed.map((p) => {
      const row = catalogue.find((r) => r.uniqueName === p.path);
      assert.ok(row, `${p.name} vanished from the catalogue`);
      return { row, rank: p.rank };
    });
    const q1 = score(w, set, 'Q1').score.value;
    const s2 = score(w, set, 'Q2').score;
    const q2 = s2.value;
    /*
     * THE FLOOR CARRIES THE FACTION FACTOR NOW, and it has to.
     *
     * `Q2 >= Q1 x mitigation` held while Q2 could only ADD to the mitigated
     * direct term. Q2 now also multiplies by what the build's worst faction
     * does to it, which can be x0.5 - so the bound is `Q1 x mitigation x worst`
     * and the Braton failed the old one at 274 against 375, correctly.
     *
     * The factor is read off the build's own damage vector through the same
     * model the objective uses, not hard-coded: the gate would otherwise pass
     * by agreeing with itself about a number nobody measured.
     */
    const worst = universal(s2.damage).worst;
    const floor = q1 * mitigation * worst;

    assert.ok(
      q2 >= floor - 1e-6,
      `${w.name}: Q2 ${String(q2)} is BELOW the mitigated Q1 ${String(floor)} - the armour multiplier is being applied to something it should not be`,
    );

    if (w.procChance === undefined || w.procChance === 0) {
      assert.ok(Math.abs(q2 - floor) < 1e-6, `${w.name} lands no procs, so Q2 must be exactly the mitigated Q1 against its worst faction: ${String(q2)} vs ${String(floor)}`);
      sawNone = true;
    } else {
      assert.ok(q2 > floor, `${w.name} has ${String(w.procChance)} status chance but Q2 equals the mitigated Q1 - the proc terms are contributing nothing`);
      sawProcs = true;
    }
  }
  assert.ok(sawProcs, 'no weapon in this comparison lands a proc, so the proc half of the composition is untested');
  void sawNone;

  /*
   * AND BLEED IS NOT MITIGATED, which is the single claim the whole objective
   * turns on - and the bound above cannot see it. Mitigating bleed leaves Q2
   * comfortably above the mitigated Q1, so that check passed with the defect
   * live. This one does not.
   *
   * The discriminator is that poison IS mitigated and bleed is NOT. Take one
   * weapon, and give it two synthetic damage profiles with the same total: all
   * slash, and all toxin. Proc rate, fire rate, pellets and status chance are
   * identical, so the ONLY difference is which tick formula applies and whether
   * armour touches it:
   *
   *     residual(slash)  =  rate x bleed                 bleed tick 0.35
   *     residual(toxin)  =  rate x poison x mitigation   poison tick 0.50
   *
   *     ratio  =  0.35 / (0.50 x 0.1)  =  EXACTLY 7
   *
   * If bleed were mitigated as well, the mitigation cancels and the ratio is
   * 0.35 / 0.50 = 0.7 - a tenth of the truth, and on the wrong side of one.
   *
   * IT USED TO BE HEAT, AND HEAT STOPPED WORKING AS THE CONTROL. Once Q2
   * derives the strip, an all-heat profile strips half the target's armour, so
   * its direct term stops being `Q1 x mitigation(2700)` and the residual picks
   * up damage that has nothing to do with a tick - the ratio came out at 0.409,
   * which is neither 7 nor 0.7 and would have hidden the very defect this
   * exists to catch. Toxin strips nothing and is armour-mitigated, so it is the
   * control heat can no longer be, and the constant 7 is unchanged.
   */
  const bare = subjects[0]!;
  const baseTotal = (bare.damagePerShot ?? []).reduce((a, b) => a + b, 0);
  assert.ok(baseTotal > 0, 'the subject has no damage to redistribute');
  const asType = (index: number): ItemDbEntry => {
    const d = new Array<number>(20).fill(0);
    d[index] = baseTotal;
    return { ...bare, damagePerShot: d, totalDamage: baseTotal };
  };
  // DAMAGE_ORDER: impact, puncture, slash, heat, cold, electricity, toxin, ...
  const slashOnly = asType(2);
  const toxinOnly = asType(6);
  /*
   * The residual subtracts the DIRECT term, which now carries the faction
   * factor as well as the mitigation. Slash and toxin are both neutral against
   * every faction in the table - checked below - so the factor cancels out of
   * the ratio itself and 7 is unchanged; it does not cancel out of the
   * subtraction, which is why it is here.
   */
  const residual = (w: ItemDbEntry) => {
    const s2 = score(w, [], 'Q2').score;
    return s2.value - score(w, [], 'Q1').score.value * mitigation * universal(s2.damage).worst;
  };
  const rs = residual(slashOnly);
  const rh = residual(toxinOnly);
  assert.ok(rh > 0, 'the toxin build lands no poison at all, so this comparison proves nothing');
  /*
   * THERE IS NO NEUTRAL DAMAGE TYPE, so the factor is divided out rather than
   * assumed away.
   *
   * This asserted that slash and toxin were unresisted everywhere, which held
   * against the coarse faction grid and stopped holding the moment the exact
   * health-type table went in: slash is -50 % against Alloy Armor and toxin
   * -50 % against Fossilized. On the real table essentially every damage type
   * is penalised by SOMETHING, which is true to the game and leaves no clean
   * control anywhere.
   *
   * The discriminator does not need one. It needs the two profiles' factors to
   * cancel, and dividing by the ratio of the factors does that exactly - so 7
   * still means "bleed is unmitigated" and 0.7 still means it is not, with no
   * dependence on a property the game does not have.
   */
  const fSlash = universal(score(slashOnly, [], 'Q2').score.damage).worst;
  const fToxin = universal(score(toxinOnly, [], 'Q2').score.damage).worst;
  assert.ok(fSlash > 0 && fToxin > 0, 'a control profile scores zero against its worst target, so the ratio is undefined');
  const ratio = (rs / rh) * (fToxin / fSlash);
  assert.ok(
    Math.abs(ratio - 7) < 1e-9,
    `bleed against poison came out at ${ratio.toFixed(6)} rather than 7. At 0.7 the armour multiplier is being applied to bleed, which bypasses armour and is the whole reason this objective exists`,
  );
});

ok('the strip and the viral stacks are DERIVED from the build, and a build that makes neither gets neither', () => {
  /*
   * THE SWING THIS EXISTS TO PROTECT: 7.15x on the direct term.
   *
   * Q2 hardcoded `mitigation(2700)` = 0.1 for every build in the game, which
   * meant a corrosive weapon and a cold one were scored against the same
   * target. They are not the same target. A build sustaining ten corrosive
   * stacks and heat is facing 270 armour, not 2,700, and takes 7.15x as much
   * of its direct damage through - so the old model did not merely understate
   * every build by a constant, it preferred the wrong weapon.
   *
   * NOTHING HERE IS A SETTING. The stacks come from the weapon's own status
   * chance, multishot, fire rate and duty cycle, and from its own share of
   * corrosive, heat and viral damage. So the check that matters is a PAIR: the
   * same weapon, the same everything, differing only in which element its
   * damage is - and the one that cannot strip must be scored against full
   * armour while the one that can is not.
   */
  const mitigation = enemyDamageMultiplier(Q2_TARGET_ARMOUR);
  const bare = item;
  const baseTotal = (bare.damagePerShot ?? []).reduce((a, b) => a + b, 0);
  assert.ok(baseTotal > 0, 'the subject has no damage to redistribute');
  const asType = (index: number): ItemDbEntry => {
    const d = new Array<number>(20).fill(0);
    d[index] = baseTotal;
    return { ...bare, damagePerShot: d, totalDamage: baseTotal };
  };
  // Full status, so the derived stack counts are at their caps rather than near zero.
  const certain = (w: ItemDbEntry): ItemDbEntry => ({ ...w, procChance: 1 });
  // DAMAGE_ORDER: impact 0, puncture 1, slash 2, heat 3, cold 4, ... viral 11, corrosive 12.
  const impact = certain(asType(0));
  const corrosive = certain(asType(12));
  const viral = certain(asType(11));

  const q1 = (w: ItemDbEntry) => score(w, [], 'Q1').score.value;
  const q2 = (w: ItemDbEntry) => score(w, [], 'Q2').score.value;
  /*
   * THE FACTION FACTOR, READ OFF EACH PROFILE'S OWN VECTOR.
   *
   * Every expectation below is `Q1 x <what armour does> x <what the worst
   * faction does>`, and the second half is new. These synthetic profiles are
   * single-element by construction, so the factor is exactly what the table
   * says about that one element - corrosive is halved by Sentient, viral by
   * Infested Deimos and The Murmur, impact by nobody - which is why the
   * corrosive assertion failed at precisely 2x when the factor went in.
   *
   * It is read through the model rather than typed, so a table refresh moves
   * the gate and the objective together instead of silently parting them.
   */
  const worst = (w: ItemDbEntry) => universal(score(w, [], 'Q2').score.damage).worst;

  /*
   * Impact procs nothing this model scores and strips nothing, so its Q2 is
   * exactly its Q1 through full armour. That is the control, and it is what
   * makes the other two mean something.
   */
  /*
   * The control is no longer "neutral"; it is "carries no strip and no viral".
   * Impact is -25 % against Flesh on the exact table, so its factor is 0.75 and
   * not 1 - and the expectation below reads that factor from the model rather
   * than asserting it, which is what makes the check about STRIPPING.
   */
  assert.ok(Math.abs(q2(impact) - q1(impact) * mitigation * worst(impact)) < 1e-9, `impact is not scored against full armour: ${String(q2(impact))} vs ${String(q1(impact) * mitigation * worst(impact))}`);

  /*
   * Corrosive: same weapon, same damage, one element changed. Ten stacks is
   * 80 %, so 540 armour and `1 - 0.9 x sqrt(0.2)` arriving. The gate computes
   * that from the module's own published constants rather than from the
   * optimiser, so a change to the strip has to be a change to BOTH.
   */
  const strippedArriving = enemyDamageMultiplier(netArmour(Q2_TARGET_ARMOUR, CORROSIVE_MAX_STRIP));
  assert.ok(Math.abs(q2(corrosive) - q1(corrosive) * strippedArriving * worst(corrosive)) < 1e-9, `corrosive is not stripping: ${String(q2(corrosive))} vs ${String(q1(corrosive) * strippedArriving * worst(corrosive))}`);
  assert.ok(strippedArriving / mitigation > 5.9, `stripping is worth only ${(strippedArriving / mitigation).toFixed(2)}x, so the swing this models has gone`);

  /*
   * Viral: no strip at all - it is a health multiplier, not an armour one - so
   * the target is still at 2,700 and the whole figure carries x4.25.
   */
  assert.ok(Math.abs(q2(viral) - q1(viral) * mitigation * viralMultiplier(VIRAL_MAX_STACKS) * worst(viral)) < 1e-9, `viral is not multiplying: ${String(q2(viral))} vs ${String(q1(viral) * mitigation * viralMultiplier(VIRAL_MAX_STACKS) * worst(viral))}`);
  assert.ok(viralMultiplier(VIRAL_MAX_STACKS) === 4.25, 'the viral cap moved');

  /*
   * AND VIRAL REACHES THE BLEED TICK, which the pure-viral profile above cannot
   * see because it lands no bleed at all. This is the settled fact that decides
   * whether viral and slash compete or compound, and a scorer that multiplied
   * only the direct term would pass every assertion above it.
   *
   * Two profiles, same weapon, same total damage, neither stripping anything:
   * all slash, and half slash half viral. The direct term is identical, so
   *
   *     Q2(slash)        =  Dm + B
   *     Q2(slash+viral)  =  (Dm + B/2) x 4.25       <- viral on BOTH terms
   *
   * with `Dm` read off Q1 and `B` read off the first equation. If viral touched
   * only the direct term the right-hand side would be `Dm x 4.25 + B/2`, which
   * is smaller by `B x 1.625` - and B is most of a slash weapon's damage.
   */
  const slashFull = certain(asType(2));
  const slashViral: ItemDbEntry = { ...slashFull, damagePerShot: (() => { const d = new Array<number>(20).fill(0); d[2] = baseTotal / 2; d[11] = baseTotal / 2; return d; })() };
  const dm = q1(slashFull) * mitigation * worst(slashFull);
  const bleedTerm = q2(slashFull) - dm;
  assert.ok(bleedTerm > dm, 'the all-slash profile lands almost no bleed, so this comparison proves little');
  // The half-viral profile is halved by viral's own resistances; the all-slash one is not.
  const expected = (dm + bleedTerm / 2) * viralMultiplier(VIRAL_MAX_STACKS) * (worst(slashViral) / worst(slashFull));
  assert.ok(
    Math.abs(q2(slashViral) - expected) < 1e-6,
    `viral is not reaching the bleed tick: ${String(q2(slashViral))} vs ${String(expected)} (direct-only would give ${String(dm * viralMultiplier(VIRAL_MAX_STACKS) + bleedTerm / 2)})`,
  );

  /*
   * AND A WEAPON WITH NO STATUS AT ALL DERIVES NOTHING, however corrosive its
   * damage is. This is the half a mean-value check cannot see: a strip applied
   * from the damage vector alone, ignoring whether the weapon can actually land
   * the proc, would pass every assertion above and be wrong for every weapon
   * in the game with low status chance.
   */
  const silent: ItemDbEntry = { ...corrosive, procChance: 0 };
  assert.ok(Math.abs(q2(silent) - q1(silent) * mitigation * worst(silent)) < 1e-9, `a weapon with no status chance is stripping anyway: ${String(q2(silent))} vs ${String(q1(silent) * mitigation * worst(silent))}`);

  // The two strips combine on what is left, so the pair is worth more than either.
  assert.ok(combinedStrip(CORROSIVE_MAX_STRIP, HEAT_MAX_STRIP) > CORROSIVE_MAX_STRIP, 'heat adds nothing on top of corrosive');
});

ok('a fire rate the catalogue does not carry is ABSENT, not zero - and no equippable weapon scores nothing', () => {
  /*
   * A REAL WEAPON SCORED EXACTLY 0.0 IN THE SHIPPED APP, and it took a census
   * to see it, because it is one row out of 195.
   *
   * The Lanka is a charge sniper. WFCD carries `fireRate: 0` for it with no
   * `chargeTime`, and so does DE's own `ExportWeapons` - a charge weapon's rate
   * depends on its charge and neither feed publishes a charge time. Read as a
   * rate, that zero multiplied the whole damage term away: every mod scored the
   * same nothing, `preferable` chose between equals, and the overlay printed a
   * plan built on 0.0 with no mark on it.
   *
   * Absence is the truth, so the figure becomes PER SHOT and says so. This gate
   * holds BOTH halves - the arithmetic that says what the answer must be, and
   * the census that finds the class - because either alone passed while the
   * defect was live for every build this app has ever planned on a Lanka.
   */
  const lanka = weapons.find((w) => w.name === 'Lanka');
  assert.ok(lanka, 'the Primary export no longer carries the Lanka');
  assert.equal(lanka.fireRate, 0, 'the Lanka now has a fire rate, so this gate is measuring a case that no longer exists');

  const s = score(lanka, [], 'Q1');
  assert.ok(s.score.value > 0, `the Lanka still scores ${String(s.score.value)} - an absent fire rate is being read as a rate of zero`);
  assert.equal(s.score.fireRate, null, 'the absent rate is being reported as a number');
  assert.ok(s.score.figureNote !== null && s.score.figureNote.includes('PER SHOT'), 'the figure is per shot and the overlay is not being told so');
  assert.ok(s.unscored > 0, 'the unknown fire rate is not counted as unscored');

  // And it is exactly the per-shot damage, not a per-second figure with a 1 standing in for the rate.
  const cc = lanka.criticalChance ?? 0;
  const cd = lanka.criticalMultiplier ?? 1;
  const crit = 1 + cc * (cd - 1);
  assert.ok(
    Math.abs(s.score.value - s.score.perShot * s.score.pellets * crit) < 1e-6,
    `the per-shot figure is ${String(s.score.value)}, not ${String(s.score.perShot * s.score.pellets * crit)}`,
  );

  // Q2 refuses to derive a strip from a per-shot count read as though it were per second.
  const q2 = score(lanka, [], 'Q2').score;
  assert.ok(q2.value > 0 && q2.value < s.score.value, `Q2 ${String(q2.value)} against Q1 ${String(s.score.value)}: armour must still cost this weapon damage`);

  /*
   * THE CENSUS. One weapon is a fix; the class is what a gate is for. Every
   * primary the app would ever plan must score something, or the plan it builds
   * is a ranking of equals dressed up as a decision.
   */
  const zeros = weapons.filter((w) => {
    const q = questionFor(w);
    return q !== null && score(w, [], q).score.value === 0;
  });
  assert.deepEqual(
    zeros.map((w) => w.name),
    [],
    `these primaries score exactly nothing: ${zeros.map((w) => `${w.name} (rate ${String(w.fireRate)}, damage ${String(w.totalDamage)})`).join(', ')}`,
  );
});

console.log(`\n  Ideal Braton (Q1): ${result.ideal.placed.map((p) => `${p.name} ${p.rank}`).join(' · ')}`);
console.log(`  ${result.ideal.drain}/${result.ideal.capacity} drain · ${result.ideal.score.value.toFixed(0)} dps · ${result.candidates.scored} of ${result.candidates.eligible} eligible mods scored by Q1`);

// `survivability` lives in `survive.ts`, not in `optimise.ts`, and the harness's
// existing import block does not carry it. Six call sites below need it.
import { survivability } from '../src/data/survive.ts';

console.log('\nthe real catalogue on a real Warframe');

const ash = parseWfcd('Warframes', frames).find((w) => w.uniqueName === '/Lotus/Powersuits/Ninja/Ninja');
assert.ok(ash && ash.name === 'Ash', 'the export carries Ash at /Lotus/Powersuits/Ninja/Ninja');
/*
 * A NECRAMECH IS THE COUNTEREXAMPLE THE AURA GATE NEEDS, AND IT IS NOT A
 * SYNTHETIC ONE.
 *
 * Voidrig lives in `Warframes.json`, not in a file of its own, and it has no
 * aura slot at all. `prepare` refuses it one by `productCategory`, and without
 * a mech among the fixtures nothing here could tell whether that guard is still
 * there: every other item in this section either plainly has an aura or plainly
 * is not a Warframe.
 *
 * ONLY THE PRODUCT CATEGORY IS ASSERTED, and that is a measurement rather than
 * a preference. The cached export on this machine says `type: 'Warframe'`; the
 * live one now says `type: 'Necramech'`, so a fixture pinned to the type would
 * pass here and fail the first time anybody ran this without a cache. The
 * category has not moved, and it is the field `prepare` actually reads.
 */
const voidrig = parseWfcd('Warframes', frames).find((w) => w.uniqueName === '/Lotus/Powersuits/EntratiMech/NechroTech');
assert.ok(voidrig && voidrig.productCategory === 'MechSuits', 'the export carries Voidrig as a MechSuits row');

const frameSlots = slotPlanFor({ rank: 30, maxRank: 30, masteryRank: 20, catalyst: true, stanceBonus: null, gridPolarities: [] });
const frameResult = plan({ item: ash, catalogue, owned: everything, slots: frameSlots.plan, question: 'Q3' });
const frameBare = plan({ item: ash, catalogue, owned: new Map<string, number>(), slots: frameSlots.plan, question: 'Q3' });
/* The same grid on the mech: the only thing asked of it is whether a slot it does not have got filled. */
const mechResult = plan({ item: voidrig, catalogue, owned: everything, slots: frameSlots.plan, question: 'Q3' });

/** The catalogue row behind a card the plan produced. `db.byPath` is the map `catalogue` was built from. */
function rowFor(p: { path: string; name: string }) {
  const row = db.byPath.get(p.path);
  assert.ok(row, `${p.name} was placed at ${p.path}, which is in no catalogue row`);
  return row;
}

/** A named mod at the highest rank it can reach, which is what every Ideal build uses. */
function modNamed(name: string) {
  const row = catalogue.find((r) => r.displayName === name);
  assert.ok(row, `the catalogue carries ${name}`);
  return { row, rank: row.fusionLimit ?? row.ranks - 1 };
}

ok('a Warframe takes WARFRAME mods and never a weapon mod', () => {
  const s = eligibleSlots(ash);
  // Two classes and no more: the WARFRAME pool, and the augments keyed to this
  // frame's own name. Anything else in here is a weapon mod on a Warframe.
  assert.deepEqual([...s].sort(), [ash.name, 'WARFRAME'].sort(), `Ash accepts ${[...s].join(', ')}`);
  for (const weapon of ['Rifle', 'PRIMARY', 'Assault Rifle', 'Shotgun', 'Pistol', 'Melee', 'Archgun', 'Necramech']) {
    assert.ok(!s.has(weapon), `a Warframe was offered ${weapon} mods`);
  }
  /*
   * THE COUNT THE PLAN ITSELF REPORTS, derived from the CLAIM rather than from
   * `eligibleSlots` - deriving it from the function under test would pass no
   * matter what that function did.
   *
   * This is the assertion that actually catches a widened pool. Handing a frame
   * the Rifle class would place no Rifle mod, because Q3 scores none of their
   * effects and `prepare` drops an unscorable row before the search ever sees
   * it - so a gate that only looks at what was PLACED reads clean while the
   * candidate pool has grown by seventy mods, from 122 to 192.
   */
  const byTheRule = catalogue.filter((r) => (r.slot === 'WARFRAME' || r.slot === ash.name) && r.ranks > 0 && !r.isAura && !r.isFlawed);
  assert.equal(frameResult.candidates.eligible, byTheRule.length, `the plan weighed ${frameResult.candidates.eligible} mods against ${byTheRule.length} carrying Ash's own classes`);
  for (const p of [...frameResult.ideal.placed, ...frameResult.ceiling.placed]) {
    assert.equal(rowFor(p).slot, 'WARFRAME', `${p.name} is a ${String(rowFor(p).slot)} mod on a Warframe`);
    assert.match(p.path, /\/Mods\/(Warframe|Sets)\//, `${p.name} sits at ${p.path}, which is not a Warframe mod path`);
  }
  /*
   * AND THE SAME GUARD ON THE MECH, which is the half the Voidrig fixture was
   * not being asked for. Without these two lines the mech branch can be deleted
   * from `eligibleSlots` - handing a Necramech all 122 Warframe mods it cannot
   * equip - with every check in this file still green.
   */
  assert.deepEqual([...eligibleSlots(voidrig)].sort(), [voidrig.name, 'Necramech'].sort(), `Voidrig accepts ${[...eligibleSlots(voidrig)].join(', ')}`);
  const mechRule = catalogue.filter((r) => (r.slot === 'Necramech' || r.slot === voidrig.name) && r.ranks > 0 && !r.isAura && !r.isFlawed);
  assert.equal(mechResult.candidates.eligible, mechRule.length, `the mech weighed ${mechResult.candidates.eligible} mods against ${mechRule.length} of its own`);
});

ok('the bare frame scores its own effective health, and the ideal build multiplies it', () => {
  /*
   * The three numbers the whole objective rests on, as the export states them
   * and as the game's own Arsenal prints them. They are asserted rather than
   * read past because every figure below is a function of them: a catalogue
   * drift would move the answer silently, and this names which end moved.
   */
  assert.deepEqual([ash.health, ash.shield, ash.armor], [455, 270, 105], `Ash reads ${String(ash.health)}/${String(ash.shield)}/${String(ash.armor)}`);
  // An account owning nothing builds nothing: no aura, no mods, no drain.
  assert.deepEqual(frameBare.now.placed, []);
  assert.equal(frameBare.now.aura, null);
  assert.equal(frameBare.now.drain, 0);
  /*
   * Derived through `survivability` rather than written as 884.25, so a change
   * to the Tenno armour constant fails here and in `check-survive` together
   * instead of leaving one of them asserting a number the app no longer
   * computes. The literal is kept beside it because it is the measured figure -
   * 455 x 1.35 from 105 armour, plus 270 shields - and `check-survive.ts` pins
   * it from the other end.
   */
  const bare = survivability({ health: ash.health ?? 0, shield: ash.shield ?? 0, armour: ash.armor ?? 0 }).effectiveHealth;
  assert.equal(bare, 884.25, 'the Tenno curve on Ash: 455 x 1.35 + 270');
  assert.equal(frameBare.now.score.value, bare, `an unmodded Ash scored ${frameBare.now.score.value}, not its own effective health`);
  // The Ideal is what EXISTS, so it cannot depend on what the account holds.
  assert.equal(frameBare.ideal.score.value, frameResult.ideal.score.value, 'the Ideal build moved when the account changed');
  assert.ok(frameResult.ideal.score.value > bare * 4, `ideal ${frameResult.ideal.score.value} is not four times the bare ${bare}`);
  /*
   * `plan` ENFORCES THIS BY CONSTRUCTION - its last line takes the better of
   * the two - so on this fixture the line cannot fail: the universal-polarity
   * ceiling already beats the unpolarised ideal on Ash by a third. The case the
   * module built that guard for is an Umbra-polarised grid, which this slot
   * plan does not have. Kept as a cheap invariant, not counted as coverage.
   */
  assert.ok(frameResult.ceiling.score.value >= frameResult.ideal.score.value, `ceiling ${frameResult.ceiling.score.value} below ideal ${frameResult.ideal.score.value}`);
});

ok('the aura is a ninth slot: it adds capacity, it is scored, and only a frame has one', () => {
  const aura = frameResult.ideal.aura;
  assert.ok(aura, 'the Ideal Ash took no aura at all');
  /*
   * NEGATIVE DRAIN IS THE WHOLE MECHANISM. An aura does not spend capacity, it
   * hands capacity to the eight - so the plan's own capacity must be the slot
   * plan's plus what the aura gave back, and 60 arriving here would mean the
   * search made its eight choices against a grid seven points smaller than the
   * one the player actually has.
   */
  assert.ok(aura.drain < 0, `the aura's drain is ${aura.drain}, which spends capacity rather than adding it`);
  assert.equal(frameResult.ideal.capacity, frameSlots.plan.capacity - aura.drain, `capacity arrived as ${frameResult.ideal.capacity} against ${frameSlots.plan.capacity} plus ${-aura.drain}`);
  // A ninth slot, so it is not one of the eight and does not consume one. The
  // length bound cannot fail while `search` loops `depth < GRID_SLOTS`; Ash
  // places six. It is the path check on the next line that carries this claim.
  assert.ok(frameResult.ideal.placed.length <= GRID_SLOTS, `${frameResult.ideal.placed.length} mods on a grid of ${GRID_SLOTS}`);
  assert.ok(!frameResult.ideal.placed.some((p) => p.path === aura.path), `${aura.name} is both the aura and one of the eight`);
  /*
   * SCORED, MEASURED AT THE CONSUMER. `search` scores the aura by appending it
   * to the set it evaluates, and a version that forgot to would still report a
   * capacity, an aura card and a plausible build - the printed figure would just
   * quietly be the eight mods' figure. So the claim is checked as the difference
   * the aura makes to the number the overlay receives.
   */
  const grid = frameResult.ideal.placed.map((p) => ({ row: rowFor(p), rank: p.rank }));
  const withoutAura = score(ash, grid, 'Q3').score.value;
  const withAura = score(ash, [...grid, { row: rowFor(aura), rank: aura.rank }], 'Q3').score.value;
  assert.ok(withAura > withoutAura, `${aura.name} adds nothing: ${withAura} with it, ${withoutAura} without`);
  assert.ok(Math.abs(frameResult.ideal.score.value - withAura) < 1e-9, `the plan reported ${frameResult.ideal.score.value}; the eight plus the aura score ${withAura}, the eight alone ${withoutAura}`);
  /*
   * ONLY A FRAME. A weapon has no aura slot, and neither does a Necramech -
   * which is the case that actually bites, because a mech ships inside
   * `Warframes.json` and was typed 'Warframe' there for as long as this app has
   * been reading it. Handing one the 36 Warframe auras inflates its capacity
   * with a negative drain AND inflates the very figure Q3 reports, through a
   * `maximum health` aura it cannot equip.
   */
  assert.equal(result.ideal.aura, null, 'a rifle was given an aura');
  assert.equal(result.ideal.capacity, slots.capacity, `a rifle's capacity moved from ${slots.capacity} to ${result.ideal.capacity}`);
  assert.equal(mechResult.ideal.aura, null, 'a Necramech was given a Warframe aura');
  assert.equal(mechResult.ideal.capacity, frameSlots.plan.capacity, `a Necramech's capacity moved to ${mechResult.ideal.capacity}`);
});

ok('the survival stats are scored under the names the CATALOGUE uses, not the English ones', () => {
  /*
   * THE DEFECT THIS EXISTS FOR: the scored set was written from the English
   * names of the stats - health, shield, armor - and the parser emits `shield
   * capacity`. `shield` matched no row in the game, so every shield mod in it,
   * Redirection included, was worth exactly zero to an objective whose entire
   * job is how much a frame can take. Nothing threw and no name was misspelt.
   *
   * So a name match is not what is asserted here. Each mod below carries ONE
   * stat, and what is demanded is that the number the consumer receives MOVES,
   * to the exact value the survival model gives for that bucket - which also
   * catches the value landing in the WRONG bucket, where both a name check and
   * a bare "did it move" check would pass.
   */
  const base = { health: ash.health ?? 0, shield: ash.shield ?? 0, armour: ash.armor ?? 0 };
  const bare = survivability(base).effectiveHealth;
  const cases = [
    { mod: 'Vitality', stat: 'health', expect: survivability({ ...base, healthPct: 100 }).effectiveHealth },
    { mod: 'Redirection', stat: 'shield capacity', expect: survivability({ ...base, shieldPct: 100 }).effectiveHealth },
    { mod: 'Steel Fiber', stat: 'armor', expect: survivability({ ...base, armourPct: 100 }).effectiveHealth },
    // An aura, and the second name that scored nothing: the auras say `maximum
    // health` and their target is `squad` rather than `self`, so this one line
    // covers both halves of that fix at once.
    { mod: 'Physique', stat: 'maximum health', expect: survivability({ ...base, healthPct: 20 }).effectiveHealth },
  ];
  for (const c of cases) {
    const m = modNamed(c.mod);
    const stats = m.row.effects.filter((e) => e.rank === m.rank).map((e) => e.stat);
    assert.deepEqual(stats, [c.stat], `${c.mod} at rank ${m.rank} emits ${stats.join(', ')} - the name upstream has changed`);
    // Annotated because the compiler will not infer it: `assert.ok` is an
    // assertion signature, and asserting on a freshly-declared const inside the
    // same block reports TS7022 on it unless the type is stated outright.
    const value: number = score(ash, [m], 'Q3').score.value;
    assert.ok(value > bare, `${c.mod} moved nothing: ${c.stat} is not in the scored set, so every mod carrying it is worth zero`);
    assert.equal(value, c.expect, `${c.mod} gave ${value} where ${c.stat} into its own bucket gives ${c.expect}`);
  }
});

ok('a Warframe plan carries the FRAME assumptions, which make no claim about weapons', () => {
  assert.equal(questionFor(ash), 'Q3', 'a Warframe is not being asked the survival question');
  assert.equal(assumptionsFor('Q3'), FRAME_ASSUMPTIONS);
  assert.equal(assumptionsFor('Q1'), ASSUMPTIONS);
  assert.equal(assumptionsFor('Q2'), ASSUMPTIONS);
  /*
   * All the builds, not just the Ideal. `plan` produces `now`, `ideal` and
   * `ceiling` from separate searches and then spreads each of them through
   * `withOwned`, so one of the three carrying the wrong list is exactly the
   * shape of defect this repo has shipped before - a correct value vetoed, or
   * replaced, on one path out of three.
   */
  for (const b of [frameResult.now, frameResult.ideal, frameResult.ceiling, frameBare.now, frameBare.ideal, mechResult.ideal]) {
    assert.equal(b.assumptions, FRAME_ASSUMPTIONS, 'a frame build is carrying the weapon assumptions');
  }
  assert.equal(result.ideal.assumptions, ASSUMPTIONS, 'a rifle build is carrying the frame assumptions');
  /*
   * THE FALSE CLAIM THAT WAS ACTUALLY TRAVELLING ON ASH: "melee damage per
   * second is HALF the figure the game prints". A true statement about one
   * melee capture, attached to something that has never held a weapon. Four of
   * the seven entries on the single shared list were false the moment Q3
   * existed, and nothing rendered any of them - which is precisely why it was
   * worth fixing before something did.
   */
  // `\bcharge\b` rather than `charge`, because the frame list legitimately says
  // "recharge rate" about shields - the first draft of this regex failed on it.
  const weaponWords = /melee|rifle|shotgun|pistol|fire rate|\bcharge\b|multishot|the figure the game prints/i;
  for (const s of FRAME_ASSUMPTIONS) assert.ok(!weaponWords.test(s), `a frame's assumptions claim: ${s}`);
  // Without this, the regex above could quietly stop matching anything at all.
  assert.ok(ASSUMPTIONS.some((s) => weaponWords.test(s)), 'the weapon list no longer says any of the things a frame must not say: the filter above has stopped testing anything');
  /*
   * The same sentence is on both lists. This does NOT prove it is shared by
   * reference: `includes` compares string VALUES, and a string primitive has no
   * reference identity, so a character-for-character copy passes here. What it
   * does catch is the sentence going missing from either list, and a copy the
   * day it drifts from the constant.
   */
  assert.ok(FRAME_ASSUMPTIONS.includes(GRID_ASSUMPTION) && ASSUMPTIONS.includes(GRID_ASSUMPTION), 'the grid-size sentence is not on both lists');
});

ok('no Flawed mod reaches a build, on any item or question - the pool never contains one', () => {
  /*
   * The overlay shipped telling the player to farm a Flawed mod for about a
   * thousand runs. They are strictly weaker AND cheaper, so at a binding
   * capacity the search prefers them and its arithmetic is right while the
   * advice is worthless: the game hands them out in the first hour.
   *
   * `moddb` flags them from the `Beginner` path segment. The first fix tested
   * the NAME for a 'Flawed ' prefix and caught nothing at all, because the
   * export does not carry the prefix - so this gate goes through `isFlawed` and
   * measures the pool SIZE, which is the only place the exclusion is observable
   * before a mod either does or does not win a slot.
   */
  const flawed = catalogue.filter((r) => r.isFlawed);
  assert.ok(flawed.length > 0, 'the catalogue flags no Flawed mods at all: isFlawed has stopped being set');
  const flawedPaths = new Set(flawed.map((r) => r.uniqueName));
  for (const p of [
    { what: 'Ash', it: ash, reported: frameResult.candidates.eligible },
    { what: 'the Braton', it: item, reported: result.candidates.eligible },
  ]) {
    const cls = eligibleSlots(p.it);
    const all = catalogue.filter((r) => r.slot !== null && cls.has(r.slot) && r.ranks > 0 && !r.isAura);
    const clean = all.filter((r) => !r.isFlawed);
    // Without this the count below would agree for the dullest possible reason.
    assert.ok(all.length > clean.length, `no Flawed mod is even eligible for ${p.what}: this gate is testing nothing`);
    assert.equal(p.reported, clean.length, `${p.what} weighed ${p.reported} mods against ${clean.length} eligible non-Flawed (${all.length - clean.length} Flawed)`);
  }
  /*
   * And nothing Flawed at any consumer, under both questions: the eight, the
   * ceiling's eight, the aura, and the acquisition list - which is where the
   * "about 1000 runs" line was actually printed.
   */
  const arrived = [
    ...frameResult.ideal.placed,
    ...frameResult.ceiling.placed,
    ...frameBare.ideal.placed,
    ...frameBare.next,
    ...result.ideal.placed,
    ...result.ceiling.placed,
    ...result.next,
    ...[frameResult.ideal.aura, frameResult.ceiling.aura, frameBare.ideal.aura].filter((a) => a !== null),
  ];
  assert.ok(arrived.length > 0, 'nothing was placed or recommended anywhere: this gate is testing nothing');
  for (const p of arrived) assert.ok(!flawedPaths.has(p.path), `${p.name} is a Flawed mod and it reached a build`);
});

ok('a Warframe is not marked for a fire rate the survival question never asks about', () => {
  /*
   * A ZERO FIRE RATE IS AN ABSENT FIELD, and `score` treats an absent one as a
   * gap: it counts an unscored effect and stamps the figure with a "this is PER
   * SHOT" note. That is right for a charge weapon like the Lanka, where the
   * rate really is missing information the catalogue does not carry.
   *
   * A Warframe has no fire rate because a Warframe is not a gun. Q3 never
   * multiplies by a rate, so nothing whatever is missing, and both the count
   * and the note would be the app confessing to a gap that does not exist -
   * printed over the game with the Arsenal's own diamond marker beside it.
   */
  const bare = score(ash, [], 'Q3');
  // Q3 asks about survival and never about a damage matchup, so it carries none.
  assert.equal(bare.score.weakest, null, 'Q3 is carrying a damage matchup it never computed');
  assert.equal(bare.score.fireRate, null, 'the export now gives Ash a fire rate: this gate is testing nothing');
  assert.equal(bare.score.figureNote, null, `an unmodded Ash carries a figure note: ${String(bare.score.figureNote)}`);
  assert.equal(bare.unscored, 0, `an unmodded Ash reports ${bare.unscored} unscored effects, with no mods on it`);
  assert.equal(frameResult.ideal.score.figureNote, null, `the Ideal Ash carries a figure note: ${String(frameResult.ideal.score.figureNote)}`);
  /*
   * The other side of the branch, on the same item, so the exemption is proved
   * SPECIFIC to Q3 rather than the absent-rate counter having simply died.
   */
  const asAWeapon = score(ash, [], 'Q1');
  assert.equal(asAWeapon.unscored, 1, `Q1 reports ${asAWeapon.unscored} unscored on an item with no rate: the absent-rate count is dead`);
  assert.ok(asAWeapon.score.figureNote !== null && /PER SHOT/.test(asAWeapon.score.figureNote), 'Q1 no longer marks an absent fire rate at all');
});

// This import belongs at the top of scripts/check-optimise.ts, beside the
// existing `routeTo` import - `rankCost` is NOT re-exported by optimise.ts.
import { rankCost } from '../src/data/fusion.ts';

console.log('\nthe ladder from now to ideal');

/*
 * THE ACCOUNT THIS SECTION CLIMBS FROM, DERIVED RATHER THAN WRITTEN DOWN.
 *
 * Every fourth row of the real Mods.json, held two ranks short of its maximum:
 * the shape of an account that has played a while and finished almost nothing.
 * No mod, rank or drain here was invented - the paths, the ranks and the ceiling
 * all come out of the catalogue the harness already fetched, and the fixture
 * changes with it rather than going quietly stale beside it.
 *
 * Serration is then pinned to 5 of 10 ON PURPOSE. Without that one line every
 * rung on this ladder is an acquisition, `fromRank` is null on all of them, and
 * the rank-up half of "what rank to take it to, and what it costs" is never
 * exercised at all - a gate that passes while the defect it exists to catch is
 * live, which this repository has now shipped three times. The path is the real
 * Serration row, the same one the Ideal-build gate above pins.
 */
const LADDER_SERRATION = '/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod';
const ladderOwned = new Map<string, number>();
let ladderNth = 0;
for (const r of catalogue) if (ladderNth++ % 4 === 0) ladderOwned.set(r.uniqueName, Math.max(0, (r.fusionLimit ?? r.ranks - 1) - 2));
ladderOwned.set(LADDER_SERRATION, 5);

const climb = plan({ item, catalogue, owned: ladderOwned, slots });

/*
 * ONE DRAIN OF THE GENERATOR, SHARED BY EVERY GATE BELOW.
 *
 * A ladder is a second or more of solid work (16 rungs over 101 searches on this
 * fixture, measured here), so running it once per assertion would multiply the
 * whole check-suite's cost by eight to learn nothing new. The nulls are kept as
 * well as the rungs: they are the generator handing control back between
 * searches, and the count of them between two rungs is the only thing that says
 * whether the controller could still have answered while this was being built.
 */
const rungs: Rung[] = [];
/** Searches spent before each rung, in the same order - index k belongs to rungs[k]. */
const searchesBefore: number[] = [];
let ladderSearches = 0;
let sinceRung = 0;
for (const r of ladder({ item, catalogue, owned: ladderOwned, slots }, climb)) {
  if (r === null) {
    ladderSearches++;
    sinceRung++;
    continue;
  }
  rungs.push(r);
  searchesBefore.push(sinceRung);
  sinceRung = 0;
}

/*
 * THE UNION HAS THREE VARIANTS AND ONLY ONE OF THEM CARRIES A PATH.
 *
 * `Rung` is 'mod' | 'aura' (a path, a rank, a cost, a route), 'forma' (a
 * polarity and nothing else) and 'unlock' (a planet). Reading `.path` off the
 * whole union is the shape of bug this project has already had once, so the
 * split happens here, once, and every gate below works from the narrowed lists
 * rather than re-testing `kind` inline and hoping.
 */
const modRungs = rungs.filter((r): r is Extract<Rung, { kind: 'mod' | 'aura' }> => r.kind === 'mod' || r.kind === 'aura');
const formaRungs = rungs.filter((r): r is Extract<Rung, { kind: 'forma' }> => r.kind === 'forma');

/*
 * WHAT THE LADDER IS ALLOWED TO OFFER, re-derived here from the two builds and
 * the account rather than read off the ladder's own working state.
 *
 * `ladder` builds this same set internally from `built.ideal` and its target,
 * skipping anything the account already holds at or above the wanted rank. A
 * gate that asked the ladder what it wanted and then checked it against what it
 * wanted would assert nothing; this is the independent copy, and the two
 * disagreeing is exactly the failure worth catching.
 */
const ladderWanted = new Set<string>();
for (const b of [climb.ideal, climb.ceiling]) {
  for (const p of [...b.placed, ...(b.aura ? [b.aura] : [])]) {
    const held = ladderOwned.get(p.path);
    if (held === undefined || held < p.rank) ladderWanted.add(p.path);
  }
}

ok('the ladder climbs to the CEILING, not to the build the current grid happens to allow', () => {
  /*
   * `ideal` is searched against the grid the account actually has, so it always
   * fits by construction and a ladder aimed at it can never need a Forma. The
   * brief asks the other question outright - what to do to push the build past
   * what the player is currently capable of - and the answer to that is the
   * ceiling. Measured on this fixture: an ideal of 3,755 against a ceiling of
   * 12,421, so aiming at the wrong one leaves two thirds of the weapon on the
   * table while reporting there is nothing left to do.
   *
   * The ceiling assertion is the one that carries this gate. Aiming at `ideal`
   * instead does NOT stop the ladder at 3,755 - the Forma rungs carry it to
   * 5,500 - so the "above the ideal" line still passes and only the line below
   * it fires. Measured, with `target = built.ideal`.
   */
  assert.ok(climb.ceiling.score.value > climb.ideal.score.value * 2, `ceiling ${climb.ceiling.score.value} is not meaningfully above ideal ${climb.ideal.score.value}, so this proves nothing`);
  const last = rungs.at(-1);
  assert.ok(last, 'the ladder produced no rungs at all');
  assert.ok(last.value > climb.ideal.score.value + 1e-6, `the ladder ended at ${last.value}, which is the grid ideal ${climb.ideal.score.value} and no further`);
  assert.ok(last.value >= climb.ceiling.score.value - 1e-6, `the ladder ended at ${last.value} of a ceiling of ${climb.ceiling.score.value}`);
});

ok('every rung is measured against the rung before it, not against Now', () => {
  /*
   * This is the whole reason `ladder` exists beside `next`. Every entry in
   * `next` is measured from the same Now, so doing the top one makes every other
   * number in the list a claim about a build that no longer exists. A rung's
   * `gain` is over the rung BEFORE it and its `value` is what the build scores
   * once it is done, which is what makes the sequence readable as one arc.
   *
   * The identity is asserted on the value that ARRIVES on the rung, not on the
   * subtraction inside the module: a `gain` computed correctly and then
   * overwritten downstream would pass any check of the arithmetic alone.
   *
   * `differs` is the half that stops this passing vacuously. If gain and
   * (value - Now) agreed everywhere, the two readings would be the same reading
   * and the assertion above would hold for a ladder measured entirely from Now.
   * They agree only on the first rung, where they must.
   */
  const now = climb.now.score.value;
  let prev = now;
  let differs = 0;
  for (const r of rungs) {
    assert.ok(Math.abs(r.gain - (r.value - prev)) < 1e-6, `rung ${String(r.step)}: gain ${r.gain} but the build moved ${r.value - prev}`);
    if (Math.abs(r.gain - (r.value - now)) > 1) differs++;
    prev = r.value;
  }
  assert.ok(differs >= rungs.length - 1, `only ${String(differs)} of ${String(rungs.length)} rungs read differently from Now, so gain and total are the same number here`);
  const sum = rungs.reduce((n, r) => n + r.gain, 0);
  assert.ok(Math.abs(now + sum - prev) < 1e-6, `the gains sum to ${sum} but the climb from ${now} was ${prev - now}`);
});

ok('a rung is an instruction: it says where to get it, or what rank to take it to, and what it costs', () => {
  /*
   * "You are missing Serration" is where the advice used to stop, and it is not
   * an instruction. A rung has to carry the place and the runs for a mod the
   * account lacks, the rank and the Endo for one it holds, and the card's own
   * anatomy - rarity, polarity, drain, pip count - for the overlay to draw it as
   * the game draws a mod rather than as a line of text.
   *
   * Each field is checked against what the CATALOGUE says rather than against a
   * literal, so a rung built from the wrong row fails here instead of looking
   * plausible. `cost` and `route` are re-derived through the same two functions
   * the module uses, which cannot catch those functions being wrong (their own
   * gates do that) but does catch the arguments being wrong - and the argument
   * that matters is the rank the account already holds.
   */
  assert.ok(modRungs.length >= 4, `only ${String(modRungs.length)} mod rungs, too few to say anything`);
  for (const r of modRungs) {
    const row = catalogue.find((x) => x.uniqueName === r.path);
    assert.ok(row, `${r.path} is on a rung and not in the catalogue`);
    assert.equal(r.name, row.displayName);
    assert.ok(r.toRank > (r.fromRank ?? -1), `${r.name} is an instruction to go from ${String(r.fromRank)} to ${String(r.toRank)}`);
    assert.equal(r.maxRank, row.fusionLimit ?? r.toRank);
    assert.ok(r.toRank <= r.maxRank, `${r.name} is ranked past its own card`);
    assert.equal(r.drain, drainAtRank(row.baseDrain ?? 0, r.toRank));
    assert.deepEqual(r.cost, rankCost(row.rarity, r.fromRank ?? 0, r.toRank), `${r.name}: the cost is not the cost of this rank change`);
    assert.ok(r.cost !== null, `${r.name} says what to do and not what it costs`);
    /*
     * Only a mod the account LACKS gets a route. Asking where to farm something
     * already in the inventory is noise, and a rank-up is Endo rather than a
     * hunt - so the presence of the route is itself part of the instruction.
     */
    if (r.fromRank === null) assert.deepEqual(r.route, routeTo(row), `${r.name} is missing and its route does not match the catalogue`);
    else assert.equal(r.route, null, `${r.name} is already owned and still carries somewhere to go and get it`);
  }
  /*
   * THE RANK-UP, COSTED FROM THE RANK THE ACCOUNT HAS.
   *
   * A mod already at 5 is half paid for. Costing it from zero overstates the
   * evening by 620 Endo on this one row - 19,840 against 20,460 - small,
   * plausible, and exactly the kind of number nobody re-derives once it is on
   * screen. The two figures differ, so the second assertion is what makes the
   * first one mean anything. (Costing from zero trips the deepEqual in the loop
   * above first; both are violated, only one is reported.)
   */
  const up = modRungs.find((r) => r.path === LADDER_SERRATION);
  assert.ok(up, 'Serration is held at 5 of 10 and is not a rung');
  assert.equal(up.fromRank, 5);
  assert.equal(up.toRank, 10);
  const serration = catalogue.find((r) => r.uniqueName === LADDER_SERRATION);
  assert.ok(serration);
  assert.equal(up.cost?.endo, rankCost(serration.rarity, 5, 10)?.endo);
  assert.notEqual(up.cost?.endo, rankCost(serration.rarity, 0, 10)?.endo, 'ranking from 5 costs the same as ranking from 0, so the rank held is not being read');
  /*
   * A Forma rung carries no path and no cost - it costs one Forma, which the
   * player either has or does not - so the instruction IS the polarity. A rung
   * naming 'none' is a Forma with no target, which is not a thing to do.
   */
  for (const f of formaRungs) {
    assert.notEqual(f.polarity, 'none', `forma rung ${String(f.step)} names no polarity to Forma to`);
    assert.equal(typeof f.groundwork, 'boolean');
  }
});

ok('the ladder recommends nothing neither build wants, and reaches everything the ceiling does', () => {
  /*
   * BOTH BUILDS ARE WANTED, and taking only one of them was a real regression
   * both ways round.
   *
   * Aim at the ceiling alone and the mods the player could assemble TODAY are
   * never offered - measured, a ladder that ended at 365 against an ideal of 396
   * while reporting there was nothing left to do. Aim at the ideal alone and the
   * ceiling's own mods are never offered, which is this section's first gate.
   * So the offered set must be the union, and it must be exactly the union: a
   * ladder that recommends something neither build wants is recommending a mod
   * no search ever chose.
   *
   * `idealOnly` is the half that stops the first direction passing by accident.
   * On this fixture it is one mod - Vigilante Armaments, which the grid ideal
   * wants and the fully polarised ceiling does not - and the assertion below is
   * void without it, so its emptiness is a failure rather than a pass.
   */
  for (const r of modRungs) assert.ok(ladderWanted.has(r.path), `${r.name} is on a rung and in neither the ideal nor the ceiling`);
  const ceilingPaths = new Set(climb.ceiling.placed.map((p) => p.path));
  const reached = new Set(modRungs.map((r) => r.path));
  for (const p of climb.ceiling.placed) {
    const held = ladderOwned.get(p.path);
    if (held !== undefined && held >= p.rank) continue;
    assert.ok(reached.has(p.path), `the ceiling wants ${p.name} and no rung ever offers it`);
  }
  const idealOnly = climb.ideal.placed.filter((p) => !ceilingPaths.has(p.path) && (ladderOwned.get(p.path) ?? -1) < p.rank);
  assert.ok(idealOnly.length > 0, 'the two builds want the same mods on this fixture, so nothing here proves the union');
  for (const p of idealOnly) assert.ok(reached.has(p.path), `the grid ideal wants ${p.name} and no rung offers it, so the ladder cannot reach the build the player could assemble today`);
});

ok('the ladder costs a bounded number of searches, because the controller has to stay answering', () => {
  /*
   * A rung costs one search per thing still on the table, and the controller
   * drains this generator between timeouts so the first instruction is on screen
   * while the fifth is still being found. That only works while the work between
   * two yields is bounded by the SIZE OF THE WANTED SET rather than by the
   * catalogue: a trial loop over every eligible mod is 51 searches a rung on
   * this fixture, measured, and the overlay would stop answering.
   *
   * The per-rung bound is the module's own arithmetic re-derived - the steps
   * still on the table, plus at most two Forma polarities (the two the target
   * build is shortest of), plus at most one groundwork trial. Measured here:
   * eleven searches before the first rung with nine steps wanted.
   *
   * `rungs.length < maxRungs` is the runaway check, and the strict inequality is
   * the point of it. `maxRungs` is the module's own hard stop; a ladder that
   * REACHES it did not finish, it was cut off - which is what happened when
   * `gridAfterForma` overwrote the same slot forever and produced twenty
   * consecutive "Forma madurai +0" rungs while reporting itself complete.
   */
  const maxRungs = ladderWanted.size + GRID_SLOTS * 2 + 2;
  assert.ok(rungs.length < maxRungs, `${String(rungs.length)} rungs against the module's own runaway bound of ${String(maxRungs)}: the ladder was cut off, not finished`);
  let committed = 0;
  for (let k = 0; k < rungs.length; k++) {
    const remaining = ladderWanted.size - committed;
    assert.ok(searchesBefore[k]! <= remaining + 3, `rung ${String(rungs[k]!.step)} cost ${String(searchesBefore[k])} searches with ${String(remaining)} steps still on the table`);
    if (rungs[k]!.kind !== 'forma') committed++;
  }
  assert.ok(ladderSearches <= rungs.length * (ladderWanted.size + 3), `${String(ladderSearches)} searches for ${String(rungs.length)} rungs`);
});

ok('the ladder CHOOSES: its first rung is the best single step there is', () => {
  /*
   * A RANKED LIST IS NOT AN ANSWER. The overlay gives ONE instruction, so the
   * first rung is a real claim - it is the best single thing to do, out of every
   * mod either build wants and every Forma the target is short of - and not a
   * formality about ordering.
   *
   * `next` is the flat list this replaced, and it is the honest benchmark: its
   * entries are searched by the same function against the same grid, and they
   * are a SUBSET of the ladder's trials (the ideal's missing mods, without the
   * ceiling's and without any Forma). So the ladder's first step can never be
   * worse than the best entry in that list, and on this fixture it is strictly
   * better: Split Chamber at 1,837.65, a mod that only the ceiling wants, over
   * the flat list's best of Primed Cryo Rounds at 1,736.96.
   *
   * The strict inequality is what kills the sabotage that matters. A chooser
   * that keeps the FIRST trial instead of the best still converges on the
   * ceiling eventually, so every end-point assertion in this section passes
   * while the one line the overlay exists to print is the wrong one - and the
   * first trial here is exactly that Primed Cryo Rounds, which lands on the
   * benchmark rather than above it.
   *
   * `preferable` is driven directly for the same reason its own comment gives:
   * it is the whole of the ladder's judgement about reachability, an instruction
   * the player cannot follow is not one, and a comparator that ignored `blocked`
   * would still produce a valid-looking rung naming a planet they cannot reach.
   */
  const first = rungs[0];
  assert.ok(first, 'the ladder has no first rung');
  assert.ok(first.gain > 0, `the first instruction gains ${first.gain}`);
  const bestNext = climb.next.reduce((n, s) => Math.max(n, s.gain), 0) + climb.now.score.value;
  assert.ok(first.value > bestNext + 1e-6, `the first rung reaches ${first.value} and the best single mod in the flat list reaches ${bestNext}`);
  assert.equal(preferable({ value: 1, blocked: false }, { value: 1e9, blocked: true }), true);
  assert.equal(preferable({ value: 1e9, blocked: true }, { value: 1, blocked: false }), false);
  assert.equal(preferable({ value: 2, blocked: true }, { value: 1, blocked: true }), true);
  assert.equal(preferable({ value: 1, blocked: false }, { value: 2, blocked: false }), false);
});

ok('when capacity binds, the next instruction is a Forma and not a mod that cannot fit', () => {
  /*
   * Capacity is what binds once the cheap mods are in, and the failure it causes
   * is quiet: the next mod physically does not fit, so adding it changes the
   * build by nothing, so it measures a gain of zero and sorts LAST. A list of
   * mods therefore presents the most important remaining mod as the least
   * urgent, and a ladder that insists on a gain stops dead instead - measured,
   * ending at 1,188 against a ceiling of 1,283 with a mod the ceiling wants
   * never mentioned.
   *
   * Three claims, and together they say the ladder never hands over a mod that
   * cannot fit:
   *
   *   every mod rung gains something - a zero-gain mod rung IS the mod that did
   *   not fit, recommended anyway. Dropping the module's `chosen.value <= value`
   *   test hands over Galvanized Chamber at +0 and this line catches it;
   *   at least one Forma bought a real gain, which is what proves capacity
   *   actually bound on this fixture rather than the gate being vacuous;
   *   a Forma that bought nothing says so through `groundwork`, because "Forma,
   *   +0" with no explanation reads as a mistake to anyone who has modded
   *   anything.
   *
   * The count below is a BACKSTOP with no exercised failure mode: on this
   * fixture the ladder exits through `wanted.size === 0` before `gridAfterForma`
   * can ever return its "nothing left to polarise" case, so no sabotage of that
   * helper reaches it. One measured against eight - it is here to bound a
   * runaway, not because anything has been shown to trip it.
   */
  assert.ok(climb.forma.count > 0, 'nothing on this fixture needs a Forma, so capacity never binds and this gate proves nothing');
  for (const r of modRungs) assert.ok(r.gain > 1e-9, `${r.name} was handed over for a gain of ${r.gain}: it does not fit`);
  const paid = formaRungs.filter((f) => f.gain > 1e-9);
  assert.ok(paid.length > 0, 'no Forma on this ladder bought anything, so capacity never bound');
  const groundwork = formaRungs.filter((f) => f.gain <= 1e-9);
  for (const f of groundwork) assert.equal(f.groundwork, true, `forma rung ${String(f.step)} gained nothing and does not say it is groundwork`);
  assert.ok(groundwork.length <= GRID_SLOTS, `${String(groundwork.length)} groundwork rungs for ${String(GRID_SLOTS)} slots`);
});

ok('an account that owns everything is told to Forma, and one that has already Formad is told nothing', () => {
  /*
   * THE TWO ENDS OF THE LADDER, and the first of them is where `next` goes
   * silent while there is still plenty to do.
   *
   * An account owning every mod in the game at maximum rank has nothing left to
   * acquire, so the acquisition list is empty - correctly, and uselessly. What
   * binds is the grid, and the honest instruction is which polarity to Forma
   * next. Measured on the unpolarised Braton: seven Forma rungs, every one of
   * them a real gain, ending exactly at the ceiling that `next` had no way to
   * mention.
   *
   * `result` is the harness's own everything-owned plan on the bare grid, reused
   * rather than recomputed.
   *
   * The other end is the account that has already done it. The grid is given the
   * ceiling build's own polarities - derived from the module's output, not typed
   * out - so the Forma plan is empty and Now already stands at the ceiling.
   * There is nothing to say, and saying nothing is the correct answer: this is
   * the case where an over-eager ladder emits zero-gain Forma rungs forever.
   */
  assert.equal(result.next.length, 0, `an account owning everything still has ${String(result.next.length)} things to acquire`);
  const rich: Rung[] = [];
  for (const r of ladder({ item, catalogue, owned: everything, slots }, result)) if (r !== null) rich.push(r);
  assert.ok(rich.length > 0, 'the ladder had nothing to say to an account that owns the entire catalogue and has never Formad');
  for (const r of rich) assert.equal(r.kind, 'forma', `rung ${String(r.step)} is a ${r.kind} on an account that owns everything`);
  assert.ok(rich.some((r) => r.gain > 0), 'every Forma on this ladder bought nothing');
  const end = rich.at(-1);
  assert.ok(end && end.value >= result.ceiling.score.value - 1e-6, `the Forma-only ladder ended at ${String(end?.value)} of a ceiling of ${result.ceiling.score.value}`);

  const polarised: typeof slots = { ...slots, grid: result.ceiling.placed.map((p) => p.polarity) };
  const done = plan({ item, catalogue, owned: everything, slots: polarised });
  assert.equal(done.forma.count, 0, 'the ceiling build still wants Forma on a grid carrying its own polarities');
  assert.ok(done.now.score.value >= done.ceiling.score.value - 1e-6, `now ${done.now.score.value} is below the ceiling ${done.ceiling.score.value} on a grid built for it`);
  const nothingLeft: Rung[] = [];
  for (const r of ladder({ item, catalogue, owned: everything, slots: polarised }, done)) if (r !== null) nothingLeft.push(r);
  assert.deepEqual(nothingLeft, [], `an account at its own ceiling was told to ${nothingLeft.map((r) => r.kind).join(', ')}`);
});

console.log(`  ladder: ${String(rungs.length)} rungs over ${String(ladderSearches)} searches, ${climb.now.score.value.toFixed(0)} -> ${(rungs.at(-1)?.value ?? climb.now.score.value).toFixed(0)} against a ceiling of ${climb.ceiling.score.value.toFixed(0)}`);

// MOVE THIS TO THE IMPORT BLOCK AT THE TOP OF check-optimise.ts: `survivability` is
// what Q3 scores with, and neither the harness nor optimise.ts re-exports it.
console.log('\nthe other moddable things');

/*
 * THE SIX EXPORTS THIS SECTION READS, fetched exactly the way the four above are.
 *
 * `eligibleSlots` grew a case for each of these classes on the strength of what
 * the exports actually carry - a Sentinel's health/shield/armour, an Arch-Gun's
 * eight damage fields - so a gate that took those figures from this file rather
 * than from WFCD would be checking the claim against itself. A category whose
 * file cannot be fetched yields no rows and `named` below fails loudly with the
 * class in the message, rather than letting one quietly go unchecked.
 */
const otherRows = async (category: (typeof ITEM_CATEGORIES)[number]): Promise<ItemDbEntry[]> => {
  const body = await cached(`${category}.json`, `${WFCD_JSON}${category}.json`);
  return body === null ? [] : parseWfcd(category, body);
};
const sentinels = await otherRows('Sentinels');
const petRows = await otherRows('Pets');
const archwings = await otherRows('Archwing');
const archGuns = await otherRows('Arch-Gun');
const archMelees = await otherRows('Arch-Melee');
const companionWeapons = await otherRows('SentinelWeapons');
const warframes = parseWfcd('Warframes', frames);

/** The one row a class is checked on, by its export name - the Braton fixture's rule, applied five more times. */
function named(rows: readonly ItemDbEntry[], name: string): ItemDbEntry {
  const row = rows.find((r) => r.name === name);
  assert.ok(row, `${name} is in its WFCD export; without the row this class has no fixture`);
  return row;
}

/**
 * How many catalogue rows carry one compatibility name, filtered exactly as
 * `prepare` filters them. Every pool assertion below is written against this
 * rather than a number typed out here, so a catalogue that grows a Moa mod
 * moves both sides of the comparison at once and the gate keeps meaning what
 * it says.
 */
const modsWith = (compat: string): number => catalogue.filter((r) => r.slot === compat && r.ranks > 0 && !r.isAura && !r.isFlawed).length;

const planFor = (it: ItemDbEntry, owned: ReadonlyMap<string, number> = everything, at: typeof slots = slots): ReturnType<typeof plan> =>
  plan({ item: it, catalogue, owned, slots: at, question: questionFor(it) });

const bareOf = (it: ItemDbEntry): number => score(it, [], questionFor(it)).score.value;

/**
 * Effective health from the export's own three fields.
 *
 * This is what a Q3 answer for a bare thing MUST come to, and deriving it here
 * is the point: the four survival classes were added by widening
 * `SURVIVAL_TYPES`, and the failure that would not throw is a class that gets
 * the question but not the fields - `survivability` reading zeros and handing
 * back a confident nothing.
 */
const bareSurvival = (it: ItemDbEntry): number => survivability({ health: it.health ?? 0, shield: it.shield ?? 0, armour: it.armor ?? 0 }).effectiveHealth;

/** The section's per-class line, printed before the gate that checks it. */
function report(it: ItemDbEntry, p: ReturnType<typeof plan>): void {
  console.log(`        ${String(p.candidates.scored)} of ${String(p.candidates.eligible)} mods scored - bare ${bareOf(it).toFixed(0)} -> ideal ${p.ideal.score.value.toFixed(0)} -> ceiling ${p.ceiling.score.value.toFixed(0)}`);
}

const carrier = named(sentinels, 'Carrier');
const carrierPlan = planFor(carrier);
report(carrier, carrierPlan);

ok('Sentinels: Carrier is planned, and asked the right question (health 560, shield 250, armour 80)', () => {
  // The three figures in the label are WFCD's own Sentinels.json fields, and
  // they are the fixture's identity: a Carrier that stops carrying them is a
  // different row, and every figure below is then about something else.
  assert.deepEqual([carrier.health, carrier.shield, carrier.armor], [560, 250, 80]);
  assert.equal(questionFor(carrier), 'Q3');
  assert.equal(carrierPlan.ideal.question, 'Q3');
  assert.equal(carrierPlan.ideal.assumptions, FRAME_ASSUMPTIONS);
  const s = eligibleSlots(carrier);
  assert.ok(s.has('Sentinel') && s.has('COMPANION') && s.has('ROBOTIC'), [...s].join(', '));
  assert.ok(!s.has('WARFRAME') && !s.has('BEAST') && !s.has('Rifle'), `a sentinel took ${[...s].join(', ')}`);
  // The bare figure is the export's own three fields on the Tenno armour curve,
  // not a number typed out here - a class that gets Q3 without the fields
  // scores a confident zero and throws nothing.
  assert.equal(bareOf(carrier), bareSurvival(carrier));
  assert.ok(bareOf(carrier) > 0);
  assert.ok(carrierPlan.ideal.placed.length >= 3, `only ${String(carrierPlan.ideal.placed.length)} mods placed on a sentinel`);
  assert.ok(carrierPlan.ideal.score.value > bareOf(carrier) * 2, `ideal ${String(carrierPlan.ideal.score.value)} vs bare ${String(bareOf(carrier))}`);
});

const adarza = named(petRows, 'Adarza Kavat');
const adarzaPlan = planFor(adarza);
report(adarza, adarzaPlan);

ok('Pets: Adarza Kavat is planned, and asked the right question (health 310, shield 270, armour 300)', () => {
  assert.deepEqual([adarza.health, adarza.shield, adarza.armor], [310, 270, 300]);
  assert.equal(questionFor(adarza), 'Q3');
  assert.equal(adarzaPlan.ideal.question, 'Q3');
  const s = eligibleSlots(adarza);
  assert.ok(s.has('COMPANION') && s.has('BEAST') && s.has('Kavat'), [...s].join(', '));
  assert.ok(!s.has('Moa') && !s.has('Hound') && !s.has('WARFRAME'), `a kavat took ${[...s].join(', ')}`);
  assert.equal(bareOf(adarza), bareSurvival(adarza));
  assert.ok(adarzaPlan.ideal.placed.length >= 3, `only ${String(adarzaPlan.ideal.placed.length)} mods placed on a kavat`);
  assert.ok(adarzaPlan.ideal.score.value > bareOf(adarza) * 2);
});

const amesha = named(archwings, 'Amesha');
const ameshaPlan = planFor(amesha);
report(amesha, ameshaPlan);

ok('Archwing: Amesha is planned, and asked the right question (health 650, shield 220, armour 195)', () => {
  assert.deepEqual([amesha.health, amesha.shield, amesha.armor], [650, 220, 195]);
  assert.equal(questionFor(amesha), 'Q3');
  assert.equal(ameshaPlan.ideal.question, 'Q3');
  const s = eligibleSlots(amesha);
  assert.ok(s.has('Archwing'), [...s].join(', '));
  // An archwing is the thing being shot at in space; it takes none of a rifle's
  // mods, none of a frame's, and none of the two arch weapons' either.
  assert.ok(!s.has('WARFRAME') && !s.has('Archgun') && !s.has('Archmelee') && !s.has('Rifle'), `an archwing took ${[...s].join(', ')}`);
  assert.equal(bareOf(amesha), bareSurvival(amesha));
  assert.equal(ameshaPlan.candidates.eligible, modsWith('Archwing') + modsWith('Amesha'));
  assert.ok(ameshaPlan.ideal.placed.length >= 2, `only ${String(ameshaPlan.ideal.placed.length)} mods placed on an archwing`);
  assert.ok(ameshaPlan.ideal.score.value > bareOf(amesha) * 2);
});

/*
 * The eight fields Q2 reads off a weapon, named once and applied to both the
 * Braton and the Arch-Gun - because the claim in the label is a COMPARISON. An
 * Arch-Gun needed no new objective, only the same eight numbers in the same
 * export fields, and the way that claim fails is one of them being absent while
 * the arithmetic quietly proceeds without it.
 */
const DAMAGE_FIELDS = ['damagePerShot', 'multishot', 'criticalChance', 'criticalMultiplier', 'procChance', 'fireRate', 'magazineSize', 'reloadTime'] as const;

const corvas = named(archGuns, 'Corvas');
const corvasPlan = planFor(corvas);
report(corvas, corvasPlan);

ok('Arch-Gun: Corvas is planned, and asked the right question (the same eight damage fields a Braton has)', () => {
  assert.equal(DAMAGE_FIELDS.length, 8);
  for (const f of DAMAGE_FIELDS) {
    assert.notEqual(item[f], undefined, `the Braton carries ${f}`);
    assert.notEqual(corvas[f], undefined, `Corvas carries ${f}, so Q2 has the same eight numbers to read as on a Braton`);
  }
  assert.equal(questionFor(corvas), 'Q2');
  assert.equal(corvasPlan.ideal.question, 'Q2');
  assert.equal(corvasPlan.ideal.assumptions, ASSUMPTIONS);
  const s = eligibleSlots(corvas);
  assert.ok(s.has('Archgun'), [...s].join(', '));
  assert.ok(!s.has('Rifle') && !s.has('PRIMARY') && !s.has('Archmelee'), `an arch-gun took ${[...s].join(', ')}`);
  assert.equal(corvasPlan.candidates.eligible, modsWith('Archgun') + modsWith('Corvas'));
  // What ARRIVES at the overlay: all five printed stats resolved rather than
  // null, which is how a missing export field shows itself.
  const sc = corvasPlan.ideal.score;
  for (const [k, v] of Object.entries({ critChance: sc.critChance, critDamage: sc.critDamage, fireRate: sc.fireRate, magazine: sc.magazine, reload: sc.reload })) {
    assert.notEqual(v, null, `Q2 resolved ${k} on an arch-gun`);
  }
  assert.ok(corvasPlan.ideal.score.value > bareOf(corvas) * 10, `ideal ${String(corvasPlan.ideal.score.value)} vs bare ${String(bareOf(corvas))}`);
});

const veritux = named(archMelees, 'Veritux');
const verituxPlan = planFor(veritux);
report(veritux, verituxPlan);

ok('Arch-Melee: Veritux is planned, and asked the right question (a melee, in space)', () => {
  assert.equal(questionFor(veritux), 'Q2');
  assert.equal(verituxPlan.ideal.question, 'Q2');
  const s = eligibleSlots(veritux);
  assert.ok(s.has('Archmelee'), [...s].join(', '));
  // A melee: it takes none of the ground melee pool and none of the arch-gun's.
  assert.ok(!s.has('Melee') && !s.has('Archgun') && !s.has('Archwing'), `an arch-melee took ${[...s].join(', ')}`);
  assert.equal(verituxPlan.candidates.eligible, modsWith('Archmelee') + modsWith('Veritux'));
  // In space, and a melee: the export gives it no magazine and no reload, so an
  // objective that read those as zero rather than as absent would divide a
  // sustained figure by a reload that does not exist.
  assert.equal(veritux.magazineSize, undefined);
  assert.equal(veritux.reloadTime, undefined);
  const sc = verituxPlan.ideal.score;
  assert.equal(sc.magazine, null);
  assert.equal(sc.reload, null);
  // What it does have is an attack speed, and the swing has to be worth something.
  assert.notEqual(sc.fireRate, null);
  assert.ok(bareOf(veritux) > 0);
  assert.ok(verituxPlan.ideal.score.value > bareOf(veritux) * 5, `ideal ${String(verituxPlan.ideal.score.value)} vs bare ${String(bareOf(veritux))}`);
});

const bonewidow = named(warframes, 'Bonewidow');
const bonewidowPlan = planFor(bonewidow);
report(bonewidow, bonewidowPlan);
const excalibur = named(warframes, 'Excalibur');
const excaliburPlan = planFor(excalibur);

ok('Warframes: Bonewidow is planned, and asked the right question (health 1880, shield 430, armour 480 - and NOT a Warframe pool)', () => {
  assert.deepEqual([bonewidow.health, bonewidow.shield, bonewidow.armor], [1880, 430, 480]);
  // The trap this row is here to hold open: WFCD types a Necramech as a
  // Warframe and only `productCategory` tells the two apart.
  assert.equal(bonewidow.type, 'Warframe');
  assert.equal(bonewidow.productCategory, 'MechSuits');
  assert.equal(questionFor(bonewidow), 'Q3');
  assert.equal(bonewidowPlan.ideal.question, 'Q3');
  assert.equal(bareOf(bonewidow), bareSurvival(bonewidow));
  const s = eligibleSlots(bonewidow);
  assert.ok(s.has('Necramech'), [...s].join(', '));
  assert.ok(!s.has('WARFRAME'), 'a Necramech was handed the Warframe pool');
  assert.ok(bonewidowPlan.ideal.placed.length >= 3, `only ${String(bonewidowPlan.ideal.placed.length)} mods placed on a mech`);
  assert.ok(bonewidowPlan.ideal.score.value > bareOf(bonewidow) * 2);
  // The control: a real frame still gets the frame pool, so the mech fix cost
  // the Warframes nothing.
  assert.ok(eligibleSlots(excalibur).has('WARFRAME'));
  assert.equal(excaliburPlan.ideal.question, 'Q3');
});

ok('a Necramech is given Necramech mods, never the pool a Warframe takes', () => {
  /*
   * MEASURED, BOTH SIDES, EVERY RUN: 118 WARFRAME rows against 28 Necramech
   * ones under this filter. The catalogue holds 142 rows compatible with
   * WARFRAME, but 23 of them are Flawed and one has no ranks, and `prepare`
   * drops all 24 - so 142 is not a number this app ever offers anybody, and
   * quoting it here would be a measurement nobody made.
   *
   * THREE times, not four. The shape being asserted is "the frame pool dwarfs
   * the mech pool"; at four the margin is six rows, so two new Necramech mods
   * - which ship in real updates - would fail a correct app.
   */
  assert.ok(modsWith('WARFRAME') > modsWith('Necramech') * 3, `${String(modsWith('WARFRAME'))} frame mods against ${String(modsWith('Necramech'))} mech mods`);
  assert.equal(bonewidowPlan.candidates.eligible, modsWith('Necramech') + modsWith('Bonewidow'));
  // Named one at a time because these three are the ones that would have been
  // CHOSEN: a mech cannot equip Vitality, Steel Fiber or Redirection, and all
  // three give exactly the stats Q3 scores.
  for (const name of ['Vitality', 'Steel Fiber', 'Redirection']) {
    const row = catalogue.find((r) => r.displayName === name && r.slot === 'WARFRAME');
    assert.ok(row, `${name} is a WARFRAME mod in the catalogue`);
    assert.ok(!eligibleSlots(bonewidow).has(row.slot ?? ''), `a mech was offered ${name}`);
  }
  // And what ARRIVES on the grid is a mech mod, every one of them.
  for (const p of bonewidowPlan.ideal.placed) {
    const row = catalogue.find((r) => r.uniqueName === p.path);
    assert.equal(row?.slot, 'Necramech', `${p.name} is not a Necramech mod`);
  }
  assert.ok(excaliburPlan.candidates.eligible > bonewidowPlan.candidates.eligible * 3);
});

ok('the classes with no question this app can answer are NOT claimed', () => {
  assert.ok(companionWeapons.length > 0, 'SentinelWeapons.json has rows');
  assert.ok(companionWeapons.every((w) => w.type === 'Companion Weapon'), 'every SentinelWeapons row is a Companion Weapon');
  // Not one companion weapon in the game reaches a single catalogue row. It is
  // checked over all of them rather than one, because the refusal is a MISSING
  // case in a switch and a case added for any single name would show up here.
  for (const w of companionWeapons) {
    const reach = catalogue.filter((r) => r.slot !== null && eligibleSlots(w).has(r.slot) && r.ranks > 0 && !r.isAura && !r.isFlawed);
    assert.equal(reach.length, 0, `${w.name} was offered ${String(reach.length)} mods`);
  }
  // What the consumer gets is an empty build and an empty acquisition list -
  // never a confident plan assembled out of nothing.
  const artax = named(companionWeapons, 'Artax');
  const p = planFor(artax);
  assert.equal(p.candidates.eligible, 0);
  assert.equal(p.candidates.scored, 0);
  assert.deepEqual(p.now.placed, []);
  assert.deepEqual(p.ideal.placed, []);
  assert.deepEqual(p.ceiling.placed, []);
  assert.deepEqual(p.next, []);
  assert.equal(p.ideal.aura, null);
});

ok('a Moa gets Moa mods, a Hound gets Hound mods, and neither gets the beast pool', () => {
  const lambeo = named(petRows, 'Lambeo Moa');
  const bhaira = named(petRows, 'Bhaira Hound');
  assert.ok(modsWith('Moa') > 0 && modsWith('Hound') > 0 && modsWith('BEAST') > 0, 'all three pools exist to be confused');
  const moa = eligibleSlots(lambeo);
  assert.ok(moa.has('Moa') && moa.has('COMPANION'), [...moa].join(', '));
  assert.ok(!moa.has('BEAST') && !moa.has('Hound') && !moa.has('Kavat') && !moa.has('Kubrow'), `a moa took ${[...moa].join(', ')}`);
  const hound = eligibleSlots(bhaira);
  assert.ok(hound.has('Hound') && hound.has('COMPANION'), [...hound].join(', '));
  assert.ok(!hound.has('BEAST') && !hound.has('Moa') && !hound.has('Kavat') && !hound.has('Kubrow'), `a hound took ${[...hound].join(', ')}`);
  // The count that ARRIVES at the plan, derived from the catalogue's own pools.
  // A moa handed BEAST instead of Moa still produces a plausible-looking plan
  // out of mods it cannot equip; only the arithmetic on the pool sizes sees it.
  assert.equal(planFor(lambeo).candidates.eligible, modsWith('Moa') + modsWith('COMPANION') + modsWith('Lambeo Moa'));
  assert.equal(planFor(bhaira).candidates.eligible, modsWith('Hound') + modsWith('COMPANION') + modsWith('Bhaira Hound'));
  // The kavat is the control: it is the one that SHOULD get the beast pool.
  assert.equal(adarzaPlan.candidates.eligible, modsWith('BEAST') + modsWith('COMPANION') + modsWith('Kavat') + modsWith('Adarza Kavat'));
});

ok('the reasons the refused classes are refused still hold', () => {
  const questions = ['Q1', 'Q2', 'Q3'] as const;
  const scoredIn = (rows: typeof catalogue, q: (typeof questions)[number]): number => rows.filter((r) => r.effects.some((e) => scoredEffects(r, e.rank, q).used.length > 0)).length;
  /*
   * K-Drive and Parazon are refused because no question scores a single one of
   * their effects - k-drive speed, grind magnetism, trick score, hacking
   * chance. That is a claim about the SCORED SETS, and the day a status or an
   * ammo-economy question arrives it stops being true. This is where it says so.
   */
  for (const cls of ['K-Drive', 'Parazon']) {
    const rows = catalogue.filter((r) => r.slot === cls);
    assert.ok(rows.length > 0, `${cls} mods are still in the catalogue`);
    for (const q of questions) assert.equal(scoredIn(rows, q), 0, `${q} now scores a ${cls} mod, so the refusal is stale`);
  }
  /*
   * The operator/amp set is refused for a different reason and the two are worth
   * keeping apart: these mods DO carry weapon stats, under amp-specific names no
   * question's stat set contains, and the amps themselves are not an item
   * category at all. Both halves would have to change together.
   */
  const amps = catalogue.filter((r) => r.slot === 'ANY');
  assert.ok(amps.reduce((n, r) => n + r.effects.length, 0) > 0, 'the amp set does carry stats');
  for (const q of questions) assert.equal(scoredIn(amps, q), 0, `${q} now scores an amp mod`);
  assert.ok(!ITEM_CATEGORIES.some((c) => /amp|operator/i.test(c)), `an amp category appeared in ${ITEM_CATEGORIES.join(', ')}`);
  /*
   * Companion Weapon is refused because the catalogue gives it no class of its
   * own: the only candidate pool is the `Sentinel` rows, which mix the
   * sentinel's own behaviour with its weapon's, and those go to the sentinel.
   */
  assert.equal(modsWith('Companion Weapon'), 0, 'the catalogue now has a Companion Weapon pool, so the refusal can be revisited');
  assert.ok(modsWith('Sentinel') > 0);
  assert.ok(eligibleSlots(carrier).has('Sentinel'), 'the sentinel keeps its own mods');
  assert.ok(companionWeapons.every((w) => !eligibleSlots(w).has('Sentinel')), 'a companion weapon was handed the sentinel pool');
});

/*
 * THE LADDER'S TWO REACHABILITY CASES, both on the Amesha.
 *
 * The archwing is the cheapest fixture with the shape they need: three scored
 * mods, two of which drop on Earth and one of which the export gives no planet
 * for at all. That mixture is what separates "worth most" from "can be done
 * tonight", and it is why the ladder here costs a few milliseconds rather than
 * the second a rifle does.
 */
const ameshaFrom = (owned: ReadonlyMap<string, number>, at: typeof slots): Parameters<typeof plan>[0] => ({ item: amesha, catalogue, owned, slots: at, question: 'Q3' });
function firstRung(input: Parameters<typeof ladder>[0], built: ReturnType<typeof plan>): Rung | null {
  for (const r of ladder(input, built)) if (r !== null) return r;
  return null;
}
/** The rung as a mod step; anything else here is the failure, not a shape to handle. */
function modRung(r: Rung | null, why: string): Extract<Rung, { kind: 'mod' | 'aura' }> {
  assert.ok(r !== null && (r.kind === 'mod' || r.kind === 'aura'), why);
  return r;
}

ok('the next instruction is one the account can actually act on', () => {
  const bare = ameshaFrom(new Map(), slots);
  const built = plan(bare);
  const open = modRung(firstRung({ ...bare, canReach: () => true }, built), 'an account that can go anywhere gets a mod to fetch');
  assert.equal(open.name, 'Enhanced Durability', 'the biggest single gain on a bare Amesha');
  assert.ok(open.route?.kind === 'farm' && open.route.planet === 'Earth' && open.route.reachable === true, JSON.stringify(open.route));
  // Now shut Earth. The same step is still worth the most and is still ON the
  // ladder - what changes is that it is no longer the one named first, because
  // an instruction the player cannot follow is not an instruction.
  const shut = modRung(firstRung({ ...bare, canReach: (p) => p !== 'Earth' }, built), 'a blocked best step does not stop the ladder');
  assert.notEqual(shut.name, open.name, 'the ladder still opened with the step behind a shut planet');
  assert.ok(!(shut.route?.kind === 'farm' && shut.route.reachable === false), `${shut.name} is behind a planet this account has not opened`);
  // And the rule that decides it, driven directly: a comparator that keeps the
  // FIRST blocked candidate instead of the best one still converges on the
  // ceiling, so nothing about where the ladder ends can catch that.
  assert.equal(preferable({ value: 1, blocked: false }, { value: 100, blocked: true }), true);
  assert.equal(preferable({ value: 100, blocked: true }, { value: 1, blocked: false }), false);
  assert.equal(preferable({ value: 100, blocked: true }, { value: 1, blocked: true }), true);
});

ok('when everything left is out of reach, the next instruction is on the star chart', () => {
  /*
   * The account already holds the one mod in this build the export gives no
   * planet for, and its grid already carries the polarities the ceiling wants -
   * so there is no mod it can fetch and no Forma worth spending. Both halves
   * are needed: while a Forma is still worth trying the ladder always has
   * something unblocked to name, and the unlock branch never runs.
   */
  const held = catalogue.find((r) => r.displayName === 'Argon Plating' && r.slot === 'Archwing');
  assert.ok(held, 'Argon Plating is the Archwing armour mod the export gives no planet for');
  const heldRoute = routeTo(held);
  assert.equal(heldRoute.kind === 'farm' ? heldRoute.planet : 'not-a-farm', null);
  const owned = new Map<string, number>([[held.uniqueName, held.fusionLimit ?? Math.max(0, held.ranks - 1)]]);
  const at: typeof slots = { grid: ameshaPlan.ceiling.placed.map((p) => p.polarity), capacity: slots.capacity };
  const built = plan(ameshaFrom(owned, at));
  const walled = { ...ameshaFrom(owned, at), canReach: () => false };
  // With no way to say how far a planet is, all the ladder can do is name the
  // mod anyway, marked unreachable - "go to Earth" for an account that cannot.
  // That is the state this rung replaces, so it is asserted too: without the
  // fallback in evidence, the unlock rung is only a shape.
  const blind = [...ladder(walled, built)].filter((r): r is Rung => r !== null);
  assert.ok(blind.length > 0, 'without a chart the ladder still names the mod');
  const blocked = modRung(blind[0] ?? null, 'the blind fallback is a mod step');
  assert.ok(blocked.route?.kind === 'farm' && blocked.route.reachable === false, `the fallback is ${JSON.stringify(blocked.route)}, not an unreachable farm`);
  const rungs = [...ladder({ ...walled, unlockPath: (p) => ({ nodes: p === 'Earth' ? 2 : 9, node: `SolNode/${p}`, nodeName: `${p} first node` }) }, built)].filter((r): r is Rung => r !== null);
  assert.equal(rungs.length, 1, rungs.map((r) => r.kind).join(', '));
  const only = rungs[0];
  assert.ok(only && only.kind === 'unlock', `the rung is ${String(only?.kind)}`);
  assert.equal(only.planet, 'Earth');
  assert.equal(only.nodes, 2);
  assert.equal(only.node, 'SolNode/Earth');
  assert.equal(only.nodeName, 'Earth first node');
  // Clearing a node raises no figure by itself, and the rung says so rather
  // than borrowing the gain of the mod it unlocks.
  assert.equal(only.gain, 0);
  assert.equal(only.value, built.now.score.value);
  /*
   * AND THE CHOICE ITSELF, DRIVEN DIRECTLY - the same reason `preferable` is.
   * Every mod this Amesha still wants drops on Earth, so the wall list has one
   * planet in it and any selection rule returns the right answer: a
   * `nearestWall` that took the LAST wall instead of the nearest passed every
   * assertion above, sending the player nine nodes away when two would do.
   * The catalogue does not reliably put two planets behind one build, so this
   * cannot be cornered from outside and has to be called.
   */
  const far = { planet: 'Saturn', nodes: 9, node: 'SolNode/Saturn', nodeName: 'Saturn first' };
  const near = { planet: 'Earth', nodes: 2, node: 'SolNode/Earth', nodeName: 'Earth first' };
  assert.equal(nearestWall([far, near])?.planet, 'Earth', 'the nearest wall is the one to open first');
  assert.equal(nearestWall([near, far])?.planet, 'Earth', 'and the order it arrives in does not decide it');
  assert.equal(nearestWall([near, { ...far, nodes: 2 }])?.planet, 'Earth', 'a tie keeps the first seen');
  assert.equal(nearestWall([]), null, 'no wall is not a wall');
});

/*
 * A grid with every slot already spent on a polarity the build wants none of.
 * `zenurik` is the choice because no Archmelee mod in the catalogue carries it,
 * so all eight slots are genuinely wrong and there is real Forma work to do -
 * which is the state the old `grid[grid.length - 1] = p` spun on.
 */
const wrongGrid: typeof slots = { grid: Array.from({ length: GRID_SLOTS }, (): Polarity => 'zenurik'), capacity: slots.capacity };

ok('a FULL grid does not make the ladder spin on one slot', () => {
  assert.equal(catalogue.filter((r) => r.slot === 'Archmelee' && (r.polarity ?? '').toLowerCase() === 'zenurik').length, 0, 'no arch-melee mod wants a zenurik slot, so all eight are wrong');
  const input = { item: veritux, catalogue, owned: new Map<string, number>(), slots: wrongGrid, question: 'Q2' as const };
  const built = plan(input);
  const rungs = [...ladder(input, built)].filter((r): r is Rung => r !== null);
  const formas = rungs.filter((r): r is Extract<Rung, { kind: 'forma' }> => r.kind === 'forma');
  assert.ok(formas.length > 0, 'eight wrong polarities leave Forma work to do');
  // One Forma polarises one slot, so eight is the whole grid and there is then
  // nothing left worth spending one on. The defect this replaces emitted twenty
  // consecutive identical Forma rungs and then reported itself complete.
  assert.ok(formas.length <= GRID_SLOTS, `${String(formas.length)} Forma rungs for ${String(GRID_SLOTS)} slots`);
  const wanted = new Map<Polarity, number>();
  for (const p of built.ceiling.placed) wanted.set(p.polarity, (wanted.get(p.polarity) ?? 0) + 1);
  const asked = new Map<Polarity, number>();
  for (const f of formas) asked.set(f.polarity, (asked.get(f.polarity) ?? 0) + 1);
  for (const [p, n] of asked) assert.ok(n <= (wanted.get(p) ?? 0), `${String(n)} Forma rungs for ${p} against the ${String(wanted.get(p) ?? 0)} slots the build wants`);
  // And it has to STOP on its own, which is what the runaway bound cannot show:
  // a ladder that spins reaches the bound rather than ending.
  assert.ok(rungs.length < built.ceiling.placed.length + GRID_SLOTS * 2 + 2, `the ladder ran to its runaway bound at ${String(rungs.length)} rungs`);
});

const CLASS_PLANS: ReadonlyArray<readonly [string, ReturnType<typeof plan>]> = [
  ['Carrier', carrierPlan],
  ['Adarza Kavat', adarzaPlan],
  ['Amesha', ameshaPlan],
  ['Corvas', corvasPlan],
  ['Veritux', verituxPlan],
  ['Bonewidow', bonewidowPlan],
];

ok('the ceiling is never below the build the account can already assemble', () => {
  /*
   * Every consumer treats this as an invariant: the ladder aims at the ceiling,
   * the meter divides by it, and "at the ceiling" is `now >= ceiling`. A ceiling
   * under the build already on the grid prints "nothing in the game raises this
   * build further" beside a better build the player has not assembled yet.
   */
  for (const [name, p] of CLASS_PLANS) {
    assert.ok(p.now.score.value <= p.ideal.score.value + 1e-9, `${name}: now ${String(p.now.score.value)} over ideal ${String(p.ideal.score.value)}`);
    assert.ok(p.ideal.score.value <= p.ceiling.score.value + 1e-9, `${name}: ideal ${String(p.ideal.score.value)} over ceiling ${String(p.ceiling.score.value)}`);
  }
  // And on a grid the account has ALREADY polarised, which is the case the two
  // ceiling passes do not cover by construction - a grid the account already
  // has is one of the grids the ceiling is allowed to reach.
  const at: typeof slots = { grid: verituxPlan.ceiling.placed.map((p) => p.polarity), capacity: slots.capacity };
  assert.equal(at.grid.length, GRID_SLOTS, 'the polarised fixture is a full grid');
  const polarised = plan({ item: veritux, catalogue, owned: everything, slots: at, question: 'Q2' });
  assert.ok(polarised.ideal.score.value > verituxPlan.ideal.score.value, 'the polarised grid is the more generous one');
  assert.ok(polarised.now.score.value <= polarised.ideal.score.value + 1e-9);
  assert.ok(polarised.ideal.score.value <= polarised.ceiling.score.value + 1e-9, `ideal ${String(polarised.ideal.score.value)} over ceiling ${String(polarised.ceiling.score.value)}`);

  /*
   * THE CASE THE GUARD EXISTS FOR, AND IT IS NOT ON THIS SECTION'S SIX.
   *
   * Everything above is true whatever `plan` does with its two ceiling passes:
   * with `owned = everything` the Now pool IS the Ideal pool, so `now` and
   * `ideal` are the same search and the first comparison is a number against
   * itself; and `ideal <= ceiling` is made true unconditionally by the final
   * `ideal.score.value > ceiling.score.value ? ideal : ceiling` in `plan`. Take
   * that line out and all six classes stay green - none of them can corner it,
   * because a universal slot and their own slots halve the same mods.
   *
   * An UMBRA mod is what separates the two grids: `slotDrain` refuses to halve
   * it on a universal slot and halves it on a real umbra one, so a grid the
   * account already has can beat the "everything is universal" pass the ceiling
   * searches. Measured with the guard removed, the Arum Spinosa on this grid
   * comes out at ideal 15,326 against a ceiling of 14,930 - the overlay's
   * "nothing in the game raises this build further" printed beside a better
   * build the player had not assembled. The melee export is already fetched by
   * this file and was going unused.
   */
  const umbraGrid: Polarity[] = ['umbra', 'umbra', 'madurai', 'madurai', 'naramon', 'naramon', 'vazarin', 'vazarin'];
  const spinosa = named(parseWfcd('Melee', melees), 'Arum Spinosa');
  const onUmbra = plan({ item: spinosa, catalogue, owned: everything, slots: { grid: umbraGrid, capacity: slots.capacity }, question: 'Q1' });
  const onBare = plan({ item: spinosa, catalogue, owned: everything, slots: { grid: [], capacity: slots.capacity }, question: 'Q1' });
  // The fixture only means something while the mechanism is in it: Umbra mods
  // sitting in Umbra slots, on a grid worth more than an unpolarised one.
  assert.ok(onUmbra.ideal.placed.filter((p) => p.polarity === 'umbra' && p.slotPolarity === 'umbra').length >= 2, 'no Umbra mod took an Umbra slot, so this fixture no longer separates the two grids');
  assert.ok(onUmbra.ideal.score.value > onBare.ideal.score.value, 'the umbra grid is not the more generous one');
  assert.ok(
    onUmbra.ideal.score.value <= onUmbra.ceiling.score.value + 1e-9,
    `${spinosa.name}: ideal ${String(onUmbra.ideal.score.value)} over ceiling ${String(onUmbra.ceiling.score.value)} - the ceiling is below a build this grid already allows`,
  );
});

const physique = catalogue.find((r) => r.displayName === 'Physique' && r.isAura);
assert.ok(physique, 'Physique is the maximum-health aura the frame plans lean on');
const frameVitality = catalogue.find((r) => r.displayName === 'Vitality' && r.slot === 'WARFRAME');
assert.ok(frameVitality, 'Vitality is the WARFRAME health mod');

ok('an aura the account holds UNRANKED is worth what it is worth unranked', () => {
  const maxOf = (r: { fusionLimit: number | null; ranks: number }): number => r.fusionLimit ?? Math.max(0, r.ranks - 1);
  const withAuraAt = (rank: number): ReturnType<typeof plan> =>
    plan({
      item: excalibur,
      catalogue,
      owned: new Map<string, number>([
        [physique.uniqueName, rank],
        [frameVitality.uniqueName, maxOf(frameVitality)],
      ]),
      slots,
      question: 'Q3',
    });
  const unranked = withAuraAt(0);
  const ranked = withAuraAt(maxOf(physique));
  // The eight grid mods were always built at min(owned, max); the aura was
  // built at max and filtered on PRESENCE, so an account holding an unranked
  // Physique was planned with a rank-5 one - capacity it does not have, and
  // twenty per cent maximum health it does not have.
  assert.equal(unranked.now.aura?.name, 'Physique');
  assert.equal(unranked.now.aura?.rank, 0);
  assert.equal(ranked.now.aura?.rank, maxOf(physique));
  // An aura's drain is negative, so this is capacity the eight slots may spend,
  // and it is derived from the row rather than typed out here.
  assert.equal(unranked.now.aura?.drain, drainAtRank(physique.baseDrain ?? 0, 0));
  assert.equal(unranked.now.capacity, slots.capacity - drainAtRank(physique.baseDrain ?? 0, 0));
  assert.equal(ranked.now.capacity, slots.capacity - drainAtRank(physique.baseDrain ?? 0, maxOf(physique)));
  assert.ok(unranked.now.capacity < ranked.now.capacity, 'an unranked aura hands over less capacity');
  // The figure the overlay prints has to move with it, or the rank-up rung that
  // should follow measures a gain of nothing because the plan already spent it.
  assert.ok(unranked.now.score.value < ranked.now.score.value, `${String(unranked.now.score.value)} against ${String(ranked.now.score.value)}`);
});

ok('a Necramech is offered no Warframe aura, because it has no aura slot', () => {
  for (const build of [bonewidowPlan.now, bonewidowPlan.ideal, bonewidowPlan.ceiling]) {
    assert.equal(build.aura, null, 'a mech was given an aura');
    // The half that does not throw: an aura's drain is negative, so a mech
    // handed one gets capacity it does not have, and every figure downstream
    // inherits it.
    assert.equal(build.capacity, slots.capacity, `a mech's capacity moved to ${String(build.capacity)} from ${String(slots.capacity)}`);
  }
  // The control, on the identical slot plan: a real frame does take an aura,
  // and its capacity does rise above what the slot plan gave it.
  assert.notEqual(excaliburPlan.ideal.aura, null, 'a Warframe still gets an aura');
  assert.ok(excaliburPlan.ideal.capacity > slots.capacity, `${String(excaliburPlan.ideal.capacity)} is not above ${String(slots.capacity)}`);
});

ok('the STAIRCASE for a Necramech is built from mech mods, and never offers it an aura', () => {
  const input = { item: bonewidow, catalogue, owned: new Map<string, number>(), slots, question: 'Q3' as const };
  const built = plan(input);
  const rungs = [...ladder(input, built)].filter((r): r is Rung => r !== null);
  assert.ok(rungs.length >= 3, `a mech's staircase is ${String(rungs.length)} rungs`);
  for (const r of rungs) {
    assert.notEqual(r.kind, 'aura', 'a mech was told to fit an aura it has no slot for');
    if (r.kind !== 'mod') continue;
    const row = catalogue.find((x) => x.uniqueName === r.path);
    assert.equal(row?.slot, 'Necramech', `${r.name} is not a Necramech mod`);
  }
  // It has to actually arrive, or the pool was right and the ladder was not.
  const last = rungs[rungs.length - 1];
  assert.ok(last && last.value >= built.ideal.score.value - 1e-9, `the staircase ended at ${String(last?.value)} against an ideal of ${String(built.ideal.score.value)}`);
});

ok('the grid size is stated as an assumption, in both lists, from the constant itself', () => {
  /*
   * Written as a template over GRID_SLOTS rather than as prose carrying the
   * number. A sentence that says eight while the search plans seven is a false
   * claim nobody would catch, because nothing renders these today - and there
   * are two ways to write one: spell the count out, or type the digit. Both are
   * caught by taking the constant back out of the text and asking what number
   * claims are left. Only "eleven" may survive, and that is the account's own
   * normalised slot array rather than a claim about the grid.
   */
  assert.ok(GRID_ASSUMPTION.includes(String(GRID_SLOTS)), `the assumption does not name ${String(GRID_SLOTS)}: ${GRID_ASSUMPTION}`);
  const withoutTheCount = GRID_ASSUMPTION.split(String(GRID_SLOTS)).join(' ');
  assert.equal(withoutTheCount.match(/\d+/g), null, `the assumption types a slot count instead of deriving it: ${GRID_ASSUMPTION}`);
  assert.equal(withoutTheCount.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b/gi), null, `the assumption spells a slot count out instead of deriving it: ${GRID_ASSUMPTION}`);
  assert.ok(ASSUMPTIONS.includes(GRID_ASSUMPTION), 'the weapon list states the grid size');
  assert.ok(FRAME_ASSUMPTIONS.includes(GRID_ASSUMPTION), 'the survival list states the grid size');
  assert.ok(assumptionsFor('Q2').includes(GRID_ASSUMPTION));
  assert.ok(assumptionsFor('Q3').includes(GRID_ASSUMPTION));
  // And it ARRIVES on a real result of each kind - the two lists were split
  // once already, and a rule can be dropped from one of them silently.
  assert.ok(corvasPlan.ideal.assumptions.includes(GRID_ASSUMPTION), 'a weapon plan carries it');
  assert.ok(carrierPlan.ideal.assumptions.includes(GRID_ASSUMPTION), 'a survival plan carries it');
  // The claim is understated rather than overstated: whatever the true count,
  // no build this app produces ever exceeds the number it states.
  for (const [name, p] of CLASS_PLANS) {
    for (const b of [p.now, p.ideal, p.ceiling]) assert.ok(b.placed.length <= GRID_SLOTS, `${name}: ${String(b.placed.length)} mods on a ${String(GRID_SLOTS)}-slot grid`);
  }
});
console.log(`\n${checks} checks, ${failures} failures\n`);
process.exit(failures === 0 ? 0 : 1);
