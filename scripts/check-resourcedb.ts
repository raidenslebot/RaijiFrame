/**
 * Self-check for the resource catalog parser.
 *
 * What is being defended: a catalog parser's failure mode is not "throws", it is
 * "quietly produces a row that looks real". Every assertion here is about the
 * boundary between a usable entry and a discarded one, because a resource with
 * no name would render as a blank row the player would reasonably read as a real
 * item they have never heard of.
 *
 * Run: node scripts/check-resourcedb.ts
 */
import assert from 'node:assert/strict';
import { isMiscResource, parseResources } from '../src/data/resourcedb.ts';

let checks = 0;
const ok = (cond: unknown, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};
const eq = <T>(a: T, b: T, msg: string) => {
  assert.deepStrictEqual(a, b, msg);
  checks++;
};

/* ------------------------------------------------------------- a real shape */

// Field names and shape taken from WFCD's published Resources.json.
const SAMPLE = JSON.stringify([
  {
    uniqueName: '/Lotus/Types/Items/MiscItems/Ferrite',
    name: 'Ferrite',
    description: 'A common alloy.',
    type: 'Resource',
    imageName: 'ferrite.png',
    tradable: false,
  },
  {
    uniqueName: '/Lotus/Types/Items/MiscItems/Hexenon',
    name: 'Hexenon',
    description: 'A volatile compound.',
    type: 'Resource',
    imageName: 'hexenon.png',
    tradable: true,
  },
]);

{
  const rows = parseResources(SAMPLE);
  eq(rows.length, 2, 'both well-formed rows survive');

  const ferrite = rows.find((r) => r.name === 'Ferrite');
  ok(ferrite, 'Ferrite parsed');
  eq(ferrite!.uniqueName, '/Lotus/Types/Items/MiscItems/Ferrite', 'uniqueName preserved verbatim');
  eq(ferrite!.type, 'Resource', 'type read');
  eq(ferrite!.tradable, false, 'tradable false stays false');

  const hexenon = rows.find((r) => r.name === 'Hexenon');
  eq(hexenon!.tradable, true, 'tradable true stays true');
}

{
  // Sorted, so the panel does not reshuffle between loads.
  const rows = parseResources(SAMPLE);
  eq(
    rows.map((r) => r.name),
    ['Ferrite', 'Hexenon'],
    'output is sorted by name',
  );
}

/* ---------------------------------------------- absent is null, never a guess */

{
  const rows = parseResources(
    JSON.stringify([{ uniqueName: '/Lotus/Types/Items/MiscItems/Bare', name: 'Bare' }]),
  );
  eq(rows.length, 1, 'a row needs only a name and a path to be usable');
  eq(rows[0]!.type, null, 'a missing type is null, not an empty string');
  eq(rows[0]!.description, null, 'a missing description is null');
  eq(rows[0]!.imageName, null, 'a missing image is null');
  eq(rows[0]!.tradable, false, 'tradable defaults to false only because absent means not tradable');
}

/* ------------------------------------------------- unusable rows are dropped */

{
  const rows = parseResources(
    JSON.stringify([
      { name: 'No path' },
      { uniqueName: '/Lotus/Types/Items/MiscItems/NoName' },
      { uniqueName: '', name: '' },
      null,
      42,
      { uniqueName: '/Lotus/Good', name: 'Good' },
    ]),
  );
  eq(rows.length, 1, 'only the complete row survives');
  eq(rows[0]!.name, 'Good', 'and it is the right one');
}

{
  // Empty strings are absent, not values: a resource named "" would render as a
  // blank row the player would read as a real item.
  const rows = parseResources(JSON.stringify([{ uniqueName: '/Lotus/X', name: '' }]));
  eq(rows.length, 0, 'an empty name is not a name');
}

/* ------------------------------------------------------ malformed input ---- */

{
  eq(parseResources('[]').length, 0, 'an empty array yields nothing');
  eq(parseResources('{}').length, 0, 'a non-array payload yields nothing rather than throwing');
  eq(parseResources('null').length, 0, 'null yields nothing');
}

{
  // A truncated response must fail loudly at the JSON layer, where the caller
  // catches it and reports the catalog as failed — NOT silently as zero
  // resources, which would read as "this game has no resources".
  assert.throws(() => parseResources('[{"uniqueName":'), 'truncated JSON throws rather than returning []');
  checks++;
}

{
  // Misc.json is where the classic planet drops live. Keep the MiscItems rows
  // typed Resource or Misc; a Captura scene or a relic on another path is not
  // a resource however the account files it.
  const rows = parseResources(
    JSON.stringify([
      { uniqueName: '/Lotus/Types/Items/MiscItems/Ferrite', name: 'Ferrite', type: 'Misc' },
      { uniqueName: '/Lotus/Types/Items/MiscItems/Neurode', name: 'Neurodes', type: 'Resource' },
      { uniqueName: '/Lotus/Types/Items/MiscItems/PhotoboothTile', name: 'Scene', type: 'Captura' },
      { uniqueName: '/Lotus/Types/Game/Projections/T1', name: 'Relic', type: 'Misc' },
    ]),
    isMiscResource,
  );
  assert.deepEqual(rows.map((r) => r.name), ['Ferrite', 'Neurodes'], 'Misc.json keeps the planet drops and nothing else');
  checks++;
}

console.log(`check-resourcedb: ${checks} assertions passed`);
