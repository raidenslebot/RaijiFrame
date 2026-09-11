/**
 * Derived state for every account subsystem beyond quests and the star chart.
 *
 * Each function takes the raw account and returns a small, display-ready object.
 * They are pure and take `now` as an argument where time matters, so the check
 * script can exercise them without a browser or a clock.
 *
 * Two rules run through the whole file, both forced by the research:
 *
 *  1. **Every field is read defensively.** Only nine top-level keys are directly
 *     evidenced in a real GEP payload (inventory-schema.md §12.1); the rest are
 *     *expected* because it is the same serialized blob, not observed. So nothing
 *     here trusts the declared type of `RawAccount` — values are checked at
 *     runtime and a missing field yields `null`, never a zero that reads as fact.
 *  2. **An honest gap beats a plausible number.** Where the payload genuinely
 *     does not carry a value (focus spent, the lich's actual weapon, whether
 *     *today's* sortie is done), the field is `null` and a comment says why.
 *     Filling those in would need the focus cost table, the nemesis manifest, or
 *     worldState — none of which are in the inventory.
 */

import type { RawAccount } from './account';

// ---------------------------------------------------------------------------
// Defensive readers
// ---------------------------------------------------------------------------

/**
 * One cast, here, on purpose. GEP hands over whatever the game had in memory:
 * fields can be absent, truncated, or a shape from an older account. Reading
 * through a bag of `unknown` forces every access below to prove itself, and it
 * keeps this module working even when `RawAccount` gains or renames a field.
 */
type Bag = Readonly<Record<string, unknown>>;
const bag = (acc: RawAccount): Bag => acc as unknown as Bag;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const bool = (v: unknown): boolean => v === true;
const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Bag => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Bag) : {});
const at = (v: unknown, key: string): unknown => rec(v)[key];

/**
 * Milliseconds since epoch from a Mongo date, or `null`.
 *
 * Modern clients send `{$date:{$numberLong:"…"}}`; pre-U19.5 accounts send
 * `{sec,usec}` (inventory-schema.md §2). Both appear in the wild, so both parse.
 */
export function epochMs(v: unknown): number | null {
  const d = at(v, '$date');
  if (d !== undefined) {
    const long = at(d, '$numberLong');
    if (typeof long === 'string') {
      const n = Number(long);
      return Number.isFinite(n) ? n : null;
    }
    return num(d);
  }
  const sec = num(at(v, 'sec'));
  return sec === null ? null : sec * 1000;
}

/** `{ $oid }` today, `{ $id }` on legacy accounts. */
const oid = (v: unknown): string | null => str(at(v, '$oid')) ?? str(at(v, '$id'));

/** `ITypeCount[]` -> a plain map, skipping malformed rows. */
function typeCounts(v: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of list(v)) {
    const type = str(at(row, 'ItemType'));
    const count = num(at(row, 'ItemCount'));
    if (type !== null && count !== null) out.set(type, (out.get(type) ?? 0) + count);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------

export type FocusSchoolKey = 'AP_ATTACK' | 'AP_DEFENSE' | 'AP_TACTIC' | 'AP_WARD' | 'AP_POWER';

export interface FocusSchool {
  key: FocusSchoolKey;
  /** Display label only. The polarity keys are the verified data. */
  name: string;
  /** Unspent focus banked for this school. */
  pooled: number;
}

export interface FocusState {
  schools: FocusSchool[];
  pooledTotal: number;
  /**
   * Focus permanently spent on nodes. UNAVAILABLE: the payload carries unspent
   * pools (`FocusXP`) and which nodes are unlocked (`FocusUpgrades`), but not
   * what each node cost, so a spent total would be an invention.
   */
  spent: number | null;
  /** `FocusCapacity` — the Focus 2.0 pool cap (Eidolon shard upgrades). */
  capacity: number | null;
  /** Waybound nodes are the `IsUniversal` focus upgrades. */
  waybound: { unlocked: number; total: number | null };
  nodesUnlocked: number;
  /** Focus still earnable today. Cap resets to 250,000 + MR × 5,000 at 00:00 UTC. */
  daily: { remaining: number | null; cap: number | null };
  activeAbility: string | null;
}

const FOCUS_SCHOOLS: ReadonlyArray<readonly [FocusSchoolKey, string]> = [
  ['AP_ATTACK', 'Madurai'],
  ['AP_DEFENSE', 'Vazarin'],
  ['AP_TACTIC', 'Naramon'],
  ['AP_WARD', 'Unairu'],
  ['AP_POWER', 'Zenurik'],
];

export function focusState(acc: RawAccount): FocusState {
  const a = bag(acc);
  const xp = rec(a['FocusXP']);
  const schools = FOCUS_SCHOOLS.map(([key, name]) => ({ key, name, pooled: num(xp[key]) ?? 0 }));

  const upgrades = list(a['FocusUpgrades']);
  const mr = num(a['PlayerLevel']);

  return {
    schools,
    pooledTotal: schools.reduce((sum, s) => sum + s.pooled, 0),
    spent: null,
    capacity: num(a['FocusCapacity']),
    // Total waybound nodes in the game is canonical data this module doesn't
    // have. Showing "7 unlocked" beats showing "7 / 9" when 9 is a guess.
    waybound: { unlocked: upgrades.filter((u) => bool(at(u, 'IsUniversal'))).length, total: null },
    nodesUnlocked: upgrades.length,
    daily: { remaining: num(a['DailyFocus']), cap: mr === null ? null : 250_000 + mr * 5_000 },
    activeAbility: str(a['FocusAbility']),
  };
}

// ---------------------------------------------------------------------------
// Intrinsics
// ---------------------------------------------------------------------------

/** Verified in mastery-math.md §2.5: every intrinsic rank is worth 1,500 mastery XP. */
export const MASTERY_PER_INTRINSIC_RANK = 1_500;

export interface IntrinsicBranch {
  key: string;
  name: string;
  rank: number;
}

export interface IntrinsicTree {
  branches: IntrinsicBranch[];
  ranks: number;
  maxRanks: number;
  /**
   * `LPP_SPACE` / `LPP_DRIFTER` divided by 1,000. UNCERTAIN: the research reads
   * these as unspent points in one place and as an overall rank in another
   * (inventory-schema.md §6). The `LPS_*` ranks below are the unambiguous data;
   * treat this as a hint until a real dump settles it.
   */
  unspentPoints: number | null;
  masteryXp: number;
  masteryXpMax: number;
}

export interface IntrinsicsState {
  railjack: IntrinsicTree;
  drifter: IntrinsicTree;
  masteryXp: number;
  masteryXpMax: number;
}

const RAILJACK_BRANCHES: ReadonlyArray<readonly [string, string]> = [
  ['LPS_PILOTING', 'Piloting'],
  ['LPS_GUNNERY', 'Gunnery'],
  ['LPS_TACTICAL', 'Tactical'],
  ['LPS_ENGINEERING', 'Engineering'],
  ['LPS_COMMAND', 'Command'],
];

const DRIFTER_BRANCHES: ReadonlyArray<readonly [string, string]> = [
  ['LPS_DRIFT_COMBAT', 'Combat'],
  ['LPS_DRIFT_RIDING', 'Riding'],
  ['LPS_DRIFT_OPPORTUNITY', 'Opportunity'],
  ['LPS_DRIFT_ENDURANCE', 'Endurance'],
];

/** Each branch caps at rank 10 (mastery-math.md §2.5: 5 × 10 and 4 × 10 ranks). */
const MAX_INTRINSIC_RANK = 10;

function tree(skills: Bag, defs: ReadonlyArray<readonly [string, string]>, pointsKey: string): IntrinsicTree {
  const branches = defs.map(([key, name]) => ({ key, name, rank: num(skills[key]) ?? 0 }));
  const ranks = branches.reduce((sum, b) => sum + b.rank, 0);
  const maxRanks = defs.length * MAX_INTRINSIC_RANK;
  const points = num(skills[pointsKey]);
  return {
    branches,
    ranks,
    maxRanks,
    unspentPoints: points === null ? null : Math.floor(points / 1_000),
    masteryXp: ranks * MASTERY_PER_INTRINSIC_RANK,
    masteryXpMax: maxRanks * MASTERY_PER_INTRINSIC_RANK,
  };
}

export function intrinsicsState(acc: RawAccount): IntrinsicsState {
  const skills = rec(bag(acc)['PlayerSkills']);
  const railjack = tree(skills, RAILJACK_BRANCHES, 'LPP_SPACE');
  const drifter = tree(skills, DRIFTER_BRANCHES, 'LPP_DRIFTER');
  return {
    railjack,
    drifter,
    masteryXp: railjack.masteryXp + drifter.masteryXp,
    masteryXpMax: railjack.masteryXpMax + drifter.masteryXpMax,
  };
}

// ---------------------------------------------------------------------------
// Syndicates
// ---------------------------------------------------------------------------

export interface SyndicateStanding {
  tag: string;
  standing: number;
  /** `Affiliations[].Title` is the rank index, not a name. */
  rank: number | null;
  initiated: boolean;
  /** Standing still earnable today, or `null` when this tag's daily key is unknown. */
  dailyRemaining: number | null;
  dailyCap: number | null;
  /** True for the six faction syndicates, which all draw on one shared pool. */
  sharedPool: boolean;
  /** Nightwave lives in `Affiliations` too, but has no daily standing cap. */
  isNightwave: boolean;
}

export interface SyndicateState {
  /**
   * True when this read predates its own daily reset, so every `dailyRemaining`
   * in it is null rather than a number about yesterday. Surfaces can say so
   * instead of showing a dash with no reason attached.
   */
  staleAcrossReset: boolean;
  syndicates: SyndicateStanding[];
  pledged: string | null;
  /** The pool shared by Steel Meridian / Arbiters / Suda / Perrin / Red Veil / New Loka. */
  sharedDaily: { remaining: number | null; cap: number | null };
}

/**
 * Syndicate tag -> its `DailyAffiliation*` counter.
 *
 * Only tags verified from a primary source are listed (inventory-schema.md
 * §12.8). Quills, Ventkids, Vox, Necraloid and Cavia have daily counters but
 * their literal tags were never seen in a primary source, so `EntratiLab ->
 * Cavia` is the one inference here and it is marked. An unmapped tag reports
 * `dailyRemaining: null` rather than being silently attached to the wrong pool.
 */
const SHARED_STANDING_TAGS: ReadonlySet<string> = new Set([
  'SteelMeridianSyndicate',
  'ArbitersSyndicate',
  'CephalonSudaSyndicate',
  'PerrinSyndicate',
  'RedVeilSyndicate',
  'NewLokaSyndicate',
]);

const DAILY_KEY_BY_TAG: ReadonlyMap<string, string> = new Map([
  ['CetusSyndicate', 'DailyAffiliationCetus'],
  ['SolarisSyndicate', 'DailyAffiliationSolaris'],
  ['EntratiSyndicate', 'DailyAffiliationEntrati'],
  ['ZarimanSyndicate', 'DailyAffiliationZariman'],
  ['KahlSyndicate', 'DailyAffiliationKahl'],
  ['LibrarySyndicate', 'DailyAffiliationLibrary'],
  ['HexSyndicate', 'DailyAffiliationHex'],
  // Cavia is the Entrati Lab syndicate. Inferred, not seen in a primary source.
  ['EntratiLabSyndicate', 'DailyAffiliationCavia'],
]);

/** Verified in §10: every daily standing pool resets to 16,000 + MR × 500. */
function standingCap(mr: number | null): number | null {
  return mr === null ? null : 16_000 + mr * 500;
}

export function syndicateState(acc: RawAccount, now?: number): SyndicateState {
  const a = bag(acc);
  const cap = standingCap(num(a['PlayerLevel']));

  /*
   * THE DAILY COUNTERS GO STALE, AND THIS ONE WAS NOT GUARDED.
   *
   * `dailyState` and `platPosition` both null their daily counters once the
   * account's own `NextRefill` is behind the clock, because a kept read taken
   * yesterday says nothing about what is left today. This function did not, so
   * a day-old read handed back yesterday's remaining standing as if it were
   * today's - and the standing panel, and the platinum panel's standing card,
   * presented it as a fact about this morning.
   *
   * Null rather than the cap, for the same reason as everywhere else: what is
   * left is genuinely unknown until the next read, and filling in the cap would
   * invent a number for a player who may already have spent it.
   *
   * `standing` and `rank` are NOT nulled: those are cumulative totals, not
   * daily counters, and they do not reset.
   */
  const nowMs = now ?? Date.now();
  const refill = epochMs(a['NextRefill']);
  const stale = refill !== null && refill <= nowMs;
  const today = (v: number | null): number | null => (stale ? null : v);

  const shared = { remaining: today(num(a['DailyAffiliation'])), cap };

  const syndicates: SyndicateStanding[] = [];
  for (const row of list(a['Affiliations'])) {
    const tag = str(at(row, 'Tag'));
    if (tag === null) continue;
    const isNightwave = tag.startsWith('RadioLegion');
    const sharedPool = SHARED_STANDING_TAGS.has(tag);
    const dailyKey = DAILY_KEY_BY_TAG.get(tag);
    const remaining = sharedPool ? shared.remaining : dailyKey === undefined ? null : today(num(a[dailyKey]));
    syndicates.push({
      tag,
      standing: num(at(row, 'Standing')) ?? 0,
      rank: num(at(row, 'Title')),
      initiated: bool(at(row, 'Initiated')),
      dailyRemaining: remaining,
      dailyCap: isNightwave || remaining === null ? null : cap,
      sharedPool,
      isNightwave,
    });
  }

  return {
    syndicates: syndicates.sort((x, y) => y.standing - x.standing || x.tag.localeCompare(y.tag)),
    pledged: str(a['SupportedSyndicate']),
    sharedDaily: shared,
    staleAcrossReset: stale,
  };
}

// ---------------------------------------------------------------------------
// Foundry
// ---------------------------------------------------------------------------

export interface FoundryJob {
  /** `ItemId` — what `claimCompletedRecipe.php` takes. */
  id: string | null;
  itemType: string;
  readyAtMs: number | null;
  ready: boolean;
  /** Milliseconds until ready, 0 when ready, `null` when the date is unreadable. */
  remainingMs: number | null;
}

export interface FoundryState {
  ready: FoundryJob[];
  building: FoundryJob[];
  /** When the next build finishes, for a countdown. */
  nextReadyMs: number | null;
  /** `Recipes` — blueprints owned but not started. */
  unstartedBlueprints: number;
}

/**
 * There is no "ready" boolean in the payload — it is derived from
 * `CompletionDate <= now` (inventory-schema.md §7, proven by
 * checkPendingRecipesController). A job whose date won't parse is treated as
 * still building, so nothing is ever claimed as ready on a bad read.
 */
export function foundryState(acc: RawAccount, now: number = Date.now()): FoundryState {
  const a = bag(acc);
  const ready: FoundryJob[] = [];
  const building: FoundryJob[] = [];

  for (const row of list(a['PendingRecipes'])) {
    const itemType = str(at(row, 'ItemType'));
    if (itemType === null) continue;
    const readyAtMs = epochMs(at(row, 'CompletionDate'));
    const isReady = readyAtMs !== null && readyAtMs <= now;
    const job: FoundryJob = {
      id: oid(at(row, 'ItemId')),
      itemType,
      readyAtMs,
      ready: isReady,
      remainingMs: readyAtMs === null ? null : Math.max(0, readyAtMs - now),
    };
    (isReady ? ready : building).push(job);
  }

  building.sort((x, y) => (x.readyAtMs ?? Infinity) - (y.readyAtMs ?? Infinity));
  const next = building.find((j) => j.readyAtMs !== null);

  return {
    ready,
    building,
    nextReadyMs: next?.readyAtMs ?? null,
    unstartedBlueprints: list(a['Recipes']).length,
  };
}

// ---------------------------------------------------------------------------
// Nemesis (Kuva Lich / Sister of Parvos / Coda)
// ---------------------------------------------------------------------------

export interface ActiveNemesis {
  faction: string | null;
  manifest: string | null;
  rank: number | null;
  birthNode: string | null;
  killingSuit: string | null;
  createdMs: number | null;
  /**
   * The weapon and ephemera it drops. UNAVAILABLE: the payload stores only
   * `WeaponIdx`/`AgentIdx`, indices into the nemesis *manifest*, which is game
   * data this module does not have. `weaponIdx` is exposed raw so a caller that
   * loads the manifest can resolve it; guessing here would be fabrication.
   */
  weapon: null;
  ephemera: null;
  weaponIdx: number | null;
  shoulderHelmet: string | null;
  /** Requiem progress: how many hints are revealed and how many guesses made. */
  hintsRevealed: number;
  hintProgress: number | null;
  guesses: number;
  henchmenKilled: number | null;
  missionCount: number | null;
  /** Star-chart territory it currently influences. */
  influencedNodes: number;
  weakened: boolean;
  secondInCommand: boolean;
}

export interface NemesisState {
  active: ActiveNemesis | null;
  /** `k: true` = killed/vanquished, `k: false` = converted (§8). Null when `NemesisHistory` never arrived. */
  vanquished: number | null;
  converted: number | null;
  historyTotal: number | null;
  /** Converted liches serving as Railjack crew. Null with the history. */
  onCall: number | null;
}

export function nemesisState(acc: RawAccount): NemesisState {
  const a = bag(acc);
  const n = a['Nemesis'];

  let vanquished = 0;
  let converted = 0;
  let onCall = 0;
  const history = list(a['NemesisHistory']);
  for (const past of history) {
    if (bool(at(past, 'k'))) vanquished++;
    else converted++;
    if (bool(at(past, 'SecondInCommand'))) onCall++;
  }

  const active: ActiveNemesis | null =
    typeof n === 'object' && n !== null
      ? {
          faction: str(at(n, 'Faction')),
          manifest: str(at(n, 'manifest')),
          rank: num(at(n, 'Rank')),
          birthNode: str(at(n, 'BirthNode')),
          killingSuit: str(at(n, 'KillingSuit')),
          createdMs: epochMs(at(n, 'd')),
          weapon: null,
          ephemera: null,
          weaponIdx: num(at(n, 'WeaponIdx')),
          shoulderHelmet: str(at(n, 'ShoulderHelmet')),
          hintsRevealed: list(at(n, 'Hints')).length,
          hintProgress: num(at(n, 'HintProgress')),
          guesses: list(at(n, 'GuessHistory')).length,
          henchmenKilled: num(at(n, 'HenchmenKilled')),
          missionCount: num(at(n, 'MissionCount')),
          influencedNodes: list(at(n, 'InfNodes')).length,
          weakened: bool(at(n, 'Weakened')),
          secondInCommand: bool(at(n, 'SecondInCommand')),
        }
      : null;

  const read = Array.isArray(a['NemesisHistory']);
  return read
    ? { active, vanquished, converted, historyTotal: history.length, onCall }
    : { active, vanquished: null, converted: null, historyTotal: null, onCall: null };
}

// ---------------------------------------------------------------------------
// Railjack
// ---------------------------------------------------------------------------

export interface RailjackArmament {
  /** `PILOT` | `PORT_GUNS` | `STARBOARD_GUNS` | `ARTILLERY` | `SCANNER`. */
  emplacement: string;
  /** `PRIMARY_A` | `PRIMARY_B` | `SECONDARY_A` | `SECONDARY_B`. */
  slot: string;
  itemType: string | null;
  itemId: string | null;
}

export interface RailjackCrew {
  id: string | null;
  itemType: string | null;
  xp: number | null;
  role: number | null;
  /** A non-zero `NemesisFingerprint` means this crew slot is a converted lich. */
  isConvertedLich: boolean;
  onCall: boolean;
  skills: Record<string, number>;
}

export interface RailjackState {
  ship: {
    name: string | null;
    /** `SlotLevels` — component levels; their meaning per index is not documented. */
    componentLevels: number[];
    armaments: RailjackArmament[];
  } | null;
  ships: number;
  crew: RailjackCrew[];
  crewSlotsFree: number | null;
  armamentsOwned: number;
  salvageUnidentified: number;
  /** Dirac. */
  fusionPoints: number | null;
}

const EMPLACEMENTS = ['PILOT', 'PORT_GUNS', 'STARBOARD_GUNS', 'ARTILLERY', 'SCANNER'] as const;
const WEAPON_SLOTS = ['PRIMARY_A', 'PRIMARY_B', 'SECONDARY_A', 'SECONDARY_B'] as const;

function armaments(weapon: unknown): RailjackArmament[] {
  const out: RailjackArmament[] = [];
  for (const emplacement of EMPLACEMENTS) {
    const group = at(weapon, emplacement);
    if (group === undefined) continue;
    for (const slot of WEAPON_SLOTS) {
      const sel = at(group, slot);
      if (sel === undefined) continue;
      out.push({
        emplacement,
        slot,
        itemType: str(at(sel, 'ItemType')),
        itemId: oid(at(sel, 'ItemId')),
      });
    }
  }
  return out;
}

export function railjackState(acc: RawAccount): RailjackState {
  const a = bag(acc);
  const ships = list(a['CrewShips']);
  const first = ships[0];

  const crew: RailjackCrew[] = list(a['CrewMembers']).map((m) => {
    const skills: Record<string, number> = {};
    for (const [name, value] of Object.entries(rec(at(m, 'SkillEfficiency')))) {
      const assigned = num(at(value, 'Assigned'));
      if (assigned !== null) skills[name] = assigned;
    }
    return {
      id: oid(at(m, 'ItemId')),
      itemType: str(at(m, 'ItemType')),
      xp: num(at(m, 'XP')),
      role: num(at(m, 'AssignedRole')),
      isConvertedLich: (num(at(m, 'NemesisFingerprint')) ?? 0) !== 0,
      onCall: bool(at(m, 'SecondInCommand')),
      skills,
    };
  });

  return {
    ship:
      first === undefined
        ? null
        : {
            // Liches store "Name|NEMESIS" in ItemName; a Railjack stores a plain name.
            name: str(at(first, 'ItemName')),
            componentLevels: list(at(first, 'SlotLevels')).map((v) => num(v) ?? 0),
            armaments: armaments(at(first, 'Weapon')),
          },
    ships: ships.length,
    crew,
    // Slot bins count REMAINING free slots, not capacity (§3f) — an easy misread.
    crewSlotsFree: num(at(a['CrewMemberBin'], 'Slots')),
    armamentsOwned: list(a['CrewShipWeapons']).length,
    salvageUnidentified: list(a['CrewShipSalvagedWeapons']).length,
    fusionPoints: num(a['CrewShipFusionPoints']),
  };
}

// ---------------------------------------------------------------------------
// Daily / weekly gates
// ---------------------------------------------------------------------------

export interface Remaining {
  remaining: number | null;
  cap: number | null;
}

export interface DailyState {
  /** `NextRefill` — when the daily counters reset (00:00 UTC). */
  resetsAtMs: number | null;
  /**
   * True when the read this was built from predates its own reset instant, so
   * every daily counter in it describes a day that is already over.
   *
   * With the game closed this is the NORMAL case, not an edge one: the app is
   * built to keep working from a stored account, and a stored account goes
   * stale the moment the clock passes midnight UTC. Before this existed the
   * panel showed yesterday's leftover trades as today's, which is the one kind
   * of wrong that looks exactly like right.
   */
  staleAcrossReset: boolean;
  focus: Remaining;
  /** The shared six-faction standing pool. Per-syndicate pools are in `syndicateState`. */
  standing: Remaining;
  trades: Remaining;
  gifts: Remaining;
  /**
   * Whether TODAY's sortie / archon hunt is done. UNAVAILABLE from the
   * inventory: it stores the ids of everything ever cleared, and matching
   * today's id needs worldState. `rewardPending` is the honest signal we do
   * have — an unclaimed reward means the run happened.
   */
  /** `everCompleted` is null when the history never arrived: absent is not zero. */
  sortie: { done: boolean | null; everCompleted: number | null; rewardPending: boolean };
  archon: { done: boolean | null; rewardPending: boolean };
  /** Netracell runs used this week. The weekly cap is not in the payload. */
  netracells: { used: number | null; cap: number | null; resetsAtMs: number | null };
  simaris: { target: string | null; scans: number | null; scansRequired: number | null };
  /** Nightwave acts completed, all seasons. */
  /** Null when the act history never arrived: absent is not zero. */
  nightwaveActsDone: number | null;
  blessingReadyAtMs: number | null;
  /** `TrainingDate` — when the next mastery rank test unlocks. */
  masteryTestAtMs: number | null;
}

/**
 * Next 00:00 UTC, in epoch ms.
 *
 * Warframe's daily counters reset at 00:00 UTC — a fixed property of the game,
 * not of any account. `NextRefill` is the authoritative value when the account
 * has been read, but before that the clock is still perfectly knowable, and a
 * countdown to a known instant is arithmetic rather than a guess.
 *
 * This is what lets the Daily panel be useful with the game closed: the gates
 * and their deadlines are real, and only "have you used it" is unmeasured.
 */
export function nextDailyResetUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
}

function liveReset(refill: number | null, now: number): number {
  return refill !== null && refill > now ? refill : nextDailyResetUtc(now);
}

export function dailyState(acc: RawAccount, now?: number): DailyState {
  const a = bag(acc);
  const mr = num(a['PlayerLevel']);
  const active = rec(a['LibraryActiveDailyTaskInfo']);
  const nowMs = now ?? Date.now();

  /*
   * `NextRefill` is the account's OWN claim about when its daily counters roll
   * over. Once that instant is behind us, the counters in this read are from
   * before the reset and none of them is a fact about today.
   *
   * They become null rather than the cap: what is left today is genuinely
   * unknown until the next read. Guessing the cap would be inventing a number,
   * and the player may well have spent some of it already.
   */
  const stale = ((): boolean => {
    const refill = epochMs(a['NextRefill']);
    return refill !== null && refill <= nowMs;
  })();
  const today = (v: number | null): number | null => (stale ? null : v);

  return {
    staleAcrossReset: stale,
    // The account's own value wins while it is still ahead of the clock. A kept
    // read goes stale within a day of capture, and a countdown to an instant
    // already gone is the first thing three panels showed; past it, the next
    // 00:00 UTC is the same instant a fresh `NextRefill` would name.
    resetsAtMs: liveReset(epochMs(a['NextRefill']), nowMs),
    focus: { remaining: today(num(a['DailyFocus'])), cap: mr === null ? null : 250_000 + mr * 5_000 },
    standing: { remaining: today(num(a['DailyAffiliation'])), cap: standingCap(mr) },
    // Trades reset to MR, +2 for Founders (§5). `Founder` is absent on everyone else.
    trades: { remaining: today(num(a['TradesRemaining'])), cap: mr === null ? null : mr + (num(a['Founder']) === null ? 0 : 2) },
    gifts: { remaining: today(num(a['GiftsRemaining'])), cap: mr === null ? null : Math.max(8, mr) },
    sortie: {
      done: null,
      everCompleted: Array.isArray(a['CompletedSorties']) ? list(a['CompletedSorties']).length : null,
      rewardPending: list(a['LastSortieReward']).length > 0,
    },
    archon: { done: null, rewardPending: list(a['LastLiteSortieReward']).length > 0 },
    netracells: {
      used: num(a['EntratiVaultCountLastPeriod']),
      cap: null,
      resetsAtMs: epochMs(a['EntratiVaultCountResetDate']),
    },
    simaris: {
      target: str(a['LibraryPersonalTarget']),
      // `Scans` appears only once the daily is started; absent is not zero.
      scans: num(active['Scans']),
      scansRequired: num(active['ScansRequired']),
    },
    nightwaveActsDone: Array.isArray(a['SeasonChallengeHistory']) ? list(a['SeasonChallengeHistory']).length : null,
    blessingReadyAtMs: epochMs(a['BlessingCooldown']),
    masteryTestAtMs: epochMs(a['TrainingDate']),
  };
}

// ---------------------------------------------------------------------------
// Currencies and resources
// ---------------------------------------------------------------------------

/**
 * Ducats are `PrimeBucks` and Aya is `SchismKey` — a DE naming artefact verified
 * against ExportResources (inventory-schema.md §2). Swapping them is a silent,
 * plausible-looking bug, which is exactly why they are constants here.
 */
const DUCATS = '/Lotus/Types/Items/MiscItems/PrimeBucks';
const AYA = '/Lotus/Types/Items/MiscItems/SchismKey';

export interface ResourceStack {
  itemType: string;
  count: number;
}

export interface InventoryTotals {
  credits: number | null;
  platinum: number | null;
  /** Platinum minus the untradeable (starter/gift) portion. */
  platinumTradable: number | null;
  endo: number | null;
  ducats: number | null;
  aya: number | null;
  /** Regal Aya. */
  regalAya: number | null;
  /** Dirac. */
  dirac: number | null;
  topResources: ResourceStack[];
  distinctResources: number;
}

export function inventoryTotals(acc: RawAccount, top = 8): InventoryTotals {
  const a = bag(acc);
  const misc = typeCounts(a['MiscItems']);
  const platinum = num(a['PremiumCredits']);
  const free = num(a['PremiumCreditsFree']);

  const stacks: ResourceStack[] = [...misc].map(([itemType, count]) => ({ itemType, count }));
  stacks.sort((x, y) => y.count - x.count || x.itemType.localeCompare(y.itemType));

  return {
    credits: num(a['RegularCredits']),
    platinum,
    platinumTradable: platinum === null || free === null ? null : Math.max(0, platinum - free),
    endo: num(a['FusionPoints']),
    ducats: misc.get(DUCATS) ?? null,
    aya: misc.get(AYA) ?? null,
    regalAya: num(a['PrimeTokens']),
    dirac: num(a['CrewShipFusionPoints']),
    topResources: stacks.slice(0, top),
    distinctResources: misc.size,
  };
}

// ---------------------------------------------------------------------------
// Dashboard aggregate
// ---------------------------------------------------------------------------

export interface SubsystemSummary {
  focus: FocusState;
  intrinsics: IntrinsicsState;
  syndicates: SyndicateState;
  foundry: FoundryState;
  nemesis: NemesisState;
  railjack: RailjackState;
  daily: DailyState;
  totals: InventoryTotals;
}

/** Everything a subsystem dashboard needs, from one account read. */
export function subsystemSummary(acc: RawAccount, now: number = Date.now()): SubsystemSummary {
  return {
    focus: focusState(acc),
    intrinsics: intrinsicsState(acc),
    syndicates: syndicateState(acc, now),
    foundry: foundryState(acc, now),
    nemesis: nemesisState(acc),
    railjack: railjackState(acc),
    daily: dailyState(acc, now),
    totals: inventoryTotals(acc),
  };
}
