/**
 * The stat-string parser: one mod row's `levelStats` strings, one rank at a
 * time, into effects an optimiser can score and refusals it can show.
 *
 * Built against docs/research/moddb-spec.md Parts B-E, which were measured on
 * the real export. The code is shaped by the mistakes that census found:
 *
 *   - The LINE break is the two-character sequence backslash+n. There is no
 *     U+000A anywhere in `levelStats`; a splitter on a real newline finds
 *     nothing and reads "On Headshot:\n+120% Critical Chance ..." as one line.
 *   - A number is a magnitude only where B7 says so. "for 12s", "Stacks up to
 *     5x", "within 3000m", "Magazine 6 or higher" are parameters, and emitting
 *     one of them as the effect's value is the defect this file exists to
 *     avoid. So the grammar consumes every qualifier it knows and REFUSES a
 *     line the moment it meets text it does not - it never keeps the head and
 *     drops the tail.
 *   - Refusal is a result, not an error. Every refused line comes back with its
 *     rule, reason, full text and the numbers seen, so the optimiser can say
 *     "this mod does something the model does not score" instead of scoring a
 *     guess. A no-number line ("Convert all base Physical Damage to Impact")
 *     is also returned as an `unparsed` effect so it can be displayed and vetoed.
 *   - Percentages stay on the 100 scale (+165 means +165 %), the displayed sign
 *     is the sign, and nothing is derived from another rank: every rank parses
 *     alone, and a line whose digits->N shape differs between ranks marks the
 *     whole row corrupt (A6) rather than being "fixed".
 *
 * Pure: no fetch, no imports, no player data.
 */

// ---------------------------------------------------------------------------
// Part D - output
// ---------------------------------------------------------------------------

export interface Effect {
  rank: number;
  element: number;
  /** canonical case-folded key */
  stat: string;
  op: 'add_pct' | 'add_flat' | 'multiply' | 'convert' | 'procConversion' | 'unparsed' | `template:${string}`;
  /** exactly as displayed; percent on the 100 scale; null for unparsed */
  value: number | null;
  unit: '%' | 'flat' | 'm' | 's' | '/s' | null;
  damageType?: string;
  faction?: string;
  target: 'self' | 'squad' | 'enemy' | 'companion';
  /** trigger, state, weaponClass, abilityOrdinal, restriction (A7) */
  conditions: string[];
  duration?: number;
  stackCap?: number;
  cooldown?: number;
  threshold?: number;
  scalingBasis?: string;
  altMultiplier?: { value: number; context: string };
  notes: string[];
  /** the line it came from, always */
  text: string;
}

export interface Refused {
  rank: number;
  element: number;
  rule: string;
  reason: string;
  text: string;
  numbersFound: number[];
}

export interface ModStatsInput {
  uniqueName: string;
  name: string;
  description: string | null;
  /** levelStats[rank] = that rank's strings */
  levelStats: string[][];
}

// ---------------------------------------------------------------------------
// Part B - lexer pieces
// ---------------------------------------------------------------------------

/** B3. The comma form needs a comma group, or `1050` lexes as `105` + `0`. */
const NUM_SRC = String.raw`[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const NUM_G = new RegExp(NUM_SRC, 'g');
/** A NUM that ends here: no letter or digit may follow (`5x`, `12s`, `4th` are read whole). */
const END = String.raw`(?![A-Za-z0-9])`;

const toNumber = (raw: string): number => Number(raw.replace(/,/g, ''));
const numbersIn = (s: string): number[] => (s.match(NUM_G) ?? []).map(toNumber);
/** The A6 shape: every NUM replaced by N. */
export const shape = (s: string): string => s.replace(NUM_G, 'N');

/** B2. Tag -> damage type. Any DT tag not here is refused, never guessed. */
const DT_TYPES: Readonly<Record<string, string>> = {
  IMPACT: 'Impact',
  PUNCTURE: 'Puncture',
  SLASH: 'Slash',
  FIRE: 'Heat',
  FREEZE: 'Cold',
  ELECTRICITY: 'Electricity',
  POISON: 'Toxin',
  EXPLOSION: 'Blast',
  RADIATION: 'Radiation',
  GAS: 'Gas',
  MAGNETIC: 'Magnetic',
  VIRAL: 'Viral',
  CORROSIVE: 'Corrosive',
  RADIANT: 'Void',
  SENTIENT: 'Tau',
};
/** The word that may follow a DT tag and is consumed with it (`<DT_ELECTRICITY_COLOR>Electric`). */
const DT_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  IMPACT: ['impact'],
  PUNCTURE: ['puncture'],
  SLASH: ['slash'],
  FIRE: ['heat', 'fire'],
  FREEZE: ['cold', 'freeze'],
  ELECTRICITY: ['electricity', 'electric', 'electrical'],
  POISON: ['toxin', 'poison', 'toxic'],
  EXPLOSION: ['blast', 'explosion'],
  RADIATION: ['radiation'],
  GAS: ['gas'],
  MAGNETIC: ['magnetic'],
  VIRAL: ['viral'],
  CORROSIVE: ['corrosive'],
  RADIANT: ['void', 'radiant'],
  SENTIENT: ['tau', 'sentient'],
};
const SCHOOL_TAG = /<(MADURAI|NARAMON|ZENURIK|VAZARIN|UNAIRU)_CLEAN>/;
const ICON_TAG = /<(ENERGY|SHIELD|USE|SECONDARY_FIRE|AFFINITY_SHARE|ACTIVATE_ABILITY_\d+)>/;
const ANY_TAG = /<[A-Z0-9_]+>/g;
const PLACEHOLDER = /\|[A-Z0-9]+\|/;

/** B6. `Damage to Amps` is a stat name, not a faction: Amps is deliberately absent. */
const FACTIONS = ['Corpus', 'Grineer', 'Infested', 'Orokin', 'Murmur', 'Sentients'] as const;

/** Part E: dead mechanics. A number for these is a number for nothing. */
const DEAD_STATS = new Set(['channeling damage', 'energy rate', 'damage block', 'parry angle', 'gore chance']);

/**
 * B1. Backslash+n -> LINE (rendered as U+000A internally, which the input never
 * contains), <LINE_SEPARATOR> removed, spaces collapsed, curly apostrophe
 * straightened. `<LOWER_IS_BETTER>` is presentation only and is deleted here
 * too: it never carries sign, and leaving it in would make "You lose
 * <LOWER_IS_BETTER>5% Ability Strength" fail the subject rule.
 */
function prepass(s: string): string {
  return s
    .replace(/<LINE_SEPARATOR>/g, '')
    .replace(/<LOWER_IS_BETTER>/g, '')
    .replace(/’/g, "'")
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Replace every DT tag (+ its optional adjacent type word) with one `@Type` word. */
function foldDamageTypes(line: string): string {
  return line.replace(/<DT_([A-Z]+?)(?:_COLOR)?>( ?)([A-Za-z]+)?/g, (whole, key: string, gap: string, word: string | undefined) => {
    const type = DT_TYPES[key];
    if (type === undefined) return whole;
    const variants = DT_VARIANTS[key] ?? [];
    if (word !== undefined && variants.includes(word.toLowerCase())) return `@${type}`;
    // The word after the tag was not a type name (`<DT_FIRE_COLOR> Damage`): keep it.
    return `@${type}${gap}${word ?? ''}`;
  });
}

// ---------------------------------------------------------------------------
// Part C - grammar
// ---------------------------------------------------------------------------

/** R1. Trigger heads, lower-cased, digits->N, DT tags folded to `@type`. Anything else with a colon is refused. */
const TRIGGER_HEADS = new Set([
  'on kill',
  'on melee kill',
  'on headshot',
  'on headshot kill',
  'on hit',
  'on critical hit',
  'on reload',
  'on reload from empty',
  'on equip',
  'on ability cast',
  'on dodge',
  'on low health',
  'on status effect',
  'on status effect with weapon',
  'on weak point hit',
  'on weak point kill',
  'on weak point hits with primary fire',
  'on heavy attack hit',
  'on bullet jump',
  'on kill or assist',
  'on kill with secondary weapon',
  'on consecutive throw (max stacks n)',
  'on n hits within ns',
  'on n melee kills within ns',
  'when damaged',
  'at less than n health',
  'burst fire only',
]);
const TRIGGER_HEAD_DTYPE = /^on @[a-z]+ status effect$/;
const AUGMENT_HEAD = /^[A-Za-z'&\- ]+ Augment ?:/;

/** R2. The subject prefixes; the verb decides target and, for an unsigned percent, the sign. */
const SUBJECT = new RegExp(
  String.raw`^(?:(Squad's Companions) (receives?)|(Squad) (receives?|gains?|deals|takes|converts|benefits|begins the mission with)|(Warframe) (receives)|(You) (lose|benefit)|(Squadmates) (gain)|(Enemies) (lose)|(Enemy (?:${FACTIONS.join('|')})) (lose)) `,
);

/** A magnitude at the cursor (B7): a signed NUM with optional unit, or a MULT. */
const SIGNED_MAG = new RegExp(String.raw`([+-])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(%|/s|m|s)?${END}`, 'y');
const UNSIGNED_PCT = new RegExp(String.raw`((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)%${END}`, 'y');
const MULT = new RegExp(String.raw`x(\d+(?:\.\d+)?)${END}`, 'y');
/** ` and ` followed by another magnitude starts an independent R3 (never a distributive). */
const AND_NEXT = /and (?=[+-]\d|x\d)/iy;
const NAME_WORD = /@?[&'A-Za-z][A-Za-z'&\-/]*/y;
/**
 * Words that open a qualifier. Reaching one that no QUAL rule accepts is the R4
 * refusal. `cooldown` is deliberately absent: "-2.5% Forge Cooldown" is a stat,
 * and the parameter form always carries its colon (`Cooldown: Ns`), which the
 * QUAL rule matches on its own.
 */
const TERMINATOR = /(when|while|during|on|for|per|against|after|if|stacks|within|every|capped|below|next|up to)(?![A-Za-z'\-/])/iy;

interface Draft {
  conditions: string[];
  notes: string[];
  duration?: number;
  stackCap?: number;
  cooldown?: number;
  threshold?: number;
  scalingBasis?: string;
  altMultiplier?: { value: number; context: string };
}

interface Qual {
  re: RegExp;
  apply: (m: RegExpExecArray, d: Draft) => void;
}

const N = String.raw`(${NUM_SRC})`;
/** A qualifier must end at a boundary: end of line, space, period, comma or a closing paren. */
const B = String.raw`(?=$|[ .,)])`;
const cond = (m: RegExpExecArray, d: Draft): void => {
  d.conditions.push(m[0].trim());
};

/**
 * R4 / B7. Each entry is one qualifier the grammar knows, in the order tried.
 * The open-ended ones (`per`, `against`, `after`, `if`) consume up to the next
 * punctuation or the next parameterised qualifier, so "per Status Type
 * affecting the target for 20s" yields a basis and a duration, not a basis
 * that swallowed the duration.
 */
const OPEN = String.raw`((?:(?!\.(?: |$)|,|\(| and [+\-x]\d| for | when | while | stacks up to| max \d| cooldown| capped at).)+)`;
const QUALS: readonly Qual[] = [
  { re: new RegExp(String.raw`when (Aiming|Crouching|Airborne|Holstered|Sliding|Blocking|Falling|knocked down|inside the Marked Zone|no enemies within ${N}m|targeting Warframe|Shields are above ${N}%)${B}`, 'iy'), apply: cond },
  { re: new RegExp(String.raw`while (Aim Gliding|Airborne|Blocking|Channeling|Invisible|Dodging|Hacking|${N}% Hull|over ${N}% Shields)${B}`, 'iy'), apply: cond },
  { re: new RegExp(String.raw`during (Bleedout|Bullet Jump|Breach)${B}`, 'iy'), apply: cond },
  { re: new RegExp(String.raw`on (Heavy Attack|Slide Attack|Bullet Jump|Block|first shot in Magazine|Lifted enemies|Self|Shotguns|Nikanas|Jump Kick|Stun)${B}`, 'iy'), apply: cond },
  { re: new RegExp(String.raw`for (Secondary Weapons?|Slide Attack|Tennokai attacks)${B}`, 'iy'), apply: cond },
  { re: new RegExp(String.raw`for your \d+(?:st|nd|rd|th) Ability${B}`, 'iy'), apply: cond },
  { re: new RegExp(String.raw`for every ${N} Health${B}`, 'iy'), apply: (m, d) => void (d.threshold = toNumber(m[1] ?? '')) },
  { re: new RegExp(String.raw`for ${N}s${B}`, 'iy'), apply: (m, d) => void (d.duration = toNumber(m[1] ?? '')) },
  { re: new RegExp(String.raw`per ${OPEN}`, 'iy'), apply: (m, d) => void (d.scalingBasis = (m[1] ?? '').trim()) },
  { re: new RegExp(String.raw`against ${OPEN}`, 'iy'), apply: cond },
  { re: new RegExp(String.raw`after ${OPEN}`, 'iy'), apply: cond },
  { re: new RegExp(String.raw`if ${N} pellets${B}`, 'iy'), apply: (m, d) => void (d.threshold = toNumber(m[1] ?? '')) },
  { re: new RegExp(String.raw`if ${OPEN}`, 'iy'), apply: cond },
  { re: new RegExp(String.raw`stacks with Combo Multiplier${B}`, 'iy'), apply: cond },
  { re: new RegExp(String.raw`Stacks up to ${N}(?:x|%| times)${B}`, 'iy'), apply: (m, d) => void (d.stackCap = toNumber(m[1] ?? '')) },
  { re: new RegExp(String.raw`Max ${N} stacks${B}`, 'iy'), apply: (m, d) => void (d.stackCap = toNumber(m[1] ?? '')) },
  { re: new RegExp(String.raw`Capped at ${N}%${B}`, 'iy'), apply: (m, d) => void (d.stackCap = toNumber(m[1] ?? '')) },
  { re: new RegExp(String.raw`up to ${N}%${B}`, 'iy'), apply: (m, d) => void (d.stackCap = toNumber(m[1] ?? '')) },
  { re: new RegExp(String.raw`Cooldown: ${N}s${B}`, 'iy'), apply: (m, d) => void (d.cooldown = toNumber(m[1] ?? '')) },
  { re: new RegExp(String.raw`${N}s cooldown${B}`, 'iy'), apply: (m, d) => void (d.cooldown = toNumber(m[1] ?? '')) },
  { re: new RegExp(String.raw`every ${N}s${B}`, 'iy'), apply: (m, d) => void (d.cooldown = toNumber(m[1] ?? '')) },
  { re: new RegExp(String.raw`within ${N}m${B}`, 'iy'), apply: cond },
  { re: new RegExp(String.raw`${N}m radius${B}`, 'iy'), apply: cond },
  { re: new RegExp(String.raw`in a ${N}m${B}`, 'iy'), apply: cond },
  { re: new RegExp(String.raw`below ${N}${B}`, 'iy'), apply: (m, d) => void (d.threshold = toNumber(m[1] ?? '')) },
  { re: new RegExp(String.raw`over ${N}m${B}`, 'iy'), apply: (m, d) => void (d.threshold = toNumber(m[1] ?? '')) },
  { re: new RegExp(String.raw`Magazine ${N} or higher${B}`, 'iy'), apply: (m, d) => void (d.threshold = toNumber(m[1] ?? '')) },
  { re: new RegExp(String.raw`next ${N} shots${B}`, 'iy'), apply: cond },
  { re: new RegExp(String.raw`${N} or more enemies${B}`, 'iy'), apply: cond },
];

/** Parentheticals R3 knows. Anything else in parentheses refuses the line. */
function applyParenthetical(inner: string, d: Draft): string | null {
  let m = new RegExp(String.raw`^x(\d+(?:\.\d+)?) for (Bows|Heavy Attacks)$`, 'i').exec(inner);
  if (m) {
    d.altMultiplier = { value: Number(m[1]), context: m[2] ?? '' };
    return null;
  }
  m = new RegExp(String.raw`^(${NUM_SRC})% Enemy Max Health$`).exec(inner);
  if (m) {
    d.notes.push(`EnemyMaxHealthPct=${m[1] ?? ''}`);
    return null;
  }
  m = new RegExp(String.raw`^(?:Maximum (${NUM_SRC}) stacks|Max stacks (${NUM_SRC}))$`, 'i').exec(inner);
  if (m) {
    d.stackCap = toNumber(m[1] ?? m[2] ?? '');
    return null;
  }
  m = new RegExp(String.raw`^cooldown (${NUM_SRC})s$`, 'i').exec(inner);
  if (m) {
    d.cooldown = toNumber(m[1] ?? '');
    return null;
  }
  if (/^(Use with Caution|Disables Punch Through|In Space|Non-AOE Bows)$/i.test(inner)) {
    d.notes.push(`(${inner})`);
    return null;
  }
  return `unknown parenthetical "(${inner})"`;
}

/**
 * Trailing sentences after `. ` - a parameter phrase the grammar knows, a known
 * parenthetical, or a note kept verbatim. The magnitude of the line is already
 * fixed by now, so a number in a note can never become the value.
 */
function applyTrailers(rest: string, d: Draft): string | null {
  for (const sentence of rest.split(/\. (?=\S)|(?<=\.) (?=\()/).map((s) => s.trim()).filter((s) => s.length > 0)) {
    const paren = /^\((.*)\)\.?$/.exec(sentence);
    if (paren) {
      const err = applyParenthetical(paren[1] ?? '', d);
      if (err !== null) return err;
      continue;
    }
    const c = new Cursor(sentence);
    let matched = false;
    for (const q of QUALS) {
      const m = c.at(q.re);
      if (m && (c.done() || c.at(/\.$/y))) {
        q.apply(m, d);
        matched = true;
        break;
      }
      c.i = 0;
    }
    if (!matched) d.notes.push(sentence.endsWith('.') ? sentence : `${sentence}.`);
  }
  return null;
}

class Cursor {
  i = 0;
  readonly s: string;
  constructor(s: string) {
    this.s = s;
  }
  at(re: RegExp): RegExpExecArray | null {
    re.lastIndex = this.i;
    const m = re.exec(this.s);
    if (m) this.i += m[0].length;
    return m;
  }
  skipSpaces(): void {
    while (this.s[this.i] === ' ') this.i++;
  }
  done(): boolean {
    return this.i >= this.s.length;
  }
  peek(): string {
    return this.s[this.i] ?? '';
  }
  rest(): string {
    return this.s.slice(this.i);
  }
}

interface Magnitude {
  value: number;
  op: 'add_pct' | 'add_flat' | 'multiply';
  unit: Effect['unit'];
  signed: boolean;
}

interface Clause {
  mag: Magnitude;
  name: string;
  draft: Draft;
}

type LineResult = { effects: Effect[] } | { rule: string; reason: string };

/**
 * Split a distributive NAME (`Critical Chance and Damage`, `Aim Glide/Wall
 * Latch Duration`, `Viral and Magnetic Damage and Status Chance`) into full
 * stat names. English elides the shared words: a conjunct shorter than its
 * neighbour, whose last word differs from the neighbour's, borrows what it is
 * missing - the head from a left neighbour ("Critical" + "Damage"), the tail
 * from a right neighbour ("Viral" + "Damage"). "Speed and Boost Speed" share a
 * last word and are both complete. The rule is deterministic and asserted on
 * the real lines in the gate; it is not a vocabulary.
 */
function expandConjuncts(name: string): string[] {
  const parts = name.split(/ and |\//).map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length < 2) return [name];
  const words = parts.map((p) => p.split(' '));
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? [];
    const last = w[w.length - 1] ?? '';
    const right = i + 1 < words.length ? words[i + 1] : undefined;
    const left = i > 0 ? words[i - 1] : undefined;
    if (right && w.length < right.length && last.toLowerCase() !== (right[right.length - 1] ?? '').toLowerCase()) {
      out.push([...w, ...right.slice(w.length)].join(' '));
    } else if (!right && left && w.length < left.length && last.toLowerCase() !== (left[left.length - 1] ?? '').toLowerCase()) {
      out.push([...left.slice(0, left.length - w.length), ...w].join(' '));
    } else {
      out.push(w.join(' '));
    }
  }
  return out;
}

/** The canonical key: case-folded, `@Type` -> type name, leading `to` dropped. */
function statKey(name: string): { stat: string; damageType?: string } {
  const types = name.match(/@[A-Za-z]+/g) ?? [];
  const stat = name.replace(/^to /, '').replace(/@/g, '').toLowerCase().trim();
  const first = types[0];
  return first === undefined ? { stat } : { stat, damageType: first.slice(1) };
}

/**
 * R3 on one clause of a line: `MAG NAME QUAL* NOTE?`. Returns the clause, or the
 * reason it could not be one. The cursor is left after everything consumed.
 */
function parseClause(c: Cursor, mag: Magnitude): Clause | { reason: string } {
  const draft: Draft = { conditions: [], notes: [] };
  const nameWords: string[] = [];
  let nameClosed = false;
  let sawComma = false;
  while (true) {
    c.skipSpaces();
    if (c.done()) break;
    const ch = c.peek();
    if (ch === '.') {
      c.i++;
      c.skipSpaces();
      if (!c.done()) {
        const err = applyTrailers(c.rest(), draft);
        if (err !== null) return { reason: err };
        c.i = c.s.length;
      }
      break;
    }
    if (ch === ',') {
      c.i++;
      sawComma = true;
      continue;
    }
    if (ch === '(') {
      const close = c.s.indexOf(')', c.i);
      if (close < 0) return { reason: 'unbalanced parenthesis' };
      const err = applyParenthetical(c.s.slice(c.i + 1, close), draft);
      if (err !== null) return { reason: err };
      c.i = close + 1;
      nameClosed = true;
      continue;
    }
    if (c.at(AND_NEXT)) {
      c.i -= 4;
      break;
    }
    let matched = false;
    for (const q of QUALS) {
      const m = c.at(q.re);
      if (m) {
        q.apply(m, draft);
        matched = true;
        nameClosed = true;
        break;
      }
    }
    if (matched) {
      sawComma = false;
      continue;
    }
    if (sawComma) return { reason: `unknown text after comma: "${c.rest()}"` };
    const term = c.at(TERMINATOR);
    if (term) return { reason: `unknown qualifier: "${c.s.slice(term.index)}"` };
    const num = c.at(new RegExp(String.raw`${NUM_SRC}[A-Za-z%/]*`, 'y'));
    if (num) return { reason: `number "${num[0]}" inside the name is not a known parameter` };
    const word = c.at(NAME_WORD);
    if (!word) return { reason: `unexpected character "${ch}"` };
    if (nameClosed) return { reason: `unknown qualifier: "${word[0]}${c.rest()}"` };
    nameWords.push(word[0]);
  }
  if (nameWords.length === 0) return { reason: 'a magnitude with no stat name' };
  return { mag, name: nameWords.join(' '), draft };
}

function readMagnitude(c: Cursor, verbSign: 1 | -1 | null): Magnitude | null {
  let m = c.at(SIGNED_MAG);
  if (m) {
    const value = toNumber((m[1] ?? '') + (m[2] ?? ''));
    const unit = m[3];
    if (unit === '%') return { value, op: 'add_pct', unit: '%', signed: true };
    if (unit === 'm' || unit === 's' || unit === '/s') return { value, op: 'add_flat', unit, signed: true };
    return { value, op: 'add_flat', unit: 'flat', signed: true };
  }
  m = c.at(MULT);
  if (m) return { value: Number(m[1]), op: 'multiply', unit: null, signed: true };
  if (verbSign !== null) {
    // B7(b): after a subject verb an unsigned number is a magnitude only with `%`.
    m = c.at(UNSIGNED_PCT);
    if (m) return { value: verbSign * toNumber(m[1] ?? ''), op: 'add_pct', unit: '%', signed: false };
  }
  return null;
}

/**
 * R7. Fixed prose templates, matched exactly (only the numbers and the spec's
 * own alternations vary). Each was checked to occur verbatim in the export.
 */
interface Template {
  re: RegExp;
  build: (m: RegExpExecArray) => Array<Partial<Effect> & { stat: string; op: Effect['op'] }>;
}
const T = (src: string): RegExp => new RegExp(`^${src}$`);
const TEMPLATES: readonly Template[] = [
  { re: T(String.raw`Converts (Primary|Secondary) ammo pickups to ${N}% of Ammo Pick Up\.`), build: (m) => [{ op: 'template:ammoMutation', stat: 'ammo mutation', value: toNumber(m[2] ?? ''), unit: '%', notes: [`source=${m[1] ?? ''}`] }] },
  { re: T(String.raw`Reduced damage by ${N}% while airborne`), build: (m) => [{ op: 'template:damageReduction', stat: 'damage reduction', value: toNumber(m[1] ?? ''), unit: '%', conditions: ['while airborne'] }] },
  { re: T(String.raw`Convert ${N}% of Damage on Health to Energy\. Without Shields, ally Overguard imitates Health\.`), build: (m) => [{ op: 'template:rage', stat: 'rage', value: toNumber(m[1] ?? ''), unit: '%', notes: ['Without Shields, ally Overguard imitates Health.'] }] },
  { re: T(String.raw`Health pickups give ${N}% Energy\. Energy pickups give ${N}% Health\.`), build: (m) => [{ op: 'template:equilibrium', stat: 'energy from health pickups', value: toNumber(m[1] ?? ''), unit: '%' }, { op: 'template:equilibrium', stat: 'health from energy pickups', value: toNumber(m[2] ?? ''), unit: '%' }] },
  { re: T(String.raw`Reduces the chance an enemy will hear gunfire by ${N}%\.`), build: (m) => [{ op: 'template:noise', stat: 'noise', value: toNumber(m[1] ?? ''), unit: '%' }] },
  { re: T(String.raw`Drains Energy to stop Lethal Damage with ${N}% Efficiency\.`), build: (m) => [{ op: 'template:quickThinking', stat: 'quick thinking', value: toNumber(m[1] ?? ''), unit: '%' }] },
  { re: T(String.raw`${N} '(Truth|Purity|Justice|Entropy|Sequence|Blight)'`), build: (m) => [{ op: 'template:syndicateCounter', stat: (m[2] ?? '').toLowerCase(), value: toNumber(m[1] ?? ''), unit: 'flat' }] },
  { re: T(String.raw`${N}(%|m) bonus for each Mod from a unique School`), build: (m) => [{ op: 'template:perSchoolMod', stat: 'bonus', value: toNumber(m[1] ?? ''), unit: m[2] === '%' ? '%' : 'm', scalingBasis: 'each Mod from a unique School' }] },
  { re: T(String.raw`${N}(%?) (.+?) for each <(MADURAI|NARAMON|ZENURIK|VAZARIN|UNAIRU)_CLEAN>[A-Za-z]+ School Mod`), build: (m) => [{ op: 'template:perSchoolMod', stat: (m[3] ?? '').toLowerCase(), value: toNumber(m[1] ?? ''), unit: m[2] === '%' ? '%' : 'flat', scalingBasis: `each ${m[4] ?? ''} School Mod` }] },
  { re: T(String.raw`Create ${N}m seismic shockwaves from heavy landings, dealing ${N} Damage and knocking foes off their feet\.`), build: (m) => [{ op: 'template:heavyImpact', stat: 'heavy impact', value: toNumber(m[2] ?? ''), unit: 'flat', notes: [`radius=${m[1] ?? ''}m`] }] },
  { re: T(String.raw`Converts ${N}% of Energy used to up to ${N} Bonus Damage on next Melee Attack\.`), build: (m) => [{ op: 'template:energyChannel', stat: 'energy channel', value: toNumber(m[1] ?? ''), unit: '%', notes: [`maxBonusDamage=${m[2] ?? ''}`] }] },
  { re: T(String.raw`Sentinel recovery time reduced by ${N}s\. Revives with ${N}s of invulnerability\.`), build: (m) => [{ op: 'template:regen', stat: 'regen', value: toNumber(m[1] ?? ''), unit: 's', notes: [`recoveryTimeReducedBy=${m[1] ?? ''}s`, `invulnerability=${m[2] ?? ''}s`] }] },
  { re: T(String.raw`Enemies killed explode, dealing ${N} Damage shortly after death\.`), build: (m) => [{ op: 'template:onDeathExplosion', stat: 'on-death explosion', value: toNumber(m[1] ?? ''), unit: 'flat' }] },
  { re: T(String.raw`Enemies explode on death, dealing ${N} @([A-Za-z]+) Damage \(${N}% Enemy Max Health\) in a ${N}m radius\.`), build: (m) => [{ op: 'template:onDeathExplosion', stat: 'on-death explosion', value: toNumber(m[1] ?? ''), unit: 'flat', damageType: m[2] ?? '', notes: [`EnemyMaxHealthPct=${m[3] ?? ''}`, `radius=${m[4] ?? ''}m`] }] },
  { re: T(String.raw`@Impact Status Effects have ${N}% chance to apply a @([A-Za-z]+) Status Effect \(x(\d+(?:\.\d+)?) when Fire Rate is below ${N}\)`), build: (m) => [{ op: 'procConversion', stat: 'impact status to status', value: toNumber(m[1] ?? ''), unit: '%', damageType: m[2] ?? '', altMultiplier: { value: Number(m[3]), context: 'when Fire Rate is below ' + (m[4] ?? '') }, threshold: toNumber(m[4] ?? '') }] },
];
/** R7: `Enables Tennokai.` is a PREFIX - the template, then R9 on whatever follows it. */
const TENNOKAI = /^Enables Tennokai\.\s*/;

/** R5. The only two leading-unsigned forms; every other digit-leading line is refused. */
const R5_CONVERT = T(String.raw`${N}% of Damage converted into @([A-Za-z]+)`);
const R5_GATHER = T(String.raw`${N}m Companion Gather-Link\.(.*)`);

/**
 * R5b. A leading unsigned PERCENT is a delta only when a Title-Case stat name
 * follows it immediately - "25% Reload Speed while Aim Gliding", "25% Critical
 * and Status Chance for 1s after landing ...".
 *
 * The tell that separates those from the rest of the digit-leading lines is
 * lower case. Prose says "25% chance to apply ...", "5% Damage taken is
 * returned to the attacker", "40% Energy spent on abilities is converted to
 * Shields" - the verb, the "of" and the "chance to" are all lower-case words
 * inside what would otherwise be the stat name, and a real stat name in this
 * export is Title Case throughout except for the distributive `and`. The
 * unit must be `%`: an unsigned flat number is "25 health stolen each hit",
 * a rate or a count as often as a magnitude (B7(b) draws the same line after
 * a subject verb).
 *
 * A match is rewritten to the canonical `+N% ...` form and re-parsed, so the
 * whole of R3/R4 applies unchanged: an unknown qualifier still refuses the
 * line rather than keeping the head, and a conditional line still carries its
 * condition. Nothing that parses today reaches this rule - it is only tried
 * where the old code returned the R5 refusal.
 */
const TITLE_RUN = String.raw`(?:@?[A-Z][A-Za-z'&\-/]*|and)(?:[ /](?:@?[A-Z][A-Za-z'&\-/]*|and))*`;
/**
 * The run must reach a qualifier, a punctuation or the end of the line. Testing
 * only the FIRST word is not enough and was the first version's bug: "5% Damage
 * taken is returned to the attacker" opens on a Title-Case "Damage" and would
 * have been emitted as a +5% `damage taken is returned to the attacker`.
 */
const R5B_TITLE_NAME = new RegExp(
  String.raw`^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?% ${TITLE_RUN}(?=$|[.,)]| (?:when|while|during|on|for|per|against|after|if|stacks|within|every|capped|below|next|up)\b| \()`,
);

/**
 * R9b. The one verb-signed shape that is a stat delta and not a sentence:
 * `Increase[s]|Reduce[s] <name> by <magnitude>` and NOTHING else on the line.
 *
 * The trailing text is where this family goes wrong, so there is none allowed.
 * "Increase Max Armor by +11% of Warframe's Armor" is not +11% Max Armor - the
 * magnitude is a fraction of a DIFFERENT unit's stat; "Increases Ammo Capacity
 * by 5% and converts Ammo Pickups into ammo ..." carries a second mechanic;
 * "Reduces damage by 75% while hacking" is damage TAKEN, which is not the
 * `damage` an optimiser scores. Every one of those has text after the
 * magnitude, and refusing on any tail at all costs a handful of conditional
 * effects the optimiser would not score anyway and buys the guarantee that the
 * magnitude belongs to the name in front of it.
 *
 * Sign: the verb supplies it for an unsigned number, and a DISPLAYED sign that
 * the verb does not agree with refuses the line - "Reduce X by +30" cannot be
 * told apart from a display convention, and guessing it is how a mod's
 * drawback becomes a bonus.
 */
const R9B = new RegExp(String.raw`^(Increases?|Reduces?) ([A-Za-z@'&\- /]+) by ([+-]?)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(%|/s|m|s)?\.?$`);

/** R8. Absolute set-to. */
const R8 = new RegExp(String.raw`(?<!\bup |Damage |Health |Energy |ammo pickups )\b(?:to|at) ${NUM_SRC}(?:%|s|m)?\b|\breduced to\b|\bset to\b|\bIncrease\b.*\bto ${NUM_SRC}|^0 `, 'i');

/** R9 sub-classification, for the histogram; all of it refuses. */
function classifyProse(line: string): { rule: string; reason: string } {
  if (AUGMENT_HEAD.test(line)) return { rule: 'R9', reason: 'augment prose' };
  if (/\b(twice|double|doubled|half|fourth)\b/.test(line) || new RegExp(String.raw`\b${NUM_SRC} to ${NUM_SRC}\b`).test(line)) return { rule: 'R9', reason: 'word-number or range' };
  if (/^Each (hit|kill)|\bCapped at\b/i.test(line)) return { rule: 'R9', reason: 'running total' };
  if (R8.test(line)) return { rule: 'R8', reason: 'set-to, not a delta' };
  if (/\b(increases?|reduced?|reduces|less|more|faster|decreases?)\b/i.test(line)) return { rule: 'R9', reason: 'verb-signed prose' };
  return { rule: 'R9', reason: 'prose' };
}

function build(base: Pick<Effect, 'rank' | 'element' | 'text'>, e: Partial<Effect> & { stat: string; op: Effect['op'] }): Effect {
  return {
    rank: base.rank,
    element: base.element,
    stat: e.stat,
    op: e.op,
    value: e.value ?? null,
    unit: e.unit ?? null,
    ...(e.damageType !== undefined ? { damageType: e.damageType } : {}),
    ...(e.faction !== undefined ? { faction: e.faction } : {}),
    target: e.target ?? 'self',
    conditions: e.conditions ?? [],
    ...(e.duration !== undefined ? { duration: e.duration } : {}),
    ...(e.stackCap !== undefined ? { stackCap: e.stackCap } : {}),
    ...(e.cooldown !== undefined ? { cooldown: e.cooldown } : {}),
    ...(e.threshold !== undefined ? { threshold: e.threshold } : {}),
    ...(e.scalingBasis !== undefined ? { scalingBasis: e.scalingBasis } : {}),
    ...(e.altMultiplier !== undefined ? { altMultiplier: e.altMultiplier } : {}),
    notes: e.notes ?? [],
    text: base.text,
  };
}

/**
 * One body line (a trigger head already stripped, its condition in `trigger`).
 * Rule order per Part C: R7 exact templates, R0 refuse-first, R9 pre-checks
 * that no structure can rescue, then R2/R3, then R5, then R8/R9 classification.
 */
function parseBodyLine(raw: string, base: Pick<Effect, 'rank' | 'element' | 'text'>, trigger: string | null): LineResult {
  const line = foldDamageTypes(raw);
  const triggerConds = trigger === null ? [] : [trigger];

  for (const t of TEMPLATES) {
    const m = t.re.exec(line);
    if (m) return { effects: t.build(m).map((e) => build(base, { ...e, conditions: [...triggerConds, ...(e.conditions ?? [])] })) };
  }

  if (PLACEHOLDER.test(line)) return { rule: 'R0', reason: 'placeholder' };
  if (ICON_TAG.test(line)) return { rule: 'R0', reason: 'icon/keybind tag' };
  const strayTag = (line.match(ANY_TAG) ?? []).filter((t) => !SCHOOL_TAG.test(t));
  if (strayTag.length > 0) return { rule: 'R0', reason: `unknown tag ${strayTag[0] ?? ''}` };
  if (numbersIn(line).length === 0) return { rule: 'R0', reason: 'no number' };
  if (AUGMENT_HEAD.test(line)) return { rule: 'R9', reason: 'augment prose' };
  if (/\b(twice|double|doubled|half|fourth)\b/.test(line) || new RegExp(String.raw`\b${NUM_SRC} to ${NUM_SRC}\b`).test(line)) return { rule: 'R9', reason: 'word-number or range' };

  // R2 subject prefix.
  const c = new Cursor(line);
  let target: Effect['target'] = 'self';
  let faction: string | undefined;
  let verbSign: 1 | -1 | null = null;
  let verb: string | undefined;
  const sm = c.at(new RegExp(SUBJECT.source, 'y'));
  if (sm) {
    const who = sm[1] ?? sm[3] ?? sm[5] ?? sm[7] ?? sm[9] ?? sm[11] ?? sm[13] ?? '';
    verb = sm[2] ?? sm[4] ?? sm[6] ?? sm[8] ?? sm[10] ?? sm[12] ?? sm[14] ?? '';
    if (who === "Squad's Companions") target = 'companion';
    else if (who === 'Squad' || who === 'Squadmates') target = 'squad';
    else if (who.startsWith('Enem')) {
      target = 'enemy';
      const f = who.replace('Enemy ', '');
      if (f !== 'Enemies') faction = f;
    }
    verbSign = verb === 'lose' ? -1 : verb === 'takes' ? null : 1;
  }

  // R3 clauses.
  const clauses: Clause[] = [];
  let unsignedAfterSubject = false;
  while (true) {
    c.skipSpaces();
    const mag = readMagnitude(c, verbSign);
    if (mag === null) {
      if (sm && verb === 'takes' && c.at(UNSIGNED_PCT)) return { rule: 'R2', reason: 'double verb (takes + unsigned)' };
      break;
    }
    if (!mag.signed) unsignedAfterSubject = true;
    c.skipSpaces();
    const clause = parseClause(c, mag);
    if ('reason' in clause) return { rule: 'R4', reason: clause.reason };
    clauses.push(clause);
    c.skipSpaces();
    if (c.at(AND_NEXT)) continue;
    break;
  }
  if (clauses.length > 0) {
    if (!c.done()) return { rule: 'R4', reason: `unknown qualifier: "${c.rest()}"` };
    if (sm && unsignedAfterSubject && verbSign === null) return { rule: 'R2', reason: 'double verb' };
    // Qualifiers written once at the end of the line belong to every clause on it.
    const last = clauses[clauses.length - 1];
    const tail = last?.draft;
    const effects: Effect[] = [];
    for (const cl of clauses) {
      const { draft, mag } = cl;
      const d = cl === last || tail === undefined ? draft : { ...tail, ...draft, conditions: [...draft.conditions, ...tail.conditions], notes: [...draft.notes, ...tail.notes] };
      // MULT NAME (to|vs) FACTION -> multiply with faction.
      let name = cl.name;
      let clauseFaction = faction;
      if (mag.op === 'multiply') {
        const fm = new RegExp(String.raw` (?:to|vs) (${FACTIONS.join('|')})$`).exec(name);
        if (fm) {
          clauseFaction = fm[1];
          name = name.slice(0, fm.index);
        }
      }
      // `Energy Regen/s` is a per-second unit on the whole name. It comes off
      // BEFORE the distributive split, or the slash reads as "Energy Regen and s".
      let unit = mag.unit;
      const perSec = /(.*\S)\/(s|sec)$/.exec(name);
      if (perSec && mag.op === 'add_flat') {
        name = perSec[1] ?? name;
        unit = '/s';
      }
      for (const cj of expandConjuncts(name)) {
        const key = statKey(cj);
        let stat = key.stat;
        const onBulletJump = d.conditions.some((x) => /^on Bullet Jump$/i.test(x));
        if (key.damageType !== undefined && /^@[A-Za-z]+$/.test(cj)) stat = onBulletJump ? 'parkour proc' : `${key.damageType.toLowerCase()} damage`;
        if (DEAD_STATS.has(stat)) return { rule: 'E', reason: `dead mechanic "${stat}"` };
        effects.push(
          build(base, {
            stat,
            op: mag.op,
            value: mag.value,
            unit,
            damageType: key.damageType,
            faction: clauseFaction,
            target,
            conditions: [...triggerConds, ...d.conditions],
            duration: d.duration,
            stackCap: d.stackCap,
            cooldown: d.cooldown,
            threshold: d.threshold,
            scalingBasis: d.scalingBasis,
            altMultiplier: d.altMultiplier,
            notes: d.notes,
          }),
        );
      }
    }
    return { effects };
  }
  if (sm) return classifyProse(line);

  // R5.
  let m = R5_CONVERT.exec(line);
  if (m) return { effects: [build(base, { op: 'convert', stat: 'damage converted', value: toNumber(m[1] ?? ''), unit: '%', damageType: m[2] ?? '', conditions: triggerConds })] };
  m = R5_GATHER.exec(line);
  if (m) return { effects: [build(base, { op: 'add_flat', stat: 'companion gather-link', value: toNumber(m[1] ?? ''), unit: 'm', conditions: triggerConds, notes: [(m[2] ?? '').trim()].filter((s) => s.length > 0) })] };
  if (/^\d/.test(line)) {
    // R5b. `+` the line and let R3/R4 judge the rest; `raw` is re-folded on the
    // way in, which is idempotent, and `base.text` stays the line as exported.
    if (R5B_TITLE_NAME.test(line)) return parseBodyLine(`+${raw}`, base, trigger);
    return { rule: 'R5', reason: 'leading unsigned number: set, chance or "of" as often as +' };
  }

  // R9b. Before classifyProse, because it is a subset of what R9 calls
  // verb-signed prose - but never before R8, which owns "Increase ... to N".
  const vb = R9B.exec(line);
  if (vb && !R8.test(line)) {
    const up = (vb[1] ?? '').startsWith('Increase');
    const shown = vb[3] ?? '';
    if (shown === '' || (up && shown === '+')) {
      const unit = vb[5] ?? '';
      return parseBodyLine(`${up ? '+' : '-'}${vb[4] ?? ''}${unit} ${vb[2] ?? ''}`, base, trigger);
    }
    return { rule: 'R9', reason: `verb "${vb[1] ?? ''}" disagrees with the displayed sign "${shown}"` };
  }

  return classifyProse(line);
}

/**
 * One element (one string of `levelStats[rank].stats`, after R6 joining). Its
 * LINE-separated lines are walked once: a trigger head opens a block whose
 * body lines inherit the trigger as a condition (Galvanized Scope has two
 * blocks in one element), `Cooldown: Ns` on its own line attaches to the
 * element's effects, everything else is a body line.
 */
function parseElement(text: string, rank: number, element: number, effects: Effect[], refused: Refused[]): void {
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    // R6 at line level too: "(Non-AOE Bows)" on its own line belongs to the line above.
    if (lines.length > 0 && /^(and |if |in a |\()/.test(line)) lines[lines.length - 1] += ` ${line}`;
    else lines.push(line);
  }
  let trigger: string | null = null;
  let blockStackCap: number | undefined;
  const mine: Effect[] = [];
  const refuse = (line: string, rule: string, reason: string): void => {
    refused.push({ rank, element, rule, reason, text: line, numbersFound: numbersIn(line) });
  };
  const bodyLine = (raw: string): void => {
    let line = raw;
    const tk = TENNOKAI.exec(line);
    if (tk) {
      mine.push(build({ rank, element, text: raw }, { op: 'template:tennokai', stat: 'tennokai', value: null, unit: null, conditions: trigger === null ? [] : [trigger] }));
      line = line.slice(tk[0].length);
      if (line.length === 0) return;
    }
    const r = parseBodyLine(line, { rank, element, text: line }, trigger);
    if ('rule' in r) {
      refuse(line, r.rule, r.reason);
      if (r.rule === 'R0' && r.reason === 'no number') {
        mine.push(build({ rank, element, text: line }, { op: 'unparsed', stat: 'unparsed', value: null, unit: null, conditions: trigger === null ? [] : [trigger] }));
      }
      return;
    }
    for (const e of r.effects) {
      if (blockStackCap !== undefined && e.stackCap === undefined) e.stackCap = blockStackCap;
      mine.push(e);
    }
  };
  for (const line of lines) {
    const cd = new RegExp(String.raw`^Cooldown: (${NUM_SRC})s$`).exec(line);
    if (cd) {
      if (mine.length === 0) refuse(line, 'R4', 'a cooldown with no effect to attach to');
      else for (const e of mine) if (e.cooldown === undefined) e.cooldown = toNumber(cd[1] ?? '');
      continue;
    }
    // A head is short and carries no magnitude; a prose sentence with a colon in
    // its middle ("... for easier targeting. Cooldown: 15s.") is a body line.
    const head = /^([^:.]{1,60}):(?: (.*))?$/.exec(line);
    if (head && !/\d[%x]|[+-]\d/.test(head[1] ?? '') && (head[1] ?? '').split(' ').length <= 8) {
      const headText = head[1] ?? '';
      if (AUGMENT_HEAD.test(line)) {
        refuse(line, 'R9', 'augment prose');
        continue;
      }
      const key = shape(foldDamageTypes(headText)).toLowerCase();
      if (!TRIGGER_HEADS.has(key) && !TRIGGER_HEAD_DTYPE.test(key)) {
        refuse(line, 'R1', `unknown trigger head "${headText}"`);
        continue;
      }
      trigger = headText;
      const ms = /\(Max stacks (\d+)\)/.exec(headText);
      blockStackCap = ms ? Number(ms[1]) : undefined;
      const body = head[2];
      if (body !== undefined && body.length > 0) bodyLine(body);
      continue;
    }
    bodyLine(line);
  }
  effects.push(...mine);
}

/** A7. The row description as a condition or restriction on every effect. */
const A7_TRIGGERS = new Set(['On Hit:', 'When Aiming:', 'On Respawn:', 'With Melee Equipped:', 'On Directional Dismount:', 'On Ability Cast:']);
const A7_RESTRICTION = /cannot be modified|Only compatible with/;

export function parseModStats(input: ModStatsInput): { effects: Effect[]; refused: Refused[]; corrupt: string | null } {
  const ranks = input.levelStats.map((elements) => elements.map(prepass));

  // A6. The digits->N shape of element i must be the same at every rank, and
  // every rank must have the same number of elements.
  const width = Math.max(0, ...ranks.map((r) => r.length));
  for (let i = 0; i < width; i++) {
    const shapes = ranks.map((r) => (i < r.length ? shape(r[i] ?? '') : '<absent>'));
    const first = shapes[0];
    const bad = shapes.findIndex((s) => s !== first);
    if (first !== undefined && bad >= 0) {
      return { effects: [], refused: [], corrupt: `${input.name} (${input.uniqueName}): element ${String(i)} changes shape between rank 0 and rank ${String(bad)}: ${JSON.stringify(first)} vs ${JSON.stringify(shapes[bad])}` };
    }
  }

  const effects: Effect[] = [];
  const refused: Refused[] = [];
  ranks.forEach((elements, rank) => {
    // R6. An element that begins with a continuation word joins the previous element.
    const joined: Array<{ text: string; element: number }> = [];
    elements.forEach((text, element) => {
      const prev = joined[joined.length - 1];
      if (prev !== undefined && /^(and |if |in a |\()/.test(text)) prev.text += ` ${text}`;
      else joined.push({ text, element });
    });
    for (const j of joined) parseElement(j.text, rank, j.element, effects, refused);
  });

  // R9 + rule "a conditional effect carries its condition". An augment header
  // refuses its OWN line, and that used to be the end of it. Two rows in the
  // export put an ordinary stat line next to one: Piercing Navigator writes
  // "Navigator Augment: ..." then, one LINE later in the same element, "+3
  // Projectile Punch Through."; Swing Line writes "Rip Line Augment: ..." in
  // element 0 and "+5% Parkour Velocity" in element 1. Both came out
  // unconditional - as if they applied to any frame, which is what an optimiser
  // would then have believed. The header is attached to every effect of the
  // same rank instead.
  // ponytail: rank-wide rather than "effects after the header", because both
  // rows put the header first. Narrow it to line/element order if a row ever
  // carries an effect ahead of its augment line.
  const augmentAt = new Map<number, string>();
  for (const x of refused) {
    if (x.reason !== 'augment prose' || augmentAt.has(x.rank)) continue;
    const h = /^([A-Za-z'&\- ]+ Augment) ?:/.exec(x.text);
    if (h) augmentAt.set(x.rank, h[1] ?? '');
  }
  if (augmentAt.size > 0) for (const e of effects) {
    const a = augmentAt.get(e.rank);
    if (a !== undefined) e.conditions.push(a);
  }

  const description = input.description?.trim() ?? '';
  const extra = A7_TRIGGERS.has(description) ? description.replace(/:$/, '') : A7_RESTRICTION.test(description) ? description : null;
  if (extra !== null) for (const e of effects) e.conditions.push(extra);

  return { effects, refused, corrupt: null };
}
