/**
 * WHAT THE FIFTH ARSENAL ROW IS, LEARNED RATHER THAN GUESSED.
 *
 * `_T.upgradeItemSlot (_Mod): N` is the only line that says which arsenal row
 * the player opened, and this app knows the meaning of four values. The capture
 * behind `docs/research/eelog-upgrade-screen.md` observed **0 and 3** and
 * inferred 1 and 2 from the arsenal's layout; whether a companion, an archwing
 * or a necramech emits a fifth index, and which, has never been seen. That one
 * integer was the whole of what stood between those classes and an overlay
 * that already has a question, an eligibility pool and a resolution path for
 * every one of them.
 *
 * Guessing it is not available. "The rows are probably in arsenal order, so 4
 * is the companion" is exactly the kind of plausible reasoning this app refuses
 * everywhere else, and being wrong would mean planning a Kubrow's build against
 * an Archwing's mods with nothing on screen to say so.
 *
 * BUT IT DOES NOT HAVE TO BE GUESSED, BECAUSE THE PLAYER ANSWERS IT.
 *
 * The moment a mod goes on or comes off, the log names it:
 *
 *   DiegeticUpgradeCards.lua: mod: Link Health - installed: true (/Lotus/Upgrades/Mods/Sentinel/...)
 *
 * and the mod catalogue says what that mod is compatible with - `COMPANION`,
 * `Archwing`, `Archgun`, `Necramech`. A mod cannot be installed on a thing it
 * is not compatible with, so the class of the FIRST mod placed on a screen is
 * the class of the item being modded. That is a deduction from the game's own
 * data, not an inference from the layout.
 *
 * So an unknown index stays unknown until the player touches one card, and from
 * then on it is known - for the rest of the session and, once persisted, for
 * every session after it. The first companion the player mods teaches the app
 * what a companion screen looks like, permanently.
 */
import type { Category } from './build.ts';
import type { UpgradeSlot } from './automod-session.ts';

/**
 * Mod compatibility class to the category that wears it.
 *
 * Every name here is a `compatName` the real catalogue carries, with the count
 * measured off `Mods.json`: `COMPANION` 26 rows, `Archgun` 38, `Necramech` 28,
 * `Archmelee` 20, `Archwing` 12, `ROBOTIC` 11, `BEAST` 10, `Hound` 9, `Moa` 8,
 * `Sentinel` 7, `Kavat` 6.
 *
 * The four arsenal classes are here too. They should never be learned - their
 * indices are known - but a mapping that silently lacked them would make a
 * mis-learn impossible to detect, and `check-automod` asserts that a weapon mod
 * on an unknown screen resolves to the weapon category rather than to nothing.
 */
const CLASS_TO_CATEGORY: Readonly<Record<string, Category>> = {
  // Companions: sentinels, beasts, moas, hounds. One category - the account
  // bins differ but `resolveIn` searches all three of them.
  COMPANION: 'companion',
  ROBOTIC: 'companion',
  BEAST: 'companion',
  Sentinel: 'companion',
  Kavat: 'companion',
  Kubrow: 'companion',
  Moa: 'companion',
  Hound: 'companion',
  'Helminth Charger': 'companion',
  Predasite: 'companion',
  Vulpaphyla: 'companion',
  // The vehicles.
  Archwing: 'archwing',
  Archgun: 'arch-gun',
  Archmelee: 'arch-melee',
  Necramech: 'necramech',
  // The four that are already known, for the reason in the note above.
  WARFRAME: 'warframe',
  Rifle: 'primary',
  Shotgun: 'primary',
  Bow: 'primary',
  Sniper: 'primary',
  PRIMARY: 'primary',
  'Assault Rifle': 'primary',
  Pistol: 'secondary',
  Melee: 'melee',
  Claws: 'melee',
  'Thrown Melee': 'melee',
  Polearms: 'melee',
  Daggers: 'melee',
  'Dual Daggers': 'melee',
  Swords: 'melee',
};

/**
 * The category a mod of this compatibility class belongs to, or null.
 *
 * Null is the common answer and the important one. A per-warframe augment says
 * `Ash`; an operator arcane says `ANY`; a Parazon mod says `Parazon`. None of
 * those identifies an arsenal row - `ANY` in particular would fit anything -
 * and a mapping that reached for a category anyway would be the guess this
 * whole file exists to avoid.
 */
export function categoryForModClass(compatName: string | null | undefined): Category | null {
  if (!compatName) return null;
  return CLASS_TO_CATEGORY[compatName] ?? null;
}

/**
 * What the app has learned about arsenal indices it was not born knowing.
 *
 * Keyed by the raw index the log carried. Small by construction: the arsenal
 * has a dozen rows at most, and only the ones the player actually opens are
 * ever written.
 */
export type LearnedSlots = Readonly<Record<string, Category>>;

const KEY = 'raijiframe-arsenal-slots.v1';

/** Read what previous sessions worked out. Never throws; storage may be absent. */
export function loadLearnedSlots(store: Pick<Storage, 'getItem'> | null | undefined): LearnedSlots {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, Category> = {};
    for (const [index, category] of Object.entries(parsed as Record<string, unknown>)) {
      // Validated on the way IN, not trusted because it was written by us: a
      // stored value outlives the code that wrote it, and a category this build
      // no longer has would reach `WHERE[category]` as undefined.
      // `Object.hasOwn`, not `in`: `in` walks the prototype, so 'toString',
      // 'constructor' and '__proto__' all passed this check and reached
      // `WHERE[category]` as undefined - a TypeError inside `publishAutomod`,
      // on every publish, for the rest of the session. The comment above says
      // this exists to prevent exactly that.
      if (/^\d+$/.test(index) && typeof category === 'string' && Object.hasOwn(CATEGORY_NAMES, category)) {
        out[index] = category as Category;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Remember one index, merged with what is already known. Returns what to publish. */
export function learnSlot(known: LearnedSlots, index: number, category: Category, store: Pick<Storage, 'setItem'> | null | undefined): LearnedSlots {
  if (known[String(index)] === category) return known;
  const next: LearnedSlots = { ...known, [String(index)]: category };
  try {
    store?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage is a nicety here. The session already has the answer in memory.
  }
  return next;
}

/** Every category name, as a set the loader can check a stored string against. */
const CATEGORY_NAMES: Readonly<Record<Category, true>> = {
  warframe: true,
  primary: true,
  secondary: true,
  melee: true,
  companion: true,
  'companion-weapon': true,
  archwing: true,
  'arch-gun': true,
  'arch-melee': true,
  necramech: true,
};

/** The four the arsenal's top row shows, which need no learning. */
export const CATEGORY_BY_SLOT: Readonly<Record<UpgradeSlot, Category>> = {
  0: 'warframe',
  1: 'primary',
  2: 'secondary',
  3: 'melee',
};

/**
 * WHICH CATEGORY THE OPEN SCREEN IS, OR NULL.
 *
 * Two ways to know: the index is one of the four this app was born knowing, or
 * a previous mod placement taught it what this index means.
 *
 * Pure, and in this file rather than in the controller, because the controller
 * cannot be driven from a gate - it imports Overwolf. A first version of this
 * lived there and was asserted about by reading the source for a substring,
 * which is a check that a `false &&` in front of the matched text walks
 * straight past. Behaviour is the only thing worth asserting here.
 */
export function categoryOpen(input: { slot: UpgradeSlot | null; unreadSlot: number | null; learned: LearnedSlots }): Category | null {
  if (input.slot !== null) return CATEGORY_BY_SLOT[input.slot] ?? null;
  if (input.unreadSlot === null) return null;
  return input.learned[String(input.unreadSlot)] ?? null;
}

/**
 * COMPATIBILITY CLASSES THAT NAME EXACTLY ONE ARSENAL ROW.
 *
 * The four weapon classes are deliberately NOT here, and that is the whole
 * point of the set. A sentinel weapon takes ordinary weapon mods - a
 * Deconstructor takes `Melee`, a Sweeper takes `Shotgun`, a Laser Rifle takes
 * `Rifle` - so a player modding their companion's gun on an unread row would
 * have taught this app that the row is `primary`. Permanently, and persisted:
 * from then on every visit to that screen would resolve their Braton and plan
 * it while they were looking at a Deconstructor, with nothing on screen to say
 * so. `companion-weapon` has no compat class that can reach it, so the
 * mis-learn would not even have been recoverable by more modding.
 *
 * `WARFRAME` is out for the same reason in the other direction: a frame is
 * slot 0 and known, so a WARFRAME mod on an UNREAD row means something this app
 * does not understand, and guessing "warframe" would be the guess this file
 * exists to refuse.
 */
const UNAMBIGUOUS: ReadonlySet<string> = new Set([
  'COMPANION',
  'ROBOTIC',
  'BEAST',
  'Sentinel',
  'Kavat',
  'Kubrow',
  'Moa',
  'Hound',
  'Helminth Charger',
  'Predasite',
  'Vulpaphyla',
  'Archwing',
  'Archgun',
  'Archmelee',
  'Necramech',
]);

/**
 * WHAT A MOD PLACEMENT TEACHES, OR NULL.
 *
 * Null in every case but one: the screen has to be an index this app cannot
 * read - there is nothing to learn about the four it can - and the mod's
 * compatibility class has to name exactly one arsenal row, which the four
 * weapon classes do not.
 */
export function lessonFrom(input: { unreadSlot: number | null; compatName: string | null | undefined }): { index: number; category: Category } | null {
  if (input.unreadSlot === null) return null;
  if (!input.compatName || !UNAMBIGUOUS.has(input.compatName)) return null;
  const category = categoryForModClass(input.compatName);
  return category === null ? null : { index: input.unreadSlot, category };
}
