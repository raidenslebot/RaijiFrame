/**
 * Whether you can actually DO a route, checked against what you own.
 *
 * THE GAP THIS CLOSES
 * ───────────────────
 * Every route carried an `alsoNeeds` line - "an Amp, and enough gear to break
 * the shields inside the night window", "a built Railjack, and Holokeys from
 * Void Storms" - and the app never checked a single one of them. It was prose.
 * A player with no Necramech was told to run Isolation Vaults, in a panel that
 * had their whole inventory open in front of it.
 *
 * Worse, the panel DID ask about capability: two sliders for how good your
 * frame and weapons are. Those are a self-reported guess standing in for
 * something the account partly knows for certain. A guess is the right tool for
 * build quality, which no inventory records. It is the wrong tool for "do you
 * own a Necramech", which is a fact.
 *
 * WHAT IS A FACT AND WHAT IS NOT
 * ──────────────────────────────
 * OWNERSHIP is a fact: the equipment arrays either contain a Necramech or they
 * do not. This file checks only facts of that kind.
 *
 * BUILD QUALITY is not. Nothing in an inventory says whether your Amp can
 * actually break an Eidolon's shields, or whether your frame is modded well
 * enough to survive Steel Path. Owning the thing is necessary and not
 * sufficient, so a satisfied requirement is reported as "you own one", never as
 * "you can do this" - and the sliders stay, because they answer the half of the
 * question the account cannot.
 *
 * ABSENT IS NOT ZERO. An account that has never been read knows nothing, and
 * reports `null` for every requirement rather than "you do not have it". The
 * difference matters: one is a fact about you, the other is a fact about us.
 */

import type { RawAccount } from './account.ts';
import type { ItemDb } from './itemdb.ts';

/** A thing you either own or do not, that some routes require. */
/**
 * A thing you either have or do not, that some routes require.
 *
 * Most are equipment and resolve to "is that inventory array non-empty".
 * `steelpath` and `lich` are not equipment and are proved differently, so they
 * are handled explicitly below rather than being forced into that shape.
 */
export type Capability =
  | 'amp'
  | 'necramech'
  | 'railjack'
  | 'archwing'
  | 'companion'
  | 'kdrive'
  | 'steelpath'
  | 'lich';

export const CAPABILITY_LABEL: Record<Capability, string> = {
  amp: 'an Amp',
  necramech: 'a Necramech',
  railjack: 'a Railjack',
  archwing: 'an Archwing',
  companion: 'a companion you can imprint',
  kdrive: 'a K-Drive',
  steelpath: 'Steel Path access',
  lich: 'an active Lich or Sister',
};

/** Which inventory array proves you hold each one. */
const SOURCE: Record<Capability, string> = {
  amp: 'OperatorAmps',
  necramech: 'MechSuits',
  railjack: 'CrewShips',
  archwing: 'SpaceSuits',
  companion: 'KubrowPets',
  kdrive: 'Hoverboards',
  // Not equipment. Resolved explicitly in `owns`.
  steelpath: '',
  lich: '',
};

/**
 * The starter Amp is not an Amp for this purpose.
 *
 * Every player receives the Mote Amp during Vox Solaris, so its presence proves
 * nothing about Eidolon readiness - the guide for that route says as much in
 * words. Counting it would turn "do you have an Amp" into "have you done the
 * introductory quest", which is a different and much less useful question.
 *
 * THE MARKER IS THE PATH DE ACTUALLY USES, which is not what it looks like.
 * This was `/AmpPrism.*Mote|MoteAmp/i` - a guess at a name - and it matched
 * NOTHING. The Mote Amp's three components are
 * `/Lotus/Weapons/Sentients/OperatorAmplifiers/SentTrainingAmplifier/SentAmpTraining{Barrel,Chassis,Grip}`,
 * with no "MoteAmp" anywhere in them, so the exclusion never fired and every
 * player who had finished Vox Solaris was reported as Eidolon-ready. The one
 * route whose own step says "the starter Mote Amp is not enough" was the route
 * getting it wrong. `check-amp-marker.ts` holds this against the live export.
 */
const MOTE_AMP = /\/OperatorAmplifiers\/SentTrainingAmplifier\//i;

/** For the live gate: the substring that identifies the starter's components. */
export const MOTE_AMP_MARKER = 'SentTrainingAmplifier';

export type Owned = boolean | null;

/**
 * Does the account show one of these?
 *
 * `null` when the account has never been read, or does not carry that array at
 * all - absent is not the same as empty, and a panel that says "you have no
 * Railjack" to somebody whose inventory never arrived is stating a fact it does
 * not have.
 */
export function owns(acc: RawAccount | null, capability: Capability): Owned {
  if (!acc) return null;
  const bag = acc as unknown as Record<string, unknown>;

  /*
   * Steel Path is proved by having CLEARED something on it, not by owning a
   * thing. `Missions[].Tier` is documented as truthy for Steel Path, so one
   * such completion settles it. An account with no Missions array at all is
   * unread rather than locked out.
   */
  if (capability === 'steelpath') {
    const missions = bag['Missions'];
    if (!Array.isArray(missions)) return null;
    return missions.some((m) => {
      if (typeof m !== 'object' || m === null) return false;
      const tier = (m as Record<string, unknown>)['Tier'];
      return typeof tier === 'number' && tier > 0;
    });
  }

  /*
   * A Lich is a single object that is present or absent. Absent is a real
   * answer here - most players do not have one at any given moment - but only
   * once we have actually seen an inventory, which `acc` being non-null covers.
   */
  if (capability === 'lich') return bag['Nemesis'] !== undefined && bag['Nemesis'] !== null;

  const key = SOURCE[capability];
  const rows = bag[key];
  if (!Array.isArray(rows)) return null;

  if (capability !== 'amp') return rows.length > 0;

  /*
   * Amps: anything that is not the starter.
   *
   * An amp is MODULAR, so the row's own `ItemType` is not where the identity
   * lives - `ModularParts` carries the prism, scaffold and brace that were
   * built into it (schema §3b). Testing only `ItemType`, as this did, asks a
   * question the row does not answer.
   */
  return rows.some((row) => {
    if (typeof row !== 'object' || row === null) return false;
    const r = row as { ItemType?: unknown; ModularParts?: unknown };
    const parts = Array.isArray(r.ModularParts) ? r.ModularParts.filter((x): x is string => typeof x === 'string') : [];
    const paths = [...(typeof r.ItemType === 'string' ? [r.ItemType] : []), ...parts];
    if (paths.length === 0) return false;
    // Built from any training component at all, it is the starter.
    return !paths.some((path) => MOTE_AMP.test(path));
  });
}

export interface Requirement {
  capability: Capability;
  /** True when owned, false when definitely not, null when unread. */
  met: Owned;
}

/** Check every requirement a route declares. */
export function checkAll(acc: RawAccount | null, needs: readonly Capability[]): Requirement[] {
  return needs.map((capability) => ({ capability, met: owns(acc, capability) }));
}

/**
 * The one-line verdict a row can show.
 *
 * Null when there is nothing to say - either the route needs nothing, or every
 * requirement is met, in which case silence is the correct output. A panel that
 * announces every satisfied condition is noise.
 */
export function blocker(reqs: readonly Requirement[]): string | null {
  const missing = reqs.filter((r) => r.met === false);
  if (missing.length > 0) {
    return `You do not own ${missing.map((r) => CAPABILITY_LABEL[r.capability]).join(' or ')}`;
  }
  const unknown = reqs.filter((r) => r.met === null);
  if (unknown.length > 0) {
    return `Needs ${unknown.map((r) => CAPABILITY_LABEL[r.capability]).join(' and ')} — your account has not been read`;
  }
  return null;
}

/* ---------------------------------------------------------- the loadout */

/**
 * Which warframe to actually bring.
 *
 * "Run Void Fissures" is advice; "run Void Fissures, and bring the Nekros you
 * already own" is an instruction. The difference is the whole of what the
 * player meant by asking how exactly they would do something.
 *
 * These are the frames whose abilities change the OUTPUT of a route, not the
 * ones that merely clear it faster - a stronger frame kills quicker everywhere
 * and is therefore not worth naming. Desecrate produces extra loot rolls;
 * Pilfering Swarm and Pilfering Strangledome do the same; Ivara steals from
 * enemies before killing them. That is a different kind of help.
 *
 * Deliberately short. A list of nine frames per route is not guidance, it is a
 * wiki page, and the reader has to hold it all to use any of it.
 */
export interface FramePick {
  /** Display name, matched case-insensitively against the frame's path. */
  name: string;
  /** What it does for this route, in one clause. */
  why: string;
}

/** Whether the account shows a given warframe, by name. */
export function ownsFrame(acc: RawAccount | null, name: string, items: ItemDb | null): Owned {
  if (!acc) return null;
  const rows = (acc as unknown as Record<string, unknown>)['Suits'];
  if (!Array.isArray(rows)) return null;

  /*
   * THE FOLDER IN THE PATH IS NOT THE FRAME'S NAME.
   * ────────────────────────
   * This used to match `/powersuits/<name>/`, on the reasoning that a path
   * carries the frame it belongs to. It does not: 52 of the 128 powersuits in
   * the catalog sit under an internal codename, and three of the six frames
   * this app actually recommends were among them - Hydroid is `/Pirate/`,
   * Ivara is `/Ranger/`, Nekros is `/Necro/`.
   *
   * So `ownsFrame('Nekros')` returned false for EVERY account, and the route
   * told a player holding Nekros that Nekros would double their drops. A wrong
   * answer with no error, on the one line the route exists to give.
   *
   * The leaf segment is no better - a base frame is `/Powersuits/Ninja/Ninja`
   * and only the Prime carries the real name. Nothing in the path is reliable,
   * so the name is resolved through the CATALOG, which is the only thing that
   * actually maps one to the other.
   */
  if (items === null) {
    // Unknown, not "you do not have it". The catalog simply has not landed.
    return null;
  }

  const wanted = new Set<string>();
  const needle = name.toLowerCase();
  for (const entry of items.byType.values()) {
    if (!entry.uniqueName.toLowerCase().startsWith('/lotus/powersuits/')) continue;
    /*
     * The base frame AND its variants: a Prime is the same frame with better
     * stats, and telling somebody they lack Nekros while they hold Nekros Prime
     * would be absurd. Matched on the catalog's own display name, so "Nekros"
     * takes "Nekros Prime" and nothing else.
     */
    const entryName = entry.name.toLowerCase();
    if (entryName === needle || entryName.startsWith(`${needle} `)) wanted.add(entry.uniqueName.toLowerCase());
  }
  if (wanted.size === 0) {
    /*
     * The catalog is loaded and knows no such frame. That is a fault in OUR
     * table of recommendations, not a fact about the player, so it must not
     * read as "you do not own it" - `check-frame-picks.ts` fails the build on
     * exactly this.
     */
    return null;
  }

  return rows.some((row) => {
    if (typeof row !== 'object' || row === null) return false;
    const type = (row as Record<string, unknown>)['ItemType'];
    return typeof type === 'string' && wanted.has(type.toLowerCase());
  });
}

export interface FrameAdvice {
  pick: FramePick;
  owned: Owned;
}

/** Check a route's suggested frames against the arsenal. */
export function frameAdvice(
  acc: RawAccount | null,
  picks: readonly FramePick[],
  items: ItemDb | null,
): FrameAdvice[] {
  return picks.map((pick) => ({ pick, owned: ownsFrame(acc, pick.name, items) }));
}

/**
 * The one line worth showing: the best frame you ACTUALLY HAVE.
 *
 * Falls back to naming the best one you do not have, because "Nekros would
 * roughly double your drops" is worth knowing even when the answer is that you
 * would have to farm it first. Null when the route has no frame that changes
 * its output, which is most of them.
 */
export function bestFrame(advice: readonly FrameAdvice[]): { text: string; owned: boolean } | null {
  const have = advice.find((a) => a.owned === true);
  if (have) return { text: `Bring ${have.pick.name} — ${have.pick.why}`, owned: true };

  const lack = advice.find((a) => a.owned === false);
  if (lack) return { text: `${lack.pick.name} would help here — ${lack.pick.why}`, owned: false };

  return null;
}

/* ------------------------------------------------- competence, not ownership */

/**
 * Railjack Intrinsics, which decide whether owning a Railjack means anything.
 *
 * Owning one and being able to run it alone are different states. `PlayerSkills`
 * carries the five command-tree ranks, and Piloting plus Gunnery are the two
 * that decide whether a solo Void Storm is a run or an ordeal.
 *
 * The threshold is a JUDGMENT and is named as one wherever it is used: five is
 * where the tree unlocks the abilities people actually rely on, and somebody
 * skilled at the game will manage below it. So this reports the RANK and lets
 * the caller phrase it, rather than pronouncing anybody incapable.
 */
export interface Intrinsics {
  piloting: number | null;
  gunnery: number | null;
  /** The lower of the two - a Railjack run is only as good as its weaker half. */
  effective: number | null;
}

export function intrinsics(acc: RawAccount | null): Intrinsics {
  const none: Intrinsics = { piloting: null, gunnery: null, effective: null };
  if (!acc) return none;
  const skills = (acc as unknown as Record<string, unknown>)['PlayerSkills'];
  if (typeof skills !== 'object' || skills === null) return none;
  const read = (k: string): number | null => {
    const v = (skills as Record<string, unknown>)[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const piloting = read('LPS_PILOTING');
  const gunnery = read('LPS_GUNNERY');
  const effective = piloting === null || gunnery === null ? null : Math.min(piloting, gunnery);
  return { piloting, gunnery, effective };
}

/**
 * Your rank with a syndicate, which gates what it will sell you.
 *
 * `Title` is the rank and can be NEGATIVE - a syndicate you have wronged sits
 * below neutral - so a naive "is it at least N" must not treat -1 as unset.
 * Absent from the array means you have not joined, which is rank 0, not unknown;
 * an absent ARRAY is unknown.
 */
export function syndicateRank(acc: RawAccount | null, tag: string): number | null {
  if (!acc) return null;
  const rows = (acc as unknown as Record<string, unknown>)['Affiliations'];
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    if (r['Tag'] !== tag) continue;
    return typeof r['Title'] === 'number' ? r['Title'] : 0;
  }
  // Joined nothing is a real answer: neutral.
  return 0;
}
