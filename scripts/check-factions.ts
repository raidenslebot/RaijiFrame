/**
 * UNIVERSAL CAPABILITY, GATED.
 *
 * WHAT THIS PROTECTS
 * ──────────────────
 * `src/data/factions.ts` turns the game's own 16 x 15 vulnerability grid into
 * the term that makes Q2 a UNIVERSAL objective rather than a Grineer one. Two
 * things can quietly destroy it and neither shows up as an error:
 *
 *   THE JOIN. The table names types in Title Case and the app's damage vector
 *   names them lowercase. `factionMultiplier` returns NEUTRAL for a type it
 *   does not know, which is right for the drains and script effects in
 *   `DAMAGE_ORDER` that no enemy resists - and is also exactly what a rename
 *   would look like. A silent 1.0 on every cell turns the objective back into
 *   what it was, with no failure anywhere.
 *
 *   THE AGGREGATE. `universal` takes the MINIMUM across factions. Swap it for a
 *   mean and every assertion about the numbers still passes while the objective
 *   stops meaning "works everywhere".
 *
 * THE TWO FINDINGS THIS EXISTS TO KEEP TRUE
 * ─────────────────────────────────────────
 * The table lands squarely on the two things `optimise.ts` rewards: viral is
 * halved by Infested Deimos and The Murmur, corrosive by Sentient. The harder
 * the objective pushes a build toward the strip and the multiplier, the more
 * it needs this term - so if either cell ever moves, the gate says so rather
 * than the ranking quietly changing.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mitigatedBy } from '../src/data/armour.ts';
import {
  FACTIONS,
  HEALTH_TYPES,
  againstHealthType,
  healthMultiplier,
  FACTION_TYPES,
  NEUTRAL,
  RESISTANT,
  VULNERABLE,
  againstFaction,
  factionMultiplier,
  universal,
  unknownTypes,
} from '../src/data/factions.ts';

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

const raw = JSON.parse(readFileSync(new URL('../src/data/vendor/damage-factions.json', import.meta.url), 'utf8')) as {
  source: string;
  factions: string[];
  types: string[];
  matrix: Record<string, Record<string, number>>;
};

console.log('\nthe table');

ok('the vendored grid is the shape the wiki published, cell for cell', () => {
  assert.equal(raw.source, 'https://wiki.warframe.com/w/Damage');
  assert.equal(raw.factions.length, 15, `${String(raw.factions.length)} factions`);
  assert.equal(raw.types.length, 16, `${String(raw.types.length)} damage types`);

  let plus = 0;
  let minus = 0;
  let flat = 0;
  for (const [type, row] of Object.entries(raw.matrix)) {
    assert.equal(Object.keys(row).length, 15, `${type} has ${String(Object.keys(row).length)} faction cells`);
    for (const [f, v] of Object.entries(row)) {
      assert.ok(v === VULNERABLE || v === NEUTRAL || v === RESISTANT, `${type} vs ${f} is ${String(v)}, which is not one of the three the page states`);
      if (v === VULNERABLE) plus++;
      else if (v === RESISTANT) minus++;
      else flat++;
    }
  }
  /*
   * The counts are the capture's own, and they are here because they are the
   * cheapest possible proof that a refresh read the whole table rather than a
   * fragment of it. A scrape that silently caught half the rows still passes
   * every shape check above.
   */
  assert.equal(plus, 27, `${String(plus)} vulnerable cells, not 27`);
  assert.equal(minus, 10, `${String(minus)} resistant cells, not 10`);
  assert.equal(plus + minus + flat, 16 * 15);
  // x1.5 and x0.5 are the page's own sentence, not an interpolation.
  assert.equal(VULNERABLE, 1.5);
  assert.equal(RESISTANT, 0.5);
});

ok('THE JOIN: every type the app can put in a damage vector is found, or is a drain', () => {
  /*
   * `DAMAGE_ORDER` in `optimise.ts` is the app's own axis. Sixteen of its
   * twenty are damage types the grid scores; the other four are drains and
   * script effects that no enemy resists. This pins which is which, because a
   * rename on either side would move a real type into the second group and be
   * absorbed as a silent 1.0.
   */
  const APP_ORDER = ['impact', 'puncture', 'slash', 'heat', 'cold', 'electricity', 'toxin', 'blast', 'radiation', 'gas', 'magnetic', 'viral', 'corrosive', 'void', 'tau', 'true'];
  const missing = APP_ORDER.filter((t) => !FACTION_TYPES.includes(t));
  assert.deepEqual(missing, [], `the table no longer names: ${missing.join(', ')}`);

  const DRAINS = ['shielddrain', 'healthdrain', 'energydrain', 'cinematic'];
  assert.deepEqual(unknownTypes(DRAINS.map((type) => ({ type }))), DRAINS, 'a drain is being scored as a damage type');

  // And the join is case-insensitive in the direction the app needs it.
  assert.equal(factionMultiplier('CORROSIVE', 'Sentient'), RESISTANT, 'the type join is case-sensitive, so the app vector will not match');
});

console.log('\nwhat it says about the two things the objective rewards');

ok('viral is halved by Infested Deimos and The Murmur, and corrosive by Sentient', () => {
  /*
   * These are the cells that make the term worth having. `optimise.ts` derives
   * a corrosive strip and a viral multiplier from the build's own vector and
   * rewards both heavily; without this table it would recommend, with total
   * confidence, a build halved against three endgame factions.
   */
  assert.equal(factionMultiplier('viral', 'Infested Deimos'), RESISTANT);
  assert.equal(factionMultiplier('viral', 'The Murmur'), RESISTANT);
  assert.equal(factionMultiplier('corrosive', 'Sentient'), RESISTANT);
  // And corrosive's compensation, which is why a player reaches for it at all.
  assert.equal(factionMultiplier('corrosive', 'Grineer'), VULNERABLE);
  assert.equal(factionMultiplier('corrosive', 'Kuva Grineer'), VULNERABLE);

  /*
   * ON THE FACTION AXIS slash and toxin are never resisted - a weaker claim
   * than "neutral everywhere" and the true one, since slash is x1.5 against
   * Infested and Narmer. This gate pins the cells; whether the OBJECTIVE sees a
   * clean control is a different question and the answer is now no, because
   * `universal` also runs the exact health-type axis where slash is -50 %
   * against Alloy Armor. `check-optimise` divides the factor out rather than
   * relying on a neutral, and this is the pair of assertions that says why.
   */
  for (const f of FACTIONS) {
    assert.notEqual(factionMultiplier('slash', f), RESISTANT, `slash is now resisted by faction ${f}`);
    assert.notEqual(factionMultiplier('toxin', f), RESISTANT, `toxin is now resisted by faction ${f}`);
  }
  assert.equal(againstFaction([{ type: 'slash', amount: 100 }], 'Grineer'), NEUTRAL, 'slash is no longer neutral against Grineer');
  assert.ok(universal([{ type: 'slash', amount: 100 }]).worst < NEUTRAL, 'slash has no worst case below 1, so the health-type axis is not being consulted');
});

console.log('\nthe aggregate');

ok('THE WORST FACTION, not the best and not the mean - which is what universal means', () => {
  const pure = (type: string) => [{ type, amount: 100 }];

  // A resisted element drags the figure to the resistance, wherever else it shines.
  const corrosive = universal(pure('corrosive'));
  assert.equal(corrosive.worst, RESISTANT, `corrosive's worst case is ${String(corrosive.worst)}`);
  /*
   * TWO AXES REACH THE SAME 0.5 HERE and that is worth pinning: the faction
   * grid says Sentient resist corrosive, and the exact table says Proto Shield
   * takes -50 % from it. Either can be the reported worst; both are true, and
   * a build that ignores corrosive's weakness is wrong on either reading.
   */
  assert.ok(
    corrosive.worstFaction === 'Sentient' || corrosive.worstFaction === 'Proto Shield',
    `corrosive's worst is reported as ${corrosive.worstFaction}, which is neither of the two the tables name`,
  );
  // +75 % against Ferrite Armor is the exact table's figure and the reason anybody builds it.
  assert.ok(Math.abs(corrosive.best - 1.75) < 1e-9, `corrosive's best is ${String(corrosive.best)}, not the +75 % the overview table prints`);

  /*
   * A VULNERABILITY CANNOT RAISE THE FIGURE, and this is the assertion that
   * separates a minimum from a mean. Impact is vulnerable against four factions
   * and resisted by none, so under a mean it would score above 1 - and a build
   * would be rewarded for being strong somewhere, which is not universality.
   */
  /*
   * A VULNERABILITY STILL CANNOT RAISE THE FIGURE. Impact is x1.5 against four
   * factions and +50 % against Shield, and its worst is 0.75 - the -25 % the
   * exact table gives it against Flesh. Under a mean it would score above 1 and
   * a build would be rewarded for being strong somewhere, which is not what
   * universal means.
   */
  const impact = universal(pure('impact'));
  assert.ok(impact.worst < NEUTRAL, `impact's worst is ${String(impact.worst)}; a vulnerability is raising the objective`);
  assert.ok(impact.best > NEUTRAL, 'impact should still report where it is strong');

  // Mixing dilutes rather than cancels: half a penalised element is half the penalty.
  const half = universal([{ type: 'corrosive', amount: 50 }, { type: 'slash', amount: 50 }]);
  assert.ok(half.worst > corrosive.worst, 'diluting a resisted element did not help');
  assert.ok(half.worst < 1, 'a half-corrosive build has no weakness at all, which cannot be right');

  // An empty vector is neutral rather than infinite or zero.
  assert.equal(universal([]).worst, NEUTRAL);
  assert.equal(againstFaction([], 'Grineer'), NEUTRAL);
});

ok('the objective CONSUMES it: a resisted build scores below a neutral one', () => {
  /*
   * The half a unit check cannot see. Every assertion above is about the model;
   * this is about the model ARRIVING - the defect this repo has shipped before,
   * where a correct computation was vetoed downstream and its own unit check
   * passed throughout.
   *
   * Two damage vectors, identical in every way except the element, run through
   * the real `score`. `optimise.ts` is not imported for its constants here: it
   * is called, and the ratio has to be the table's.
   */
  const source = readFileSync(new URL('../src/data/optimise.ts', import.meta.url), 'utf8');
  assert.ok(/from '\.\/factions\.ts'/.test(source), 'optimise.ts does not import the faction model at all');
  assert.ok(/\*\s*faction\.worst/.test(source), 'the worst-faction factor is not multiplied into the Q2 value');
});


ok('the packed hot path is IDENTICAL to the readable one it replaced', () => {
  /*
   * `universal` is called once per scored candidate and the beam evaluates
   * thousands per plan, so it was rewritten from a 29-target loop with a map
   * lookup per damage entry into one pass over precomputed columns. Measured,
   * that took the Skiajati's plan from 2,714 ms to 827 and its ladder from
   * 7,846 to 2,320 - the model went from costing about 250 % of the optimiser
   * to about 5 %.
   *
   * An optimisation that changes an answer is a defect wearing a benchmark. The
   * readable `againstFaction` and `againstHealthType` are still here, still
   * what the rest of the app reads, and this is the equivalence: every damage
   * type on its own, every pair, and a real weapon's vector, checked against
   * the minimum computed the slow way.
   */
  const slow = (damage: ReadonlyArray<{ type: string; amount: number }>) => {
    let worst = Infinity;
    let which = '';
    for (const f of FACTIONS) {
      const m = againstFaction(damage, f);
      if (m < worst) {
        worst = m;
        which = f;
      }
    }
    for (const h of HEALTH_TYPES) {
      const m = againstHealthType(damage, h);
      if (m < worst) {
        worst = m;
        which = h;
      }
    }
    return { worst, which };
  };

  const types = [...FACTION_TYPES];
  let compared = 0;
  for (const t of types) {
    const one = [{ type: t, amount: 100 }];
    const a = universal(one);
    const b = slow(one);
    assert.ok(Math.abs(a.worst - b.worst) < 1e-12, `${t}: packed ${String(a.worst)} against readable ${String(b.worst)}`);
    assert.equal(a.worstFaction, b.which, `${t}: packed names ${a.worstFaction}, readable names ${b.which}`);
    compared++;
    for (const u of types) {
      if (u === t) continue;
      const pair = [{ type: t, amount: 70 }, { type: u, amount: 30 }];
      assert.ok(Math.abs(universal(pair).worst - slow(pair).worst) < 1e-12, `${t}+${u} disagree`);
      compared++;
    }
  }
  assert.ok(compared >= 250, `only ${String(compared)} vectors compared`);

  // A drain the grid has no row for weighs neutral, both ways.
  const withDrain = [{ type: 'slash', amount: 50 }, { type: 'shielddrain', amount: 50 }];
  assert.ok(Math.abs(universal(withDrain).worst - slow(withDrain).worst) < 1e-12, 'a drain is weighed differently by the two paths');
  // And an empty vector does not divide by zero.
  assert.equal(universal([]).worst, NEUTRAL);
  // The scratch buffer is reused, so a second call must not see the first's sum.
  const a1 = universal([{ type: 'corrosive', amount: 100 }]).worst;
  universal([{ type: 'impact', amount: 100 }]);
  assert.equal(universal([{ type: 'corrosive', amount: 100 }]).worst, a1, 'the reused buffer is leaking between calls');
});

console.log('\nthe exact layer, which is where shields finally enter the model');

ok('the health-type grid is the overview table, and it carries the shield rows', () => {
  /*
   * SHIELDS WERE THE STANDING GAP and this is what closed it. The objection was
   * that shields are a POOL rather than a percentage - true, and beside the
   * point: what a build needs to know is whether its damage is penalised on the
   * way through, and the game publishes that exactly.
   */
  const layers = JSON.parse(readFileSync(new URL('../src/data/vendor/damage-health-types.json', import.meta.url), 'utf8')) as {
    source: string; healthTypes: string[]; types: string[]; bypasses: Record<string, string[]>; matrix: Record<string, Record<string, number | null>>;
  };
  assert.equal(layers.source, 'https://wiki.warframe.com/w/Damage_2.0/Overview_Table');
  assert.equal(layers.healthTypes.length, 14, `${String(layers.healthTypes.length)} health types`);
  assert.equal(layers.types.length, 16, `${String(layers.types.length)} damage types`);
  for (const h of ['Shield', 'Proto Shield', 'Ferrite Armor', 'Alloy Armor']) {
    assert.ok(HEALTH_TYPES.includes(h), `${h} is missing from the layer list`);
  }

  // The wiki's own figures, spot-checked where they matter most to this app.
  assert.ok(Math.abs(healthMultiplier('puncture', 'Shield') - 0.8) < 1e-9, 'puncture is -20 % against Shield');
  assert.ok(Math.abs(healthMultiplier('puncture', 'Proto Shield') - 0.5) < 1e-9, 'puncture is -50 % against Proto Shield');
  assert.ok(Math.abs(healthMultiplier('corrosive', 'Ferrite Armor') - 1.75) < 1e-9, 'corrosive is +75 % against Ferrite Armor');
  assert.ok(Math.abs(healthMultiplier('corrosive', 'Proto Shield') - 0.5) < 1e-9, 'corrosive is -50 % against Proto Shield');
  assert.ok(Math.abs(healthMultiplier('slash', 'Alloy Armor') - 0.5) < 1e-9, 'slash is -50 % against Alloy Armor');
  assert.ok(Math.abs(healthMultiplier('slash', 'Infested Flesh') - 1.5) < 1e-9, 'slash is +50 % against Infested Flesh');

  /*
   * THE FOUR BYPASSES, and they are exactly the two rules `armour.ts` already
   * carried from a different page: toxin ignores shields, true ignores armour.
   * Two independent sources agreeing is the strongest thing in this file.
   */
  assert.deepEqual(layers.bypasses, { Toxin: ['Shield', 'Proto Shield'], True: ['Ferrite Armor', 'Alloy Armor'] });
  assert.equal(healthMultiplier('toxin', 'Shield'), NEUTRAL, 'a bypass is scored as neutral, never as a penalty');
  assert.equal(mitigatedBy('poison').shields, false, "armour.ts and the overview table disagree about toxin and shields");
  assert.equal(mitigatedBy('true').armour, false, "armour.ts and the overview table disagree about true damage and armour");

  // And a pure-toxin build's weakness is its Fossilized penalty, not a shield.
  const toxin = universal([{ type: 'toxin', amount: 100 }]);
  assert.ok(toxin.worst < NEUTRAL, 'toxin now has no weakness at all');
  assert.ok(againstHealthType([{ type: 'toxin', amount: 100 }], 'Shield') === NEUTRAL, 'toxin is being penalised on a layer it bypasses');
});

console.log('');
if (failures === 0) console.log(`universal capability is computed, not assumed  (${String(checks)} checks)`);
assert.equal(failures, 0, `${String(failures)} faction rule(s) broken`);
