/**
 * Self-check for the stat-string parser, on the REAL Mods.json.
 *
 * No fixture of invented rows: every test input below is a real row quoted by
 * uniqueName, and every count is one the spec measured on the export. The Part
 * A row filter is a plain local function here (moddb.ts owns the real one),
 * because the parser must be judged on the rows the catalogue will keep.
 *
 * WHAT THIS GATE IS FOR
 * ─────────────────────
 * The parser is allowed to refuse; it is not allowed to guess. So the
 * assertions run in both directions: the lines the spec says parse must parse
 * to the number displayed (Serration +165, Galvanized Scope's two triggers),
 * and the lines the spec says refuse must NOT produce a value - Spring-Loaded
 * Broadhead's "+40" is the honest trap, a signed number inside a verb-led
 * sentence, and a parser that emits it has guessed. The refusal histogram is
 * printed so the number of refusals is a measurement in the baseline, not a
 * surprise in a build.
 *
 * SABOTAGE. Three named mistakes each have an assertion here that would fail:
 *   - a name-keyed lookup ("Serration" is three rows at 40 / 90 / 165);
 *   - `levelStats[fusionLimit]` as the max rank (Plexus rows run past it);
 *   - a real-newline splitter (there is no U+000A in the file; the LINE break
 *     is the two characters backslash+n).
 *
 * OFFLINE IS A SKIP, like the other live gates: the export is read from
 * node_modules/.cache/wfcd/Mods.json, downloaded there on first run, and when
 * neither is available the gate prints one SKIP line and exits 0.
 *
 * Run: node scripts/check-modstats.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseModStats, shape, type Effect, type ModStatsInput, type Refused } from '../src/data/modstats.ts';

const CACHE = path.resolve('node_modules/.cache/wfcd/Mods.json');
const URL = 'https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/Mods.json';

interface Row {
  uniqueName: string;
  name: string;
  type: string | null;
  compatName: string | null;
  fusionLimit: number | null;
  description: string | null;
  levelStats: string[][] | null;
}

function readRows(): Row[] | null {
  let body: string | null = null;
  try {
    body = fs.readFileSync(CACHE, 'utf8');
  } catch {
    body = null;
  }
  if (body === null) return null;
  const raw: unknown = JSON.parse(body);
  assert.ok(Array.isArray(raw), 'Mods.json is not an array');
  return (raw as Array<Record<string, unknown>>)
    .filter((r) => typeof r.uniqueName === 'string' && typeof r.name === 'string')
    .map((r) => ({
      uniqueName: r.uniqueName as string,
      name: r.name as string,
      type: typeof r.type === 'string' ? r.type : null,
      compatName: typeof r.compatName === 'string' ? r.compatName : null,
      fusionLimit: typeof r.fusionLimit === 'number' ? r.fusionLimit : null,
      description: typeof r.description === 'string' ? r.description : null,
      levelStats: Array.isArray(r.levelStats)
        ? (r.levelStats as Array<{ stats?: unknown }>).map((lv) => (Array.isArray(lv.stats) ? (lv.stats as unknown[]).filter((s): s is string => typeof s === 'string') : []))
        : null,
    }));
}

async function fetchIntoCache(): Promise<void> {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`the mod export responded ${String(res.status)}`);
  const text = await res.text();
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, text);
}

/** Part A, inline. A1 drop, A2 phantoms; A3 is a keep (Beginner rows stay). */
function partA(rows: Row[]): { kept: Row[]; pvp: number; phantoms: number; templates: number } {
  let pvp = 0;
  let templates = 0;
  const a1 = rows.filter((r) => {
    if (/\/PvPMods\/|PvPAugmentCard$/.test(r.uniqueName)) {
      pvp++;
      return false;
    }
    // `templates` is EVERY A1 non-PvP drop, which is what the spec's 30 counts:
    // 15 riven templates + 10 Railjack random templates + 4 Transmutation cores
    // + the DE test row. Counting only the uniqueName branch reported 26 and
    // quietly left the four type-dropped rows out of the accounting.
    if (/SampleAntiqueUpgrade|InnateDamageRandomMod|RandomMod/.test(r.uniqueName) || /Riven|Transmutation/.test(r.type ?? '')) {
      templates++;
      return false;
    }
    return true;
  });
  // A2: the suffix AND another row with the same name that lacks it.
  const plainNames = new Set(rows.filter((r) => !/(Intermediate|Expert)$/.test(r.uniqueName)).map((r) => r.name));
  let phantoms = 0;
  const kept = a1.filter((r) => {
    if (/(Intermediate|Expert)$/.test(r.uniqueName) && plainNames.has(r.name)) {
      phantoms++;
      return false;
    }
    return true;
  });
  return { kept, pvp, phantoms, templates };
}

const toInput = (r: Row): ModStatsInput => ({ uniqueName: r.uniqueName, name: r.name, description: r.description, levelStats: r.levelStats ?? [] });
const maxRank = (r: Row): number => (r.levelStats?.length ?? 0) - 1;
const atMax = (r: Row, effects: Effect[]): Effect[] => effects.filter((e) => e.rank === maxRank(r));

/** The R9b line shape, written independently here so the gate counts what it sees rather than what the parser says it did. */
const R9B_TEXT = /^(?:Increases?|Reduces?) [A-Za-z@'&\- /]+ by [+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:%|\/s|m|s)?\.?$/;

/**
 * B1 + R6 re-derived, so "nothing is silently dropped" can be checked against
 * the lines the export really contains instead of against the parser's own
 * bookkeeping. If this drifts from `prepass` / `parseElement` the gate fails,
 * which is the point.
 */
function linesOf(r: Row, rank: number): string[] {
  const elements = (r.levelStats?.[rank] ?? []).map((s) =>
    s
      .replace(/<LINE_SEPARATOR>/g, '')
      .replace(/<LOWER_IS_BETTER>/g, '')
      .replace(/’/g, "'")
      .replace(/\\n/g, '\n')
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter((l) => l.length > 0)
      .join('\n'),
  );
  const joined: string[] = [];
  for (const t of elements) {
    const prev = joined.length - 1;
    if (prev >= 0 && /^(and |if |in a |\()/.test(t)) joined[prev] += ` ${t}`;
    else joined.push(t);
  }
  const out: string[] = [];
  for (const el of joined) {
    const lines: string[] = [];
    for (const l of el.split('\n')) {
      if (lines.length > 0 && /^(and |if |in a |\()/.test(l)) lines[lines.length - 1] += ` ${l}`;
      else lines.push(l);
    }
    out.push(...lines);
  }
  return out;
}

/** F1: what "the same shape" means for a rank - everything but the magnitudes. */
function signature(rank: number, effects: Effect[], refused: Refused[]): string {
  const e = effects.filter((x) => x.rank === rank).map((x) => [x.element, x.op, x.stat, x.unit, x.target, x.damageType ?? '', x.faction ?? '', x.conditions.map(shape).join('|'), x.scalingBasis ?? '', x.notes.map(shape).join('|'), ['duration', 'stackCap', 'cooldown', 'threshold', 'altMultiplier'].filter((k) => k in x).join(',')].join('/'));
  const r = refused.filter((x) => x.rank === rank).map((x) => [x.element, x.rule, shape(x.text)].join('/'));
  return JSON.stringify({ e, r });
}

async function main(): Promise<void> {
  let rows = readRows();
  if (rows === null) {
    try {
      await fetchIntoCache();
      rows = readRows();
    } catch {
      rows = null;
    }
  }
  if (rows === null) {
    console.log('  SKIP  Mods.json unavailable (offline, no cache)');
    return;
  }
  assert.ok(rows.length > 1500, `only ${String(rows.length)} rows in Mods.json`);

  const { kept, pvp, phantoms, templates } = partA(rows);
  const byPath = new Map(kept.map((r) => [r.uniqueName, r]));
  const allByPath = new Map(rows.map((r) => [r.uniqueName, r]));
  const row = (p: string): Row => {
    const r = byPath.get(p);
    assert.ok(r, `${p} is not a kept row`);
    return r;
  };

  // --- B1: the LINE break is backslash+n; a real-newline splitter finds nothing.
  let realNewlines = 0;
  let literalBreaks = 0;
  for (const r of rows) for (const lv of r.levelStats ?? []) for (const s of lv) {
    if (s.includes('\n')) realNewlines++;
    if (s.includes('\\n')) literalBreaks++;
  }
  assert.equal(realNewlines, 0, 'a U+000A appeared in levelStats; the B1 pre-pass assumption is broken');
  assert.ok(literalBreaks > 500, `only ${String(literalBreaks)} strings carry the literal backslash-n LINE break`);
  {
    const scope = row('/Lotus/Upgrades/Mods/Rifle/Event/CritChanceWhileAimingRifleSPMod');
    const top = scope.levelStats?.[maxRank(scope)]?.[0] ?? '';
    assert.equal(top.split('\n').length, 1, 'SABOTAGE: a real-newline splitter sees Galvanized Scope as one line');
    assert.equal(top.split('\\n').length, 4, 'the literal backslash-n splitter sees its four lines');
  }
  console.log(`  ok    B1: ${String(literalBreaks)} strings break on the two-character backslash-n and none on U+000A`);

  // --- parse every kept row ---------------------------------------------------
  const parsed = new Map<string, { effects: Effect[]; refused: Refused[]; corrupt: string | null }>();
  let withStats = 0;
  for (const r of kept) {
    if (r.levelStats === null) continue;
    withStats++;
    parsed.set(r.uniqueName, parseModStats(toInput(r)));
  }
  const corrupt = [...parsed.values()].filter((p) => p.corrupt !== null).map((p) => p.corrupt);
  assert.deepEqual(corrupt, [], 'A6 must hold on every kept row of this export (the spec measured 1,920 / 1,920 series)');
  const allEffects = [...parsed.entries()].flatMap(([u, p]) => p.effects.map((e) => ({ u, e })));
  const allRefused = [...parsed.entries()].flatMap(([u, p]) => p.refused.map((x) => ({ u, x })));
  console.log(`  ok    ${String(withStats)} kept rows with levelStats parsed; ${String(allEffects.length)} effects, ${String(allRefused.length)} refusals, 0 corrupt`);

  // --- F1: every rank of every kept row parses to the same shape signature ---
  const shapeBreaks: string[] = [];
  for (const [u, p] of parsed) {
    const r = allByPath.get(u);
    const ranks = r?.levelStats?.length ?? 0;
    const first = signature(0, p.effects, p.refused);
    for (let k = 1; k < ranks; k++) if (signature(k, p.effects, p.refused) !== first) shapeBreaks.push(`${u} rank ${String(k)}`);
  }
  assert.deepEqual(shapeBreaks.slice(0, 10), [], `F1: ${String(shapeBreaks.length)} rank(s) parse to a different shape than rank 0`);
  console.log('  ok    F1: every rank of every kept row parses to the same shape signature');

  // --- NOTHING IS SILENTLY DROPPED ------------------------------------------------------
  // Every line of every rank must come back as an effect, as a refusal, or as
  // one of the two lines that are absorbed into their element by design: a
  // trigger head (which becomes a condition on the block below it) and a
  // `Cooldown: Ns` line (which becomes a parameter on the element's effects).
  // Anything else is a line the parser read and threw away.
  {
    let total = 0;
    let heads = 0;
    let cooldowns = 0;
    const dropped: string[] = [];
    for (const r of kept) {
      const p = parsed.get(r.uniqueName);
      if (!p) continue;
      for (let rank = 0; rank < (r.levelStats?.length ?? 0); rank++) {
        const covered = new Set([...p.effects.filter((e) => e.rank === rank).map((e) => e.text), ...p.refused.filter((x) => x.rank === rank).map((x) => x.text)]);
        for (const l of linesOf(r, rank)) {
          total++;
          if (covered.has(l)) continue;
          if (/^Cooldown: \d+(?:\.\d+)?s$/.test(l)) {
            cooldowns++;
            continue;
          }
          const head = /^([^:.]{1,60}):(?: (.*))?$/.exec(l);
          if (head && (head[2] === undefined || covered.has(head[2]))) {
            heads++;
            continue;
          }
          if (dropped.length < 10) dropped.push(`${r.name}: ${JSON.stringify(l)}`);
        }
      }
    }
    assert.deepEqual(dropped, [], 'lines the parser neither emitted nor refused');
    assert.equal(total, 10256, `${String(total)} stat lines on kept rows, not the 10,256 measured - the export moved, so re-read the counts below before trusting them`);
    assert.equal(cooldowns, 23, `${String(cooldowns)} Cooldown lines absorbed into their element, not the 23 measured`);
    assert.equal(heads, 455, `${String(heads)} trigger-head lines absorbed as conditions, not the 455 measured`);
    console.log(`  ok    nothing dropped: all ${String(total)} lines yield an effect or a refusal, bar ${String(heads)} trigger heads and ${String(cooldowns)} Cooldown lines absorbed into their element`);
  }

  // --- F2: Serration, by path, exactly once, +165 --------------------------------
  {
    const serrations = kept.filter((r) => r.name === 'Serration');
    assert.deepEqual(
      serrations.map((r) => r.uniqueName).sort(),
      ['/Lotus/Upgrades/Mods/Rifle/Beginner/WeaponDamageAmountModBeginner', '/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod'],
      'the kept Serrations are the Flawed one and the real one; the Intermediate phantom is gone',
    );
    const real = row('/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod');
    const eff = atMax(real, parsed.get(real.uniqueName)?.effects ?? []);
    assert.equal(eff.length, 1);
    assert.deepEqual(eff.map((e) => [e.op, e.stat, e.value, e.unit]), [['add_pct', 'damage', 165, '%']], 'Serration is one add_pct damage effect of +165 at max rank');
    // SABOTAGE: a name-keyed lookup cannot pick this row - three rows share the name at three ceilings.
    const byName = rows.filter((r) => r.name === 'Serration');
    const ceilings = byName.map((r) => {
      const p = parseModStats(toInput(r));
      return atMax(r, p.effects)[0]?.value ?? null;
    });
    assert.deepEqual(ceilings.sort((a, b) => (a ?? 0) - (b ?? 0)), [40, 90, 165], 'SABOTAGE: "Serration" by name is 40 / 90 / 165 depending on which row wins');
    const damageAtMax = allEffects.filter(({ u, e }) => e.op === 'add_pct' && e.stat === 'damage' && e.rank === maxRank(row(u)) && e.conditions.length === 0 && byPath.get(u)?.type === 'Primary Mod');
    assert.equal(damageAtMax.filter(({ u }) => byPath.get(u)?.name === 'Serration' && !u.endsWith('Beginner')).length, 1, 'F2: among unconditional add_pct damage on Primary rows, Serration is named exactly once');
    console.log(`  ok    F2: Serration is /Rifle/WeaponDamageAmountMod, +165, once (${String(damageAtMax.length)} unconditional Primary damage effects at max rank in all)`);
  }

  // --- F3: no kept effect has value > 500 except R7 templates --------------------
  // The 500 line is a percent-scale signal (the 220 / 440 phantoms). A flat
  // magnitude can legitimately pass it - Pack Leader displays "+1,200 Overguard
  // Max" - so flat outliers are printed, and the assertion holds the scale the
  // spec measured: add_pct and multiply.
  {
    const big = allEffects.filter(({ e }) => e.value !== null && e.value > 500);
    const pct = big.filter(({ e }) => e.op === 'add_pct' || e.op === 'multiply');
    assert.deepEqual(pct.map(({ u, e }) => `${u}: ${e.text}`), [], 'F3: a percent-scale effect exceeds 500');
    assert.ok(big.some(({ u, e }) => u === '/Lotus/Upgrades/Mods/Rifle/WeaponBeamExplodeOnDeath' && e.op === 'template:onDeathExplosion' && e.value === 600), 'the exception is exercised: Combustion Beam is a template at 600');
    // The template count is a count of EFFECTS. The old line printed
    // `big.length - flat.length`, subtracting a count of distinct PATHS from a
    // count of effects, and so reported 12 templates where there is exactly 1.
    const tpl = big.filter(({ e }) => e.op.startsWith('template:'));
    assert.equal(tpl.length, 1, `F3: ${String(tpl.length)} R7-template effects above 500, not the 1 measured (Combustion Beam)`);
    assert.equal(big.length, 14, `F3: ${String(big.length)} effects above 500, not the 14 measured`);
    const flat = [...new Set(big.filter(({ e }) => !e.op.startsWith('template:')).map(({ u }) => u))];
    console.log(`  ok    F3: ${String(big.length)} effects above 500 - none on the percent scale; ${String(tpl.length)} is an R7 template and the other ${String(big.length - tpl.length)} are flat, all from ${flat.map((u) => u.split('/').pop() ?? u).join(', ')}`);
  }

  // --- F4: the real rows, not the phantoms ----------------------------------------
  {
    const expect = (p: string, stat: string, value: number): void => {
      const r = row(p);
      const eff = atMax(r, parsed.get(p)?.effects ?? []);
      assert.deepEqual(eff.map((e) => [e.stat, e.value]), [[stat, value]], `${r.name} at max rank`);
    };
    expect('/Lotus/Upgrades/Mods/Pistol/WeaponFireIterationsMod', 'multishot', 120);
    expect('/Lotus/Upgrades/Mods/Warframe/AvatarKnockdownRecoveryMod', 'faster knockdown recovery', 160);
    expect('/Lotus/Upgrades/Mods/Rifle/WeaponAmmoMaxMod', 'ammo maximum', 90);
    for (const phantom of ['/Lotus/Upgrades/Mods/Pistol/Expert/WeaponFireIterationsModExpert', '/Lotus/Upgrades/Mods/Warframe/Expert/AvatarKnockdownRecoveryModExpert', '/Lotus/Upgrades/Mods/Rifle/Expert/WeaponAmmoMaxModExpert']) {
      assert.ok(allByPath.has(phantom), `${phantom} is in the export`);
      assert.ok(!byPath.has(phantom), `${phantom} is a phantom and must not be kept`);
    }
    // The phantoms really would have said 220 / 440 / 165 - the parser reads them faithfully; the filter is what protects the build.
    const p = allByPath.get('/Lotus/Upgrades/Mods/Pistol/Expert/WeaponFireIterationsModExpert');
    assert.ok(p);
    assert.equal(atMax(p, parseModStats(toInput(p)).effects)[0]?.value, 220, 'the Barrel Diffusion phantom reads +220');
    console.log('  ok    F4: Barrel Diffusion +120, Handspring +160, Ammo Drum +90; the 220 / 440 / 165 phantoms are dropped');
  }

  // --- F5: the PvP rows are dropped, and the DROP is what protects the build ----------
  // The two assertions that used to stand here were true by construction:
  // `kept` is the output of a filter that removes every PvPMods path, and
  // `allEffects` is built only from `kept`, so neither could ever fail. What
  // can fail is the accounting (a row dropped for no reason, or twice) and the
  // claim the filter rests on - that these rows parse perfectly well, so
  // nothing but A1 keeps Conclave magnitudes out of the catalogue.
  assert.equal(pvp, 152, `A1 dropped ${String(pvp)} Conclave rows, not the measured 152`);
  assert.equal(templates, 30, `A1 dropped ${String(templates)} non-PvP template rows, not the 30 the spec measured (15 riven + 10 Railjack random + 4 Transmutation + the DE test row)`);
  assert.equal(phantoms, 108, `A2 dropped ${String(phantoms)} phantoms, not the measured 108`);
  assert.equal(rows.length, kept.length + pvp + phantoms + templates, `${String(rows.length)} rows in, ${String(kept.length + pvp + phantoms + templates)} accounted for: a row was dropped without a reason or counted twice`);
  {
    const pvpRows = rows.filter((r) => /\/PvPMods\/|PvPAugmentCard$/.test(r.uniqueName));
    const pvpEffects = pvpRows.reduce((n, r) => n + parseModStats(toInput(r)).effects.length, 0);
    assert.equal(pvpEffects, 592, `the PvP rows parse to ${String(pvpEffects)} effects, not the measured 592 - if this ever reads 0 the A1 filter is no longer the thing protecting the build`);
    console.log(`  ok    F5: ${String(pvp)} PvP rows dropped by A1 - they parse to ${String(pvpEffects)} effects when read directly, so the filter is load-bearing (phantoms ${String(phantoms)}, templates ${String(templates)}, ${String(kept.length)} kept of ${String(rows.length)})`);
  }

  // --- SABOTAGE: levelStats[fusionLimit] is not the max rank ---------------------------
  {
    const past = kept.filter((r) => r.levelStats !== null && r.fusionLimit !== null && r.levelStats.length !== r.fusionLimit + 1);
    assert.equal(past.length, 49, `${String(past.length)} kept rows have levelStats.length !== fusionLimit + 1, not the 49 the spec measured`);
    const lavan = row('/Lotus/Upgrades/Mods/Railjack/Gunnery/LavanDamageOnKill');
    assert.equal(lavan.levelStats?.length, 14);
    const eff = parsed.get(lavan.uniqueName)?.effects ?? [];
    const top = atMax(lavan, eff)[0];
    assert.ok(top);
    assert.equal(top.value, 35, 'the max rank is levelStats[13]');
    assert.notEqual(eff.find((e) => e.rank === (lavan.fusionLimit ?? 0))?.value, 35, 'SABOTAGE: levelStats[fusionLimit] is a lower rank on this row');
    assert.deepEqual([top.scalingBasis, top.duration, top.stackCap], ['enemy destroyed', 8, 5], 'per-basis, duration and stack cap are parameters, never the value');
    console.log(`  ok    ${String(past.length)} kept rows run past fusionLimit; the max rank is the last level`);
  }

  // --- the named lines -----------------------------------------------------------------
  {
    // Galvanized Scope: two trigger blocks in one element, each body inheriting its own head.
    const r = row('/Lotus/Upgrades/Mods/Rifle/Event/CritChanceWhileAimingRifleSPMod');
    const eff = atMax(r, parsed.get(r.uniqueName)?.effects ?? []);
    assert.deepEqual(
      eff.map((e) => [e.stat, e.value, e.conditions, e.duration, e.stackCap ?? null]),
      [
        ['critical chance', 120, ['On Headshot', 'when Aiming'], 12, null],
        ['critical chance', 40, ['On Headshot Kill', 'when Aiming'], 12, 5],
      ],
      'Galvanized Scope',
    );
    assert.equal(parsed.get(r.uniqueName)?.refused.length, 0);
    console.log('  ok    Galvanized Scope: the nested trigger parses to +120 / +40 with 12s and a 5-stack cap as parameters');
  }
  {
    // Proton Snap: element [1] is " and +50% Status Chance for 20s." and must never be seen alone.
    const r = row('/Lotus/Upgrades/Mods/Sets/Spider/SpiderModC');
    const p = parsed.get(r.uniqueName);
    assert.ok(p);
    const texts = [...p.effects.map((e) => e.text), ...p.refused.map((x) => x.text)];
    assert.ok(texts.every((t) => !/^and /.test(t)), 'a Proton Snap fragment was parsed alone');
    assert.equal(p.refused.filter((x) => x.rank === maxRank(r)).length, 1);
    const joined = p.refused.find((x) => x.rank === maxRank(r));
    assert.equal(joined?.text, 'Hold Wall Latch for 2s to gain +100% <DT_POISON_COLOR>Toxin Damage and +50% Status Chance for 20s.');
    assert.equal(joined?.element, 0, 'the joined element keeps the index of its first fragment');
    assert.equal(p.effects.length, 0, 'verb-led prose emits no value, even with signed numbers in it');
    console.log('  ok    Proton Snap: the continuation joins onto element 0 and the joined sentence is refused whole');
  }
  {
    // Spring-Loaded Broadhead (a PvP row; the parser is pure, so it is parsed here directly).
    const r = allByPath.get('/Lotus/Upgrades/Mods/PvPMods/Rifle/DaikyuMoreDamageOverDistanceMod');
    assert.ok(r);
    const p = parseModStats(toInput(r));
    assert.equal(p.effects.length, 0, 'SABOTAGE: "+40%" inside "Increase damage by ..." is a guess if emitted');
    assert.equal(p.refused.length, 6, 'one refusal per rank');
    const thresholds = p.refused.map((x) => x.numbersFound[1]);
    assert.ok(p.refused.every((x) => x.numbersFound[0] === 40 && x.text.startsWith('Increase damage by +40% if the target is over ')), 'the +40 is constant and the fragment joined');
    assert.deepEqual(thresholds, [45, 39, 33, 27, 21, 15], 'the distance threshold scales while +40 does not');
    console.log('  ok    Spring-Loaded Broadhead: refused at every rank with the joined text; +40 constant, threshold 45 -> 15');
  }
  {
    // Entropy Detonation: three fragments join; only the syndicate counter is an effect.
    const r = row('/Lotus/Upgrades/Mods/Syndicate/ObexMod');
    const p = parsed.get(r.uniqueName);
    assert.ok(p);
    const top = atMax(r, p.effects);
    assert.deepEqual(top.map((e) => [e.op, e.stat, e.value, e.element]), [['template:syndicateCounter', 'entropy', 1, 3]]);
    const ref = p.refused.filter((x) => x.rank === maxRank(r));
    assert.equal(ref.length, 1);
    assert.equal(ref[0]?.text, "Lethal ground attacks cause enemies to explode dealing +1,000 (+20% Enemy Max Health) <DT_EXPLOSION_COLOR>Blast Damage in a +10m radius.");
    assert.deepEqual(ref[0]?.numbersFound, [1000, 20, 10], 'the comma-grouped number lexes whole');
    console.log('  ok    Entropy Detonation: three fragments join into one refused line; +1,000 lexes as one number');
  }
  {
    // Subject verbs: sign from the verb only when the number is unsigned; target from the subject.
    const pd = row('/Lotus/Upgrades/Mods/Aura/AvatarAuraPowerMaxMod');
    const eff = atMax(pd, parsed.get(pd.uniqueName)?.effects ?? []);
    assert.deepEqual(eff.map((e) => [e.stat, e.value, e.target]), [['ability strength', -30, 'self'], ['ability strength', 30, 'squad']], 'Power Donation: You lose -30, Squadmates gain +30');
    const cp = row('/Lotus/Upgrades/Mods/Aura/EnemyArmorReductionAuraMod');
    assert.deepEqual(atMax(cp, parsed.get(cp.uniqueName)?.effects ?? []).map((e) => [e.stat, e.value, e.target]), [['armor', -18, 'enemy']], 'Corrosive Projection: the displayed sign is authoritative');
    const rp = row('/Lotus/Upgrades/Mods/Aura/RobotPoorAimAuraMod');
    assert.deepEqual(atMax(rp, parsed.get(rp.uniqueName)?.effects ?? []).map((e) => [e.stat, e.value, e.target, e.faction]), [['accuracy', -15, 'enemy', 'Corpus']]);
    const sc = row('/Lotus/Upgrades/Mods/Aura/PlayerMeleeAuraMod');
    assert.deepEqual(atMax(sc, parsed.get(sc.uniqueName)?.effects ?? []).map((e) => [e.stat, e.value, e.target]), [['melee damage', 60, 'squad']], 'Steel Charge');
    const lh = row('/Lotus/Upgrades/Mods/Aura/WarframeAuraLoyalHerdMod');
    assert.deepEqual(atMax(lh, parsed.get(lh.uniqueName)?.effects ?? []).map((e) => [e.stat, e.value, e.unit, e.target]), [['health', 300, 'flat', 'companion'], ['armor', 180, 'flat', 'companion']], "Squad's Companions: two clauses, companion target");
    const rg = row('/Lotus/Upgrades/Mods/Aura/PlayerEnergyHealthRegenAuraMod');
    assert.deepEqual(atMax(rg, parsed.get(rg.uniqueName)?.effects ?? []).map((e) => [e.stat, e.value, e.unit]), [['energy regen', 0.3, '/s'], ['health regen', 1.5, '/s']], 'Regen/s is a per-second unit, not a distributive slash');
    console.log('  ok    R2: subject verbs set target and, only for an unsigned percent, the sign');
  }
  {
    // Distributive names and their elision, on real lines.
    const pick = (p: string): Effect[] => atMax(row(p), parsed.get(p)?.effects ?? []);
    assert.deepEqual(pick('/Lotus/Upgrades/Mods/Archwing/Rifle/ArchwingRifleCritChanceDamageAimingMod').map((e) => [e.stat, e.value, e.conditions]), [['critical chance', 60, ['when Aiming']], ['critical damage', 60, ['when Aiming']]], 'Critical Chance and Damage -> critical chance, critical damage');
    assert.deepEqual(pick('/Lotus/Upgrades/Mods/Warframe/IceParkourTwoMod').map((e) => [e.stat, e.value, e.damageType ?? null, e.conditions]), [
      ['parkour velocity', 24.2, null, []],
      ['aim glide duration', 24.2, null, []],
      ['wall latch duration', 24.2, null, []],
      ['parkour proc', 275, 'Cold', ['on Bullet Jump']],
    ], 'Ice Spring: leading "to" dropped, slash distributive completed, Cold on Bullet Jump is a parkour proc not weapon damage');
    assert.deepEqual(pick('/Lotus/Upgrades/Mods/Archwing/Rifle/ArchwingCCImmunityIfAimingMod').filter((e) => e.element === 0).map((e) => e.stat), ['chance to resist staggers', 'chance to resist knockdowns']);
    console.log('  ok    R3: distributive names expand by the elision rule, never by a vocabulary');
  }
  {
    // Parameters stay parameters; parentheticals and trailing sentences are classified, not dropped.
    const pick = (p: string): Effect[] => atMax(row(p), parsed.get(p)?.effects ?? []);
    const [ripkas] = pick('/Lotus/Upgrades/Mods/DualSource/Melee/RipkasShotgunMod');
    assert.deepEqual([ripkas?.stat, ripkas?.value, ripkas?.altMultiplier], ['critical chance', 187, { value: 2, context: 'Heavy Attacks' }]);
    const [bloodRush] = pick('/Lotus/Upgrades/Mods/Melee/Event/ComboCritChanceMod');
    assert.deepEqual([bloodRush?.value, bloodRush?.conditions], [40, ['stacks with Combo Multiplier']]);
    const [adapt] = pick('/Lotus/Upgrades/Mods/Nemesis/AvatarSentientArmourMod');
    assert.deepEqual([adapt?.stat, adapt?.value, adapt?.conditions, adapt?.duration, adapt?.stackCap], ['resistance to that damage type', 10, ['When Damaged'], 20, 90], 'Adaptation: 10 is the value, 20s and 90% are parameters');
    const [shieldMult] = pick('/Lotus/Upgrades/Mods/Warframe/DualStat/FixedShieldAndShieldGatingDuration');
    assert.deepEqual([shieldMult?.op, shieldMult?.value], ['multiply', 0.2]);
    const [bane] = pick('/Lotus/Upgrades/Mods/Rifle/WeaponFactionDamageCorrupted');
    assert.deepEqual([bane?.op, bane?.stat, bane?.value, bane?.faction], ['multiply', 'damage', 1.3, 'Orokin']);
    const [wpcc] = atMax(row('/Lotus/Upgrades/Mods/Pistol/WeaponWeakpointCriticalChanceMod'), parsed.get('/Lotus/Upgrades/Mods/Pistol/WeaponWeakpointCriticalChanceMod')?.effects ?? []).slice(1);
    assert.deepEqual([wpcc?.stat, wpcc?.notes], ['weak point critical chance', ['Multishot cannot be modified.']], 'a trailing sentence is a note');
    console.log('  ok    R3/R4: alt multipliers, stack caps, durations and notes never become the value');
  }
  {
    // Multi-line elements, by path: four stats in one element, a stat whose name
    // ends in "Cooldown", a distributive followed by a Cooldown line, a Tennokai prefix.
    const pick = (p: string): Effect[] => atMax(row(p), parsed.get(p)?.effects ?? []);
    const refusedOf = (p: string): Refused[] => (parsed.get(p)?.refused ?? []).filter((x) => x.rank === maxRank(row(p)));
    assert.deepEqual(pick('/Lotus/Upgrades/Mods/Railjack/Engineering/LavanEngineerMatrix').map((e) => [e.stat, e.value]), [['forge capacity', 33.75], ['forge cooldown', -22.5], ['elemental resistance', 22.5], ['turret heat capacity', 27]], 'SABOTAGE: "Forge Cooldown" is a stat name, not the Cooldown parameter');
    assert.deepEqual(pick('/Lotus/Upgrades/Mods/Railjack/Tactical/CrewShipAfterBurnersAbilityCard').map((e) => [e.stat, e.value, e.duration, e.cooldown]), [['speed', 38, 13, 240], ['boost speed', 38, 13, 240]], 'a Cooldown line attaches to every effect of its element');
    const [fr] = pick('/Lotus/Upgrades/Mods/Rifle/DualStat/CorruptedCritRateFireRateRifle').filter((e) => e.element === 1);
    assert.deepEqual([fr?.stat, fr?.value, fr?.altMultiplier], ['fire rate', -20, { value: 2, context: 'Bows' }]);
    assert.deepEqual(pick('/Lotus/Upgrades/Mods/Antiques/ShieldSchool').map((e) => [e.op, e.stat, e.value, e.scalingBasis ?? null]), [['add_flat', 'operator shields', 300, null], ['template:perSchoolMod', 'bonus', 30, 'each UNAIRU School Mod']]);
    const reach = row('/Lotus/Upgrades/EmpoweredHeavyMelee/PerfectReach');
    const reachP = parsed.get(reach.uniqueName);
    assert.ok(reachP);
    assert.equal(reachP.effects.filter((e) => e.op === 'template:tennokai').length, reach.levelStats?.length, 'Enables Tennokai. yields the template at every rank');
    assert.equal(reachP.effects.filter((e) => e.op !== 'template:tennokai').length, 0, 'and the rest of the sentence is R9, not a value');
    assert.equal(reachP.refused.length, reach.levelStats?.length);
    assert.equal(refusedOf('/Lotus/Types/Sentinels/SentinelPrecepts/GatherEnemies')[0]?.rule, 'R9', 'a colon in the middle of a sentence is not a trigger head');
    console.log('  ok    multi-line elements: every line parses on its own and Cooldown lines attach to their element');
  }
  {
    // R7 templates and R5, by path.
    const pick = (p: string): Effect[] => atMax(row(p), parsed.get(p)?.effects ?? []);
    assert.deepEqual(pick('/Lotus/Upgrades/Mods/Warframe/AvatarDamageToEnergyMod').map((e) => [e.op, e.value]), [['template:rage', 40]]);
    assert.deepEqual(pick('/Lotus/Upgrades/Mods/Warframe/AvatarPickupBonusMod').map((e) => [e.stat, e.value]), [['energy from health pickups', 110], ['health from energy pickups', 110]]);
    const [hem] = pick('/Lotus/Upgrades/Mods/Pistol/WeaponBleedOnImpactPistolMod');
    assert.deepEqual([hem?.op, hem?.value, hem?.damageType, hem?.altMultiplier?.value, hem?.threshold], ['procConversion', 35, 'Slash', 2, 2.5], 'Hemorrhage');
    assert.deepEqual(pick('/Lotus/Upgrades/Mods/Warframe/AvatarFallingImpactMod').map((e) => [e.op, e.value, e.notes]), [['template:heavyImpact', 300, ['radius=6m']]]);
    const [gather] = pick('/Lotus/Types/Sentinels/SentinelPrecepts/BeastUniversalVacuum');
    assert.deepEqual([gather?.op, gather?.stat, gather?.unit], ['add_flat', 'companion gather-link', 'm'], 'R5: the one leading-unsigned metre line');
    console.log('  ok    R7/R5: templates match verbatim and yield named fields');
  }
  {
    // The refuse list is refused, by path: unknown qualifier, dead mechanic, prose with a spaced unit, no-number line.
    const refusedOf = (p: string): Refused[] => (parsed.get(p)?.refused ?? []).filter((x) => x.rank === maxRank(row(p)));
    const effectsOf = (p: string): Effect[] => atMax(row(p), parsed.get(p)?.effects ?? []);
    assert.equal(effectsOf('/Lotus/Upgrades/Mods/Sets/Synth/PistolSynthChargeMod').length, 0, 'SABOTAGE: "on final shot" is not in the R4 list; keeping the head and dropping the tail is the defect');
    assert.equal(refusedOf('/Lotus/Upgrades/Mods/Sets/Synth/PistolSynthChargeMod')[0]?.rule, 'R4');
    assert.equal(refusedOf('/Lotus/Upgrades/Mods/DualSource/Rifle/JavlokSwordShieldMod').find((x) => x.text.includes('with a Shield'))?.rule, 'R4');
    assert.equal(refusedOf('/Lotus/Upgrades/Mods/Melee/Channel/ChannelArmourMod').find((x) => x.text.includes('Parry Angle'))?.rule, 'E');
    assert.equal(refusedOf('/Lotus/Upgrades/Mods/Antiques/VoidSlingCrateBreaker')[0]?.rule, 'R9', 'Tektolyst "12 m" is prose');
    const bc = effectsOf('/Lotus/Upgrades/Mods/Sentinel/Kubrow/BeastWeapon/KubrowColdConversionMod');
    assert.ok(bc.some((e) => e.op === 'unparsed' && e.value === null && e.text.startsWith('Converts all elemental damage')), 'a no-number line is an unparsed effect for display');
    assert.equal(refusedOf('/Lotus/Upgrades/Mods/OrokinChallenge/OrokinChallengeModCollaboration').length, 1, 'Coaction Drift: "an additional +N%" is prose');
    const sanctuary = row('/Lotus/Types/Sentinels/SentinelPrecepts/Sanctuary');
    assert.equal(parsed.get(sanctuary.uniqueName)?.corrupt, null, 'SABOTAGE: 1050 must lex as one number or Sanctuary reads as corrupt');
    console.log('  ok    Part E: the refuse list refuses by rule, and a no-number line is surfaced, not dropped');
  }
  {
    // A7 description as condition / restriction.
    //
    // The trigger half of this used to be VACUOUS: both kept rows carrying an
    // A7 trigger description (Brief Respite, Slay Board) parse to ZERO effects,
    // so `for (const e of effects) assert(...)` asserted nothing and would have
    // passed with the A7 code deleted. Every row in the export whose
    // description is an A7 trigger AND which emits effects is a Conclave row,
    // so the branch is exercised where it actually runs - parsed directly, the
    // way Spring-Loaded Broadhead already is above.
    const withDesc = kept.filter((r) => r.description === 'On Ability Cast:' || r.description === 'On Directional Dismount:');
    assert.deepEqual(
      withDesc.map((r) => [r.name, (parsed.get(r.uniqueName)?.effects ?? []).length]),
      [['Brief Respite', 0], ['Slay Board', 0]],
      'the two kept A7-trigger rows still parse to no effect; if one starts emitting, assert on it here instead of looping over nothing',
    );
    let triggerAttached = 0;
    for (const p of ['/Lotus/Upgrades/Mods/PvPMods/Rifle/TetraFasterProjAiming', '/Lotus/Upgrades/Mods/PvPMods/Warframe/EnergyOnKill', '/Lotus/Upgrades/Mods/PvPMods/Melee/IncreasedMobilityEquipped']) {
      const r = allByPath.get(p);
      assert.ok(r, `${p} is in the export`);
      const eff = parseModStats(toInput(r)).effects;
      assert.ok(eff.length > 0, `${r.name} must emit effects for its A7 trigger to attach to`);
      for (const e of eff) {
        assert.ok(e.conditions.includes((r.description ?? '').replace(/:$/, '')), `${r.name} carries its description as a condition`);
        triggerAttached++;
      }
    }
    assert.equal(triggerAttached, 16, `the A7 trigger reached ${String(triggerAttached)} effects, not the measured 16`);
    const restricted = kept.filter((r) => /cannot be modified|Only compatible with/.test(r.description ?? ''));
    assert.deepEqual(restricted.map((r) => r.name).sort(), ['Semi-Pistol Cannonade', 'Semi-Rifle Cannonade', 'Semi-Shotgun Cannonade']);
    let restrictionAttached = 0;
    for (const r of restricted) for (const e of parsed.get(r.uniqueName)?.effects ?? []) {
      assert.ok(e.conditions.includes(r.description ?? ''), `${r.uniqueName} carries its restriction`);
      restrictionAttached++;
    }
    assert.equal(restrictionAttached, 36, `the A7 restriction reached ${String(restrictionAttached)} effects, not the measured 36`);
    console.log(`  ok    A7: the restriction reached ${String(restrictionAttached)} effects on 3 kept rows and the trigger ${String(triggerAttached)} on 3 dropped ones (the two kept trigger rows emit nothing)`);
  }

  // --- R5b: a leading unsigned percent, only in front of a Title-Case stat name ---------
  {
    const aero = '/Lotus/Upgrades/Mods/Sets/Hawk/HawkModB';
    assert.deepEqual(
      atMax(row(aero), parsed.get(aero)?.effects ?? []).map((e) => [e.op, e.stat, e.value, e.unit, e.conditions]),
      [['add_pct', 'reload speed', 100, '%', ['while Aim Gliding']]],
      'Aero Agility: +100% at max rank, and "while Aim Gliding" is a CONDITION - emitting it unconditional is the data-corruption bug this rule exists to avoid',
    );
    const motus = '/Lotus/Upgrades/Mods/Sets/Raptor/RaptorModB';
    assert.deepEqual(
      atMax(row(motus), parsed.get(motus)?.effects ?? []).map((e) => [e.stat, e.value, e.conditions, e.duration]),
      [
        ['critical chance', 100, ['after landing from a Double or Bullet Jump'], 4],
        ['status chance', 100, ['after landing from a Double or Bullet Jump'], 4],
      ],
      'Motus Setup: the distributive name splits and BOTH halves keep the condition and the 4s duration',
    );
    // The digit-leading lines the guard must keep refusing. Each is a real row
    // whose text opens with a number and is not a delta.
    for (const [p, why] of [
      ['/Lotus/Upgrades/Focus/Ward/Residual/ReflectDamageFocusUpgrade', 'Void Spines "5% Damage taken is returned to the attacker" opens Title-Case and is still a sentence'],
      ['/Lotus/Upgrades/Mods/Rifle/WeaponSpreadFreezeProcsMod', 'Shivering Contagion "17% chance to spread that status ..." is a chance, not a magnitude'],
      ['/Lotus/Upgrades/Mods/DataSpike/Assassin/OnExecutionEnergyDropMod', 'Blood For Energy "50% chance to drop an Energy Orb on Mercy"'],
      ['/Lotus/Upgrades/Mods/Necromech/NecromechEnergyToOvershieldsMod', 'Necramech Augur "40% Energy spent on abilities is converted to Shields"'],
      ['/Lotus/Upgrades/Mods/Sentinel/SentinelOverheatDamageMod', 'Fired Up "0.8% Heat Damage on weapon per hit" is a running total'],
      ['/Lotus/Upgrades/Mods/Sentinel/Kubrow/BeastWeapon/BeastDrainingBiteMod', 'Bloodthirst "25 health stolen each hit" is unsigned AND flat'],
    ] as const) {
      assert.equal((parsed.get(p)?.effects ?? []).length, 0, `SABOTAGE: ${why}`);
      assert.ok((parsed.get(p)?.refused ?? []).length > 0, `${p} refuses rather than dropping the line`);
    }
    // Catalogue-wide: an effect from a digit-leading line is an R5b effect
    // (the two spec-named R5 forms aside), and every one of them is conditional.
    const r5b = allEffects.filter(({ e }) => /^\d/.test(e.text) && !/Companion Gather-Link|of Damage converted into/.test(e.text));
    assert.equal(r5b.length, 12, `R5b emitted ${String(r5b.length)} effect records, not the 12 measured`);
    assert.deepEqual([...new Set(r5b.map(({ u }) => byPath.get(u)?.name ?? u))].sort(), ['Aero Agility', 'Motus Setup']);
    assert.equal(r5b.filter(({ e }) => e.conditions.length === 0).length, 0, 'an R5b effect came out unconditional; Q1 scores conditions.length === 0, so that changes real recommendations');
    console.log(`  ok    R5b: ${String(r5b.length)} effects from a leading unsigned percent, all conditional; every other digit-leading line still refuses`);
  }

  // --- R9b: "Increase|Reduce <name> by <magnitude>" with nothing after it ---------------
  {
    const pick = (p: string): Effect[] => atMax(row(p), parsed.get(p)?.effects ?? []);
    assert.deepEqual(pick('/Lotus/Upgrades/Focus/Tactic/Stats/DashSpeedFocusUpgrade').map((e) => [e.op, e.stat, e.value, e.unit]), [['add_pct', 'void sling speed', 120, '%']], 'Mind Sprint');
    assert.deepEqual(pick('/Lotus/Upgrades/Focus/Defense/Stats/HealthMaxFocusUpgrade').map((e) => [e.stat, e.value]), [['operator health', 200], ['operator armor', 200]], 'Enduring Tides: "Operator Health and Armor" distributes through the elision rule');
    assert.deepEqual(pick('/Lotus/Upgrades/Focus/Defense/Residual/RadialXpFocusUpgrade').map((e) => [e.op, e.stat, e.value, e.unit]), [['add_flat', 'affinity radius', 25, 'm']], 'Mending Unity: a metre unit, never a percent');
    assert.deepEqual(pick('/Lotus/Upgrades/Mods/Railjack/Tactical/CrewShipBattleCraftingAbilityCard').map((e) => [e.stat, e.value, e.unit, e.cooldown]), [['forge cooldown', -120, 's', 480]], 'Battle Forge: "Reduce ... by 120s" is NEGATIVE - a positive here would report a drawback as a bonus, and the 480s Cooldown line attaches as a parameter');
    // The tail guard. Everything below has text after the magnitude and must refuse.
    for (const [p, why] of [
      ['/Lotus/Upgrades/Mods/Sentinel/Kubrow/KubrowLinkHealthMaxMod', 'Link Vitality "+11% of Warframe\'s Max Health" is a fraction of ANOTHER unit\'s stat, not +11% Health'],
      ['/Lotus/Upgrades/Mods/Sentinel/Kubrow/KubrowLinkArmourMaxMod', 'Link Fiber, same shape'],
      ['/Lotus/Upgrades/Mods/DataSpike/Cipher/DamageReductionOnHackMod', 'Firewall "Reduces damage by 75% while hacking" is damage TAKEN, not the `damage` Q1 scores'],
    ] as const) assert.equal((parsed.get(p)?.effects ?? []).length, 0, `SABOTAGE: ${why}`);
    const r9b = allEffects.filter(({ e }) => R9B_TEXT.test(e.text) && !e.op.startsWith('template:'));
    assert.equal(r9b.length, 85, `R9b emitted ${String(r9b.length)} effect records, not the 85 measured`);
    const reduce = r9b.filter(({ e }) => /^Reduces? /.test(e.text));
    assert.equal(reduce.length, 9, `${String(reduce.length)} "Reduce" records, not the 9 measured (Battle Forge, one per rank)`);
    assert.deepEqual(reduce.filter(({ e }) => (e.value ?? 0) >= 0), [], 'a "Reduce ... by N" came out positive');
    assert.deepEqual(r9b.filter(({ e }) => /^Increases? /.test(e.text) && (e.value ?? 0) <= 0), [], 'an "Increase ... by N" came out negative');
    assert.equal(allRefused.filter(({ x }) => x.reason.startsWith('verb "')).length, 0, 'this export shows no line whose displayed sign contradicts its verb; if one appears the guard must refuse it, not resolve it');
    // Two guards inside R9b have NO live instance on this export, so no
    // assertion about the parser's output can watch them - deleting either one
    // changes nothing and the gate would pass. What the gate can watch is that
    // they are still unreachable: the day one of these counts moves off zero
    // the guard has gone live and needs a real assertion under it.
    const r8Shaped = allRefused.concat(allEffects.map(({ u, e }) => ({ u, x: { rank: e.rank, element: e.element, rule: '', reason: '', text: e.text, numbersFound: [] } })))
      .filter(({ x }) => R9B_TEXT.test(x.text) && /(?<!\bup |Damage |Health |Energy |ammo pickups )\b(?:to|at) \d|\breduced to\b|\bset to\b/i.test(x.text));
    assert.deepEqual(r8Shaped.map(({ x }) => x.text), [], 'a line now matches BOTH the R9b shape and R8 "set-to"; the !R8.test guard has gone live and needs its own assertion');
    assert.equal(allEffects.filter(({ e }) => R9B_TEXT.test(e.text) && /^Reduces? .* by \+/.test(e.text)).length, 0, 'a "Reduce ... by +N" was emitted; the sign-disagreement guard has gone live');
    console.log(`  ok    R9b: ${String(r9b.length)} effects from "Increase|Reduce <name> by <n>", ${String(reduce.length)} of them negative from the verb; any trailing text still refuses`);
  }

  // --- the augment header conditions the rest of its row --------------------------------
  // The two rows are selected by the property under test - a row that carries
  // BOTH an augment header and an effect - rather than by a quoted path.
  // Deliberate: an augment card's uniqueName lives under `/Lotus/Powersuits/`,
  // which check-fixture-paths.ts resolves against the ITEM exports, where a mod
  // row does not appear. Selecting them structurally is also the stronger
  // claim: it pins that there are exactly two such rows in the export, so a
  // third one appearing cannot slip through unconditioned.
  {
    const withAugment = [...parsed.entries()]
      .filter(([u, p]) => p.effects.length > 0 && p.refused.some((x) => x.reason === 'augment prose') && byPath.has(u))
      .map(([u, p]) => ({ name: byPath.get(u)?.name ?? u, top: atMax(row(u), p.effects).map((e) => [e.stat, e.value, e.conditions]) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(
      withAugment,
      [
        { name: 'Piercing Navigator', top: [['projectile punch through', 3, ['Navigator Augment']]] },
        { name: 'Swing Line', top: [['parkour velocity', 20, ['Rip Line Augment']]] },
      ],
      'the two rows that carry both an augment header and a stat line: Piercing Navigator writes the header one LINE above its effect, Swing Line one ELEMENT above, and both effects must name the augment they depend on',
    );
    const augmented = allEffects.filter(({ e }) => e.conditions.some((c) => / Augment$/.test(c)));
    assert.equal(augmented.length, 8, `${String(augmented.length)} augment-conditioned effects, not the 8 measured`);
    const leaked = allEffects.filter(({ u, e }) => e.conditions.length === 0 && (parsed.get(u)?.refused ?? []).some((x) => x.rank === e.rank && x.reason === 'augment prose'));
    assert.deepEqual(leaked.map(({ u, e }) => `${u}: ${e.text}`), [], 'an effect on a row with an augment header came out unconditional');
    console.log(`  ok    augments: ${String(augmented.length)} effects on ${String(withAugment.length)} rows carry the augment header their line sits next to, and none on such a row is unconditional`);
  }

  // --- F7: the refusal histogram -----------------------------------------------------
  {
    const byRule = new Map<string, Map<string, { n: number; example: string; who: string }>>();
    for (const { u, x } of allRefused) {
      const m = byRule.get(x.rule) ?? new Map<string, { n: number; example: string; who: string }>();
      const key = `${x.reason} :: ${shape(x.text)}`;
      const entry = m.get(key) ?? { n: 0, example: x.text, who: u };
      entry.n++;
      m.set(key, entry);
      byRule.set(x.rule, m);
    }
    console.log('\n  refusals by rule (distinct shapes, top 10 texts each):');
    for (const [rule, m] of [...byRule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const total = [...m.values()].reduce((s, e) => s + e.n, 0);
      console.log(`    ${rule}: ${String(total)} lines, ${String(m.size)} shapes`);
      for (const [key, e] of [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 10)) {
        console.log(`      ${String(e.n).padStart(4)}  ${key.split(' :: ')[0] ?? ''}  ${JSON.stringify(e.example).slice(0, 110)}  <- ${e.who.split('/').slice(-2).join('/')}`);
      }
    }
    console.log('');
    const scored = allEffects.filter(({ e }) => e.op !== 'unparsed').length;
    console.log(`  ok    F7: ${String(allRefused.length)} refusals in ${String(byRule.size)} rules printed above; ${String(scored)} scored effects`);
  }

  console.log('\ncheck-modstats: ok');
}

await main();
