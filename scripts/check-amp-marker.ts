/**
 * The Mote Amp exclusion must still match the Mote Amp.
 *
 * WHY THIS EXISTS
 * ────────────────────────
 * The Eidolon route needs a real Amp, and its own first step says so: "the
 * starter Mote Amp is not enough". `owns(acc, 'amp')` enforced that by
 * excluding anything matching `/AmpPrism.*Mote|MoteAmp/i`.
 *
 * That pattern matched NOTHING. DE's paths for the starter's three components
 * are `/Lotus/Weapons/Sentients/OperatorAmplifiers/SentTrainingAmplifier/
 * SentAmpTraining{Barrel,Chassis,Grip}` - there is no "MoteAmp" and no
 * "AmpPrism" anywhere in them. So the exclusion never fired, and every player
 * who had finished Vox Solaris - which is everyone with an Operator - was
 * reported ready to hunt Eidolons with a weapon that cannot break their
 * shields.
 *
 * That is the shape of failure this whole file exists for: a guard written from
 * a plausible name rather than from the data, which silently does nothing.
 *
 * WHAT IS CHECKED
 * ────────────────────────
 * The marker must still identify the starter's components upstream, and must
 * NOT catch ordinary amp parts. Both halves matter: a marker that matches
 * nothing lets the starter through, and one that matches everything hides every
 * real Amp a player has built.
 *
 * OFFLINE IS A SKIP, like the other live gates.
 *
 * Run: node scripts/check-amp-marker.ts
 */
import assert from 'node:assert/strict';
import { MOTE_AMP_MARKER } from '../src/data/plat-capability.ts';

const WFCD = 'https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/Misc.json';

async function main(): Promise<void> {
  let parts: Array<{ name: string; path: string }>;
  try {
    const res = await fetch(WFCD);
    if (!res.ok) throw new Error(`the export responded ${String(res.status)}`);
    const body: unknown = await res.json();
    assert.ok(Array.isArray(body), 'the export was not an array');
    parts = (body as Array<{ name?: unknown; uniqueName?: unknown }>)
      .filter((i): i is { name: string; uniqueName: string } => typeof i.name === 'string' && typeof i.uniqueName === 'string')
      .filter((i) => /\/OperatorAmplifiers\//i.test(i.uniqueName))
      .map((i) => ({ name: i.name, path: i.uniqueName }));
    assert.ok(parts.length > 10, `the export carried only ${String(parts.length)} amp components`);
  } catch (err) {
    console.log(`  SKIP  amp components unreachable (${err instanceof Error ? err.message : String(err)})`);
    console.log('\nthe Mote Amp marker is unverified; run again with a connection');
    return;
  }

  const marker = MOTE_AMP_MARKER.toLowerCase();
  const matched = parts.filter((p) => p.path.toLowerCase().includes(marker));
  const bad: string[] = [];

  /*
   * The starter is three components - a prism, a scaffold and a brace - and all
   * three carry the marker. Fewer than three means DE moved or renamed part of
   * it and the exclusion has started leaking.
   */
  if (matched.length === 0) {
    bad.push(
      `"${MOTE_AMP_MARKER}" matches no amp component upstream, so the starter Amp counts as a real one ` +
        'and every player reads as Eidolon-ready',
    );
  } else if (matched.length < 3) {
    bad.push(
      `"${MOTE_AMP_MARKER}" matches only ${String(matched.length)} components (${matched.map((m) => m.name).join(', ')}); ` +
        'the starter has three, so part of it is no longer excluded',
    );
  }

  // And it must not swallow real Amps.
  const wrongly = matched.filter((m) => !/^mote /i.test(m.name));
  if (wrongly.length > 0) {
    bad.push(
      `"${MOTE_AMP_MARKER}" also catches ${String(wrongly.length)} component(s) that are not the starter: ` +
        `${wrongly.slice(0, 4).map((m) => m.name).join(', ')} - real Amps would be hidden`,
    );
  }

  for (const line of bad) console.log(`  FAIL  ${line}`);
  assert.deepEqual(bad, [], 'the Mote Amp exclusion no longer describes the Mote Amp');

  console.log(
    `  ok    "${MOTE_AMP_MARKER}" still identifies exactly the starter's ${String(matched.length)} components, out of ${String(parts.length)}`,
  );
  console.log('\nthe Amp requirement still means a real Amp');
}

await main();
