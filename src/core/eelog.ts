/**
 * EE.log reader.
 *
 * Warframe's engine log is a live feed of what the player is actually doing, and
 * it carries the one thing GEP's inventory dump cannot: the node being played
 * *right now*. `Host loading {"difficulty":1,"name":"SolNode175"}` joins directly
 * to the vendored star chart, so a clear can be reflected the moment it happens
 * rather than whenever the game next pushes an inventory update.
 *
 * What it does NOT carry is the loot. Mining the whole log (docs/research/
 * eelog-mining.md) found `GiveMissionRewards. success=true` with no items, and
 * zero hits for MISSION_REWARD / DropTable / ResourceDrop / kills / waves /
 * rotations. So the division of labour is fixed: the log says WHEN, WHERE and
 * HOW IT WENT; an inventory snapshot diff says WHAT dropped. The two events that
 * make that diff correct rather than approximate are parsed below —
 * `CommitInventoryChangesToDB` (write in flight) and `DbUpdateComplete` (server
 * has it, the next GEP dump will include the run's items). Snapshot on the
 * second one; the first is ~240 ms too early.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PRIVACY — read before extending this file.
 *
 * EE.log contains the account's **email address in plaintext** on the login line
 * (`Logging in as <email>`), and elsewhere the machine's IP, the Windows user
 * and computer name, the 24-hex account id (`mm=`), and other players' display
 * names. This parser is built to never emit any of it: `parseLine` matches an
 * explicit allowlist of patterns rather than scanning for interesting text, and
 * every string it returns is passed through `redact` on the way out - see
 * `parseLine` below, which is the single exit and the only place that claim can
 * be kept. The claim used to be written here and implemented nowhere: `redact`
 * was called on the login username and on an Overwolf error string, and the
 * three loose captures - the mission name, the load location and the mod name -
 * reached their consumers exactly as the log wrote them.
 *
 * Never log a raw line, never persist one, and never send one anywhere.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Reading is via `overwolf.io.listenOnFile`, which tails line-by-line and needs
 * only the `FileSystem` permission — no plugin, and no polling of our own.
 */

import { ow } from './ow.ts';

/**
 * Every event carries the log's own timestamp: seconds since process start,
 * three decimals, monotonically increasing. 14 lines in a 4,700-line capture
 * have no prefix at all, hence `number | null`.
 */
export type LogEvent = { at: number | null } & (
  | { type: 'login'; username: string }
  | { type: 'missionStart'; node: string; difficulty: number }
  | { type: 'missionInfo'; name: string; planet: string }
  | { type: 'missionType'; missionType: string }
  | { type: 'missionEnd'; success: boolean }
  /** Mission type ~0.5 s earlier than `missionType`, plus a location field. */
  | { type: 'missionLoad'; missionType: string; location: string | null }
  /** Game-rules class. The cheapest orbiter-vs-mission discriminator there is. */
  | { type: 'gameRules'; rules: string }
  /** GameRulesImpl state machine. SS_STARTED..SS_ENDING brackets a real mission. */
  | { type: 'sessionState'; from: string; to: string }
  /** `sessionPlayers=N` at level load — squad size with no name capture. */
  | { type: 'squadSize'; players: number }
  /** `name` is null unless squad-name capture was explicitly opted into. */
  | { type: 'squadMember'; name: string | null; squadCount: number }
  /** We hosted this session. There is no corresponding "you are a client" line. */
  | { type: 'hostSession'; success: boolean }
  /** Level load time. NOT mission time — the values are 2-4 s. */
  | { type: 'loadTime'; seconds: number; waitingSeconds: number }
  /** A player was inside the extraction trigger at end of match. Name discarded. */
  | { type: 'extraction'; inTrigger: boolean }
  /** The only genuine per-mission reward number the log contains. */
  | { type: 'syndicateXp'; stage: 'base' | 'multiplier' | 'checkpoint'; amount: number }
  /** Mission's inventory changes are being pushed. Too early to snapshot. */
  | { type: 'inventoryCommitted' }
  /** Server has the changes. This is the moment to ask GEP for the `after` snapshot. */
  | { type: 'inventoryDurable' }
  /** Game closed cleanly. Close any dangling run rather than leaking it. */
  | { type: 'sessionEnd' }
  /**
   * The daily login reward was claimed. THE ONLY EVENT HERE THAT FIXES SOMETHING
   * RATHER THAN ADDING SOMETHING: a tribute claimed inside a run's attribution
   * window is currently credited to the run as loot, because loot is a snapshot
   * diff and the diff cannot tell where the items came from. Now it can be told.
   */
  | { type: 'dailyTribute' }
  /** Percent toward owning every masterable item at max rank. The engine's own answer. */
  | { type: 'masteryProgress'; percent: number }
  /** Account-cumulative mastery XP from items. Per-run gain is the delta. */
  | { type: 'masteryXp'; xp: number }
  /** Account-cumulative mastery XP from missions - the other half of the total. */
  | { type: 'missionXp'; xp: number }
  /** One gear slot as the mission loads: what was carried in, and how many. */
  | { type: 'loadoutConsumable'; slot: number; itemType: string; count: number }
  /** Network lifecycle phase. 24 per session - the finest timing the log offers. */
  | { type: 'connectionState'; edge: 'enter' | 'exit'; state: string }
  /** The mission had no extraction zone, so the engine assumed everyone extracted. */
  | { type: 'noExtractionZone' }
  /*
   * ── the arsenal and the modding screen ──────────────────────────────────
   * Mined from a real log (docs/research/eelog-upgrade-screen.md). The game's
   * own Lua narrates the modding screen: which slot was opened for upgrading,
   * when the card screen appears and goes, every mod installed or removed with
   * its catalogue path, the save, and the endo/credit cost of a fusion. This is
   * the deterministic alternative to reading pixels off the screen.
   */
  /** A menu screen opened or closed. `name` is the game's own screen name. */
  | { type: 'screen'; name: string; open: boolean }
  /** "Upgrade" pressed on an arsenal slot: 0 warframe · 1 primary · 2 secondary · 3 melee. */
  | { type: 'upgradeSlot'; slot: number }
  /** A mod was put on or taken off the item being modded. `itemType` is the catalogue path. */
  | { type: 'modInstalled'; name: string; itemType: string; installed: boolean }
  /**
   * A mod type the player holds duplicate copies of. NOT an on-open dump: in the
   * live log all thirty lines share one timestamp 203 s after an open, in one of
   * three visits - a mid-session duplicate-id warning. State, not a change.
   */
  | { type: 'modOwned'; itemType: string }
  /**
   * The card screen's HUD became visible (`DBG: HudVis N`), 0.5-0.8 s after it was
   * created. Show nothing before this line: the screen exists but is not drawn.
   */
  | { type: 'hudVisible'; screen: string; level: number }
  /** The loadout was saved. NOTE: no inventory write follows this; GEP is the only refresh. */
  | { type: 'loadoutSaved' }
  /** The cost the fusion dialog quoted for ranking a mod. An unstamped line. */
  | { type: 'fusionCost'; endo: number; credits: number }
  /*
   * ── the build dump ─────────────────────────────────────────────────────
   * At `close pod` after a session that changed the build, the game states the
   * installed build outright: eleven slot polarities, the item's capacity and
   * its stance/aura bonus, every installed mod with its polarity-ADJUSTED drain.
   * One stamped line and three unstamped ones; four events, correlated by the
   * consumer. It is the only ground truth of drains and slot polarities the
   * app can get without a live account push.
   */
  /** Eleven slot polarities in index order. `AP_UNIVERSAL` here is "unpolarised". */
  | { type: 'buildSlots'; polarities: string[] }
  /** The item's base capacity (its rank) and what the stance/aura adds. */
  | { type: 'buildCapacity'; initial: number; stance: string | null; stanceBonus: number | null }
  /** Capacity after the stance bonus, and every installed mod with its adjusted drain. */
  | { type: 'buildMods'; capacity: number; mods: Array<{ mod: string; drain: number }> }
  /** The trailing figure. Equals the stance drain in both observed dumps; semantics unresolved. */
  | { type: 'buildDrain'; drain: number }
);

/**
 * Strip anything that looks like an email, an IPv4 address, the account id, or
 * the machine's Windows identifiers. Belt and braces — the allowlist above is
 * what actually prevents these reaching us.
 */
export function redact(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '[ip]')
    .replace(/\bmm=[0-9A-Fa-f]{24}\b/g, 'mm=[id]')
    .replace(/(Windows (?:user|computer)-name: ).*/g, '$1[redacted]');
}

/**
 * Warframe appends a U+E000 platform marker directly to display names in some
 * lines (`AddSquadMember: <name>, mm=...`). Any capture using `(.+?)`
 * silently swallows it, so strip the whole Private Use Area.
 */
const stripPua = (s: string): string => s.replace(/[\uE000-\uF8FF]/gu, '');

/**
 * Parse one log line into an event, or null.
 *
 * Deliberately an allowlist: only these exact shapes produce output. A line that
 * is not recognised yields nothing, which is what keeps PII from leaking through
 * a future "just capture everything interesting" change.
 *
 * `captureSquadNames` gates the one pattern that can yield a third party's
 * display name. It defaults off, and the gate is here rather than downstream on
 * purpose: with it off the name is never constructed, so it cannot be logged,
 * persisted or leaked by anything further along. Squad *size* needs no name and
 * is always available.
 */
function matchLine(line: string, captureSquadNames: boolean): LogEvent | null {
  // Seconds since process start. Absent on a handful of lines; null is honest.
  const stamp = /^(\d+\.\d+) /.exec(line);
  const at = stamp?.[1] ? Number(stamp[1]) : null;

  // Sys [Info]: Logged in GermaticSpread
  //
  // Matched specifically as "Logged in", never "Logging in as", which is the
  // line carrying the account email.
  const login = /Sys \[Info\]: Logged in ([A-Za-z0-9_.-]+)/.exec(line);
  if (login?.[1]) return { at, type: 'login', username: login[1] };

  // ThemedSquadOverlay.lua: Host loading {"difficulty":1,"name":"SolNode175"}
  const start = /Host loading \{[^}]*"name"\s*:\s*"([A-Za-z0-9_]+)"/.exec(line);
  if (start?.[1]) {
    // Difficulty is a float, not an integer - observed values include 0.375.
    const diff = /"difficulty"\s*:\s*(\d+(?:\.\d+)?)/.exec(line);
    return { at, type: 'missionStart', node: start[1], difficulty: diff?.[1] ? Number(diff[1]) : 1 };
  }

  // Lobby::Host_StartMatch: launching level for SolNode167 (...)
  // Same information by a different route; useful when the host-loading line is
  // missing because the player joined as a client.
  const launching = /launching level for ([A-Za-z0-9_]+)/.exec(line);
  if (launching?.[1]) return { at, type: 'missionStart', node: launching[1], difficulty: 1 };

  // ThemedSquadOverlay.lua: Mission name: Oestrus (Eris)
  const info = /Mission name: (.+?) \(([^)]+)\)/.exec(line);
  if (info?.[1] && info[2]) return { at, type: 'missionInfo', name: info[1].trim(), planet: info[2].trim() };

  // Game [Info]: OnStateStarted, mission type=MT_PURIFY
  const type = /OnStateStarted, mission type=([A-Z_]+)/.exec(line);
  if (type?.[1]) return { at, type: 'missionType', missionType: type[1] };

  // Sys [Info]: SyncAutoPopulatedConsumables for mission MT_MASTERY with location
  // Location is empty for places that have none (a dojo), hence the null.
  const load = /SyncAutoPopulatedConsumables for mission (MT_[A-Z_]+) with location ?(.*)$/.exec(line);
  if (load?.[1]) {
    const where = load[2]?.trim() ?? '';
    return { at, type: 'missionLoad', missionType: load[1], location: where || null };
  }

  // EndOfMatch.lua: Mission Succeeded / Mission Failed
  const end = /EndOfMatch\.lua: Mission (Succeeded|Failed)/.exec(line);
  if (end?.[1]) return { at, type: 'missionEnd', success: end[1] === 'Succeeded' };

  // Net [Info]: GameRulesImpl - changing state from SS_WAITING_FOR_PLAYERS to SS_STARTED
  const state = /GameRulesImpl - changing state from (SS_[A-Z_]+) to (SS_[A-Z_]+)/.exec(line);
  if (state?.[1] && state[2]) return { at, type: 'sessionState', from: state[1], to: state[2] };

  // Sys [Info]: Loading game rules: LotusRankUpGameRules
  const rules = /Sys \[Info\]: Loading game rules: (\w+)/.exec(line);
  if (rules?.[1]) return { at, type: 'gameRules', rules: rules[1] };

  // Sys [Info]: Server ready for load [Heap: ...], sessionPlayers=1
  const players = /sessionPlayers=(\d+)/.exec(line);
  if (players?.[1]) return { at, type: 'squadSize', players: Number(players[1]) };

  // Net [Info]: AddSquadMember: <name>, mm=<24 hex>, squadCount=1
  //
  // The mm= value is a permanent cross-session account identifier. It is matched
  // so the line can be recognised and is never captured.
  const member = /AddSquadMember: (.+?), mm=[0-9A-Fa-f]{24}, squadCount=(\d+)/.exec(line);
  if (member?.[1] && member[2]) {
    return {
      at,
      type: 'squadMember',
      name: captureSquadNames ? stripPua(member[1]) : null,
      squadCount: Number(member[2]),
    };
  }

  // Net [Info]: GameRulesImpl::StartedSessionHostCallback: success: 1
  //
  // One-sided: its presence proves we hosted, its absence proves nothing (a
  // client-side join was never observed, so no client pattern is guessed at).
  const host = /GameRulesImpl::StartedSessionHostCallback: success: (\d+)/.exec(line);
  if (host?.[1]) return { at, type: 'hostSession', success: host[1] !== '0' };

  // Sys [Info]: Wall time: 2.2s (time waiting to start: 0.77s)
  const wall = /Wall time: ([\d.]+)s \(time waiting to start: ([\d.]+)s\)/.exec(line);
  if (wall?.[1] && wall[2]) {
    return { at, type: 'loadTime', seconds: Number(wall[1]), waitingSeconds: Number(wall[2]) };
  }

  // EndOfMatch.lua: <name> - IsInTrigger=true
  //
  // `.+` swallows the player name and it is deliberately not captured: whether
  // people extracted is mission data, who they are is not.
  const trigger = /EndOfMatch\.lua: .+ - IsInTrigger=(true|false)/.exec(line);
  if (trigger?.[1]) return { at, type: 'extraction', inTrigger: trigger[1] === 'true' };

  // Sys [Info]: SyndicateXP base for mission: 289
  const syn = /SyndicateXP (base for mission|post multiplier|post checkpoint amount): (\d+)/.exec(line);
  if (syn?.[1] && syn[2]) {
    const stage = syn[1] === 'base for mission' ? 'base' : syn[1] === 'post multiplier' ? 'multiplier' : 'checkpoint';
    return { at, type: 'syndicateXp', stage, amount: Number(syn[2]) };
  }

  // Game [Info]: CommitInventoryChangesToDB
  if (/Game \[Info\]: CommitInventoryChangesToDB/.test(line)) return { at, type: 'inventoryCommitted' };

  // Script [Info]: EndOfMatch.lua: DbUpdateComplete
  if (/EndOfMatch\.lua: DbUpdateComplete/.test(line)) return { at, type: 'inventoryDurable' };

  // Sys [Info]: ===[ Exiting main loop ]===...
  if (/===\[ Exiting main loop \]=/.test(line)) return { at, type: 'sessionEnd' };

  // Sys [Info]: Received non-coupon login reward
  if (/Sys \[Info\]: Received non-coupon login reward/.test(line)) return { at, type: 'dailyTribute' };

  // Sys [Info]: Player is 0.101957% towards all available items at max rank
  const mprog = /Sys \[Info\]: Player is (\d+(?:\.\d+)?)% towards all available items at max rank/.exec(line);
  if (mprog?.[1]) return { at, type: 'masteryProgress', percent: Number(mprog[1]) };

  // Sys [Info]: Player has 83700 (item based) XP
  const mxp = /Sys \[Info\]: Player has (\d+) \(item based\) XP/.exec(line);
  if (mxp?.[1]) return { at, type: 'masteryXp', xp: Number(mxp[1]) };

  // Game [Info]: Mission progress XP: 19758
  const misxp = /Game \[Info\]: Mission progress XP: (\d+)/.exec(line);
  if (misxp?.[1]) return { at, type: 'missionXp', xp: Number(misxp[1]) };

  /*
   * Sys [Info]: Consumable slot 8 - /Lotus/Types/Restoratives/Cipher: 58
   *
   * The path is inside the GAME's virtual filesystem - no drive letter, no user
   * directory - and is the same class of string the vendored item tables are
   * built from. `[^\s:]+` is one negated class, so it cannot backtrack badly.
   */
  const cons = /Sys \[Info\]: Consumable slot (\d+) - (\/Lotus\/[^\s:]+): (\d+)/.exec(line);
  if (cons?.[1] && cons[2] && cons[3]) {
    return { at, type: 'loadoutConsumable', slot: Number(cons[1]), itemType: cons[2], count: Number(cons[3]) };
  }

  // Sys [Info]: EnterState: Connected  /  ExitState: Connected
  const conn = /Sys \[Info\]: (Enter|Exit)State: (Connected|Loading|Synchronizing|Prefetching|Disconnected|Challenge)/.exec(line);
  if (conn?.[1] && conn[2]) return { at, type: 'connectionState', edge: conn[1] === 'Enter' ? 'enter' : 'exit', state: conn[2] };

  // Script [Info]: EndOfMatch.lua: extractionTrigger is nil! ...
  if (/EndOfMatch\.lua: extractionTrigger is nil!/.test(line)) return { at, type: 'noExtractionZone' };

  // Script [Info]: LoadOutRedux.lua: _T.upgradeItemSlot (_Mod): 	3
  // The `(RefreshStatList)` sibling fires on merely hovering a slot and is NOT
  // the trigger; only `(_Mod)` is the press on Upgrade. A literal TAB precedes
  // the number, hence `\s+`.
  const slot = /LoadOutRedux\.lua: _T\.upgradeItemSlot \(_Mod\):\s+(\d+)/.exec(line);
  if (slot?.[1]) return { at, type: 'upgradeSlot', slot: Number(slot[1]) };

  /*
   * Sys [Info]: Created /Lotus/Interface/DiegeticUpgradeCards.swf
   * THE UNIVERSAL OPEN. The arsenal path also logs `GoToScreen(screenName=UpgradeCards)`
   * twenty milliseconds earlier, but two of the five visits in the live log came
   * through a path with no GoToScreen and no slot line at all; this line fired on
   * all five. A consumer therefore sees two opens twenty milliseconds apart on the
   * arsenal path and one on the other, and must treat a repeat as the same open.
   */
  if (/Created \/Lotus\/Interface\/DiegeticUpgradeCards\.swf/.test(line)) {
    return { at, type: 'screen', name: 'UpgradeCards', open: true };
  }

  // Script [Info]: DiegeticUpgradeCards.lua: DBG: HudVis 1
  const vis = /(DiegeticUpgradeCards|LoadOutRedux)\.lua: DBG: HudVis (\d+)/.exec(line);
  if (vis?.[1] && vis[2]) {
    return { at, type: 'hudVisible', screen: vis[1] === 'DiegeticUpgradeCards' ? 'UpgradeCards' : 'LoadOut', level: Number(vis[2]) };
  }

  // Script [Info]: LoadOutRedux.lua: Background::GoToScreen(screenName=UpgradeCards)
  // Script [Info]: LoadOutRedux.lua: Background::ScreenOpened(screenName=LoadOut)
  // Script [Info]: Background.lua: Background::OpenScreen(screenName=MissionStats)
  const opened = /\.lua: Background::(?:GoToScreen|ScreenOpened|OpenScreen)\(screenName=([A-Za-z0-9_]+)\)/.exec(line);
  if (opened?.[1]) return { at, type: 'screen', name: opened[1], open: true };

  /*
   * Script [Info]: DiegeticUpgradeCards.lua: Background::GoToPreviousScreen(skipScreens=nil)
   * Script [Info]: LoadOutRedux.lua: Background::GoToPreviousScreen(skipScreens=1)
   * The close line does not name the screen it is leaving; the SCRIPT that
   * logged it does. DiegeticUpgradeCards is the card screen, LoadOutRedux the
   * arsenal — so the leaving script is the screen being closed.
   */
  const closed = /(DiegeticUpgradeCards|LoadOutRedux)\.lua: Background::GoToPreviousScreen\(/.exec(line);
  if (closed?.[1]) {
    return { at, type: 'screen', name: closed[1] === 'DiegeticUpgradeCards' ? 'UpgradeCards' : 'LoadOut', open: false };
  }

  /*
   * Script [Info]: DiegeticUpgradeCards.lua: mod: True Steel - installed: true (/Lotus/Upgrades/Mods/Melee/WeaponCritChanceMod)
   * The name is the game's own display name for the mod, never a player's, and
   * the path is the catalogue key. Anchored on the script so it can never match
   * `BuildLoadOut for <player>`, which fires in the same second.
   */
  const mod = /DiegeticUpgradeCards\.lua: mod: (.+?) - installed: (true|false) \((\/Lotus\/[^\s)]+)\)/.exec(line);
  if (mod?.[1] && mod[2] && mod[3]) {
    return { at, type: 'modInstalled', name: mod[1], itemType: mod[3], installed: mod[2] === 'true' };
  }

  // Script [Info]: DiegeticUpgradeCards.lua: Multiple cards of type /Lotus/Upgrades/Mods/Melee/WeaponFireDamageMod with the same ID.
  const owned = /DiegeticUpgradeCards\.lua: Multiple cards of type (\/Lotus\/[^\s]+) with the same ID\./.exec(line);
  if (owned?.[1]) return { at, type: 'modOwned', itemType: owned[1] };

  // Script [Info]: LoadOutRedux.lua: OnSaveLoadOutCompleteCommon
  if (/LoadOutRedux\.lua: OnSaveLoadOutCompleteCommon/.test(line)) return { at, type: 'loadoutSaved' };

  /*
   * Endo <FUSION_POINTS>15,330\rCredits <CREDITS>740,439
   * The fusion dialog's cost: NO timestamp, the two amounts wrapped in language
   * keys, and - as the real file has it - a bare CARRIAGE RETURN between them,
   * so the tail's newline split delivers both on one line with a \r inside.
   * The first regex had no room for that byte; the fixture matched and the
   * four real lines in the log did not. Separators are stripped so the event
   * carries numbers rather than the game's formatting.
   */
  const fusion = /Endo <FUSION_POINTS>([\d,]+)\r?Credits <CREDITS>([\d,]+)/.exec(line);
  if (fusion?.[1] && fusion[2]) {
    return { at, type: 'fusionCost', endo: Number(fusion[1].replace(/,/g, '')), credits: Number(fusion[2].replace(/,/g, '')) };
  }

  // Sys [Info]: Slots: AP_UNIVERSAL|AP_UNIVERSAL|AP_ATTACK|…|   (eleven, trailing bar)
  const slots = /Sys \[Info\]: Slots: ((?:AP_[A-Z]+\|)+)/.exec(line);
  if (slots?.[1]) return { at, type: 'buildSlots', polarities: slots[1].split('|').filter(Boolean) };

  // Initial Capacity: 30|IronPhoenixMeleeTree+4     (unstamped)
  const cap = /^Initial Capacity: (\d+)\|(?:([A-Za-z0-9_]+)\+(\d+))?/.exec(line);
  if (cap?.[1]) {
    return {
      at,
      type: 'buildCapacity',
      initial: Number(cap[1]),
      stance: cap[2] ?? null,
      stanceBonus: cap[3] !== undefined ? Number(cap[3]) : null,
    };
  }

  /*
   * Modded Capacity: 34|WeaponMeleeStatusChanceSPMod-11|WeaponMeleeDamageModExpert-7   (unstamped)
   * No `$`: the real line ends in a carriage return, `.` does not match one,
   * and an end anchor then has nothing to sit on. The fixture matched and both
   * real lines did not - the second time a stray byte has done exactly that.
   */
  const modded = /^Modded Capacity: (\d+)\|([^\r\n]*)/.exec(line);
  if (modded?.[1]) {
    const mods: Array<{ mod: string; drain: number }> = [];
    for (const part of (modded[2] ?? '').split('|')) {
      const m = /^([A-Za-z0-9_]+)-(\d+)$/.exec(part.trim());
      if (m?.[1] && m[2]) mods.push({ mod: m[1], drain: Number(m[2]) });
    }
    return { at, type: 'buildMods', capacity: Number(modded[1]), mods };
  }

  // Final Mod Drain: 4     (unstamped)
  const fin = /^Final Mod Drain: (\d+)/.exec(line);
  if (fin?.[1]) return { at, type: 'buildDrain', drain: Number(fin[1]) };

  return null;
}

/**
 * Redact every string in a parsed event, however deeply it sits.
 *
 * The allowlist is what actually keeps PII out, and this is the second line
 * that the file header has always promised. It is applied to the whole event
 * rather than to chosen fields because the fields that need it are exactly the
 * ones nobody predicted: three patterns capture free text - `Mission name:
 * (.+?)`, `with location (.*)$` and `mod: (.+?)` - and a fourth is added every
 * time the log turns out to say something new. A per-field call would have to
 * be remembered at each of those; a walk over the returned object cannot be
 * forgotten.
 *
 * Numbers and booleans are returned untouched, and `redact` leaves ordinary
 * content alone - `SolNode167`, `/Lotus/Upgrades/Mods/...` and `MT_PURIFY` all
 * come back identical, which the gate pins.
 */
function scrub<T>(v: T): T {
  if (typeof v === 'string') return redact(v) as T;
  if (Array.isArray(v)) return v.map(scrub) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = scrub(x);
    return out as T;
  }
  return v;
}

/**
 * THE MODULE'S SINGLE EXIT.
 *
 * `matchLine` does the recognising; this does the one thing that has to be true
 * of everything it produces. Keeping them apart is what makes the header's
 * promise checkable: there is one place where a parsed event becomes visible to
 * the rest of the app, and it redacts.
 */
export function parseLine(line: string, captureSquadNames = false): LogEvent | null {
  const event = matchLine(line, captureSquadNames);
  return event && scrub(event);
}

/** Syndicate standing earned, before and after the multiplier and the daily cap. */
export interface SyndicateXp {
  base: number;
  afterMultiplier: number;
  /** Below `afterMultiplier` means the player has hit their daily standing cap. */
  afterCheckpoint: number;
}

/** A completed run, assembled from the event sequence. */
export interface MissionRun {
  /** SolNode id, or a junction tag. Joins to the vendored star chart. */
  node: string | null;
  name: string | null;
  planet: string | null;
  missionType: string | null;
  /** Scaling factor the game reports at load. A float - 0.375 and 1 both occur. */
  difficulty: number;
  success: boolean;
  /** True when the session tore down with no end-of-match screen: abort or drop. */
  aborted: boolean;
  /** Location reported at load. Empty for places that have none, e.g. a dojo. */
  location: string | null;
  /** Game-rules class, e.g. `LotusRankUpGameRules`. Front-end rules mean no mission. */
  gameRules: string | null;
  squadSize: number | null;
  /** True if we hosted. Null means unknown — there is no explicit "client" line. */
  isHost: boolean | null;
  /** How many players were in the extraction trigger, of how many reported. */
  extraction: { inTrigger: number; total: number } | null;
  /** Gameplay seconds: SS_STARTED to the outcome line. Excludes the results screen. */
  durationSeconds: number | null;
  /** Seconds the level took to load. Not mission time. */
  loadSeconds: number | null;
  /** Wall clock of the outcome, ms since epoch, from the tail's own anchor. */
  endedAtMs: number | null;
  syndicateXp: SyndicateXp | null;
  /** Only populated when squad-name capture was explicitly opted into. */
  squad: string[] | null;
}

/**
 * Assemble mission runs from a stream of events.
 *
 * The log interleaves: the node id arrives at load, the display name and mission
 * type once the level starts, the outcome at the end — and then keeps going. In
 * the real capture the extraction flags land 3 ms after `Mission Succeeded`, the
 * syndicate standing 4 ms after, and the inventory write 240 ms after that. So a
 * run that has a session bracket is emitted at teardown (SS_ENDING), not at the
 * outcome line, or all of that would be dropped.
 *
 * `now` exists so the wall-clock anchor is testable without a real clock.
 */
export class MissionTracker {
  private current: Partial<MissionRun> = {};
  private syn: Partial<SyndicateXp> = {};
  private inTrigger = 0;
  private triggerTotal = 0;
  /**
   * The engine said it had no extraction zone and was assuming everyone stood
   * in one. The flags that follow are therefore fabricated, and reporting them
   * as `{inTrigger: 1, total: 1}` states a clean extraction that never happened.
   */
  private extractionAssumed = false;
  private squad: string[] = [];
  private startedAt: number | null = null;
  private endedAt: number | null = null;
  /** Outcome from the end-of-match screen; null means none ran, i.e. an abort. */
  private outcome: boolean | null = null;
  /** SS_STARTED seen — a real session bracket exists and will close itself. */
  private live = false;
  private lastUser: string | null = null;
  private anchorMs: number | null = null;
  private lastT = 0;

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get username(): string | null {
    return this.lastUser;
  }

  /** Feed one event. Returns a finished run when one completes, else null. */
  push(e: LogEvent): MissionRun | null {
    this.anchor(e.at);

    switch (e.type) {
      case 'login':
        this.lastUser = e.username;
        return null;
      // The mission-shaped cases below only ever SET fields. Nothing clears the
      // partial run except a terminator (`missionEnd`, or the abort inference in
      // `sessionState`), which makes the tracker independent of the order the
      // lines happen to arrive in.
      //
      // That matters: in a live log `Mission name` precedes `Host loading`, and
      // an earlier version of this cleared the run on start - which silently
      // dropped the name from every single mission. Clearing on either line is a
      // bet on ordering, and there is no reason to place that bet. An abandoned
      // mission is simply overwritten by the next mission's own lines.
      case 'missionStart':
        this.current.node = e.node;
        this.current.difficulty = e.difficulty;
        return null;
      case 'missionInfo':
        this.current.name = e.name;
        this.current.planet = e.planet;
        return null;
      case 'missionType':
        this.current.missionType = e.missionType;
        return null;
      case 'missionLoad':
        this.current.missionType = e.missionType;
        if (e.location) this.current.location = e.location;
        return null;
      case 'gameRules':
        this.current.gameRules = e.rules;
        return null;
      case 'squadSize':
        // Reads 0 on the return-to-orbiter load, which is never a real squad.
        if (e.players > 0) this.current.squadSize = e.players;
        return null;
      case 'squadMember':
        // squadCount is a second witness for squad size, deliberately not merged
        // with sessionPlayers: the two fire at different points and picking a
        // winner would be an ordering bet. Names arrive only when opted in.
        if (e.name && !this.squad.includes(e.name)) this.squad.push(e.name);
        return null;
      case 'hostSession':
        this.current.isHost = e.success;
        return null;
      case 'loadTime':
        this.current.loadSeconds = e.seconds;
        return null;
      case 'extraction':
        this.triggerTotal++;
        if (e.inTrigger) this.inTrigger++;
        return null;
      case 'syndicateXp':
        if (e.stage === 'base') this.syn.base = e.amount;
        else if (e.stage === 'multiplier') this.syn.afterMultiplier = e.amount;
        else this.syn.afterCheckpoint = e.amount;
        return null;
      case 'sessionState':
        if (e.to === 'SS_STARTED') {
          this.live = true;
          this.startedAt = e.at;
          return null;
        }
        // Teardown closes the run. If no end-of-match screen ran, that is the
        // abort: the log contains no abort line at all ("abort" is zero hits
        // across a whole session), so this structural inference is the only
        // signal there is - and it is a sound one, since EndOfMatch.lua only
        // initialises on a real results screen.
        if (this.live && (e.to === 'SS_ENDING' || e.to === 'SS_ENDED')) return this.finish(e.at);
        return null;
      case 'sessionEnd':
        // Game closed mid-mission: close the run rather than leaving it dangling.
        return this.live ? this.finish(e.at) : null;
      case 'missionEnd':
        this.outcome = e.success;
        this.endedAt = e.at;
        // Wait for teardown so the lines that follow the outcome (extraction,
        // syndicate standing, the inventory write) still land on this run. With
        // no session bracket there is nothing to wait for, so emit at once -
        // which is also what preserves the pre-state-machine behaviour.
        return this.live ? null : this.finish(e.at);
      /*
       * The mission had no extraction zone at all, so the engine assumed
       * everyone was in it. Without this the run reports `extraction {1, 1}` -
       * which reads as a clean extraction and is the engine saying it made the
       * number up. Recorded on the run so `toRecord` can decline to claim it.
       */
      case 'noExtractionZone':
        this.extractionAssumed = true;
        return null;
      // These carry nothing the RUN needs; consumers watch them via `onEvent`,
      // which fires before this and therefore before any run is emitted.
      case 'inventoryCommitted':
      case 'inventoryDurable':
      case 'dailyTribute':
      case 'masteryProgress':
      case 'masteryXp':
      case 'missionXp':
      case 'loadoutConsumable':
      case 'connectionState':
      // The arsenal is not a mission. Consumers watch these via `onEvent`.
      case 'screen':
      case 'upgradeSlot':
      case 'modInstalled':
      case 'modOwned':
      case 'loadoutSaved':
      case 'fusionCost':
      case 'hudVisible':
      case 'buildSlots':
      case 'buildCapacity':
      case 'buildMods':
      case 'buildDrain':
        return null;
    }
  }

  /**
   * Wall clock without reading the log's dated header line, which sits inside
   * the `Sys [Diag]` block next to the Windows user and machine name. The first
   * timestamp seen fixes process start; every later one derives from it.
   *
   * Relaunching Warframe truncates the log and restarts the clock at zero, so a
   * timestamp going backwards re-anchors.
   */
  private anchor(at: number | null): void {
    if (at === null) return;
    if (this.anchorMs === null || at < this.lastT) this.anchorMs = this.now() - at * 1000;
    this.lastT = at;
  }

  /** `at` is the terminator's timestamp, used only if no outcome line was seen. */
  private finish(at: number | null): MissionRun {
    const syn = this.syn;
    // Time the run by the outcome line, not the teardown: the gap between them
    // is the end-of-match screen, which is not gameplay.
    const endAt = this.endedAt ?? at;
    const run: MissionRun = {
      node: this.current.node ?? null,
      name: this.current.name ?? null,
      planet: this.current.planet ?? null,
      missionType: this.current.missionType ?? null,
      difficulty: this.current.difficulty ?? 1,
      success: this.outcome ?? false,
      aborted: this.outcome === null,
      location: this.current.location ?? null,
      gameRules: this.current.gameRules ?? null,
      squadSize: this.current.squadSize ?? null,
      isHost: this.current.isHost ?? null,
      // Null, not a number, when the engine admitted it made the flags up: an
      // unmeasured extraction is unknown, and the app's whole doctrine is that
      // unknown is not a value.
      extraction:
        this.extractionAssumed || this.triggerTotal === 0
          ? null
          : { inTrigger: this.inTrigger, total: this.triggerTotal },
      durationSeconds:
        this.startedAt !== null && endAt !== null ? Number((endAt - this.startedAt).toFixed(3)) : null,
      loadSeconds: this.current.loadSeconds ?? null,
      endedAtMs: this.anchorMs !== null && endAt !== null ? Math.round(this.anchorMs + endAt * 1000) : null,
      // The multiplier and checkpoint lines always follow the base one, but fall
      // back rather than drop the number if the log ever truncates between them.
      syndicateXp:
        syn.base === undefined
          ? null
          : {
              base: syn.base,
              afterMultiplier: syn.afterMultiplier ?? syn.base,
              afterCheckpoint: syn.afterCheckpoint ?? syn.afterMultiplier ?? syn.base,
            },
      squad: this.squad.length > 0 ? [...this.squad] : null,
    };

    this.current = {};
    this.syn = {};
    this.inTrigger = 0;
    this.triggerTotal = 0;
    // Per-run, like the two above. Left set, one zoneless mission would make
    // every later run report an unknown extraction it had actually measured.
    this.extractionAssumed = false;
    this.squad = [];
    this.startedAt = null;
    this.endedAt = null;
    this.outcome = null;
    this.live = false;
    return run;
  }
}

export interface TailOptions {
  onLogin?: (username: string) => void;
  /**
   * Every parsed event, for consumers that need a signal the assembled run
   * cannot carry — chiefly `inventoryDurable`, which is when the account
   * snapshot for the loot diff should be taken.
   */
  onEvent?: (event: LogEvent) => void;
  /**
   * Capture other players' display names into `MissionRun.squad`. Off by
   * default: squadmates are third parties who have not consented to this app
   * storing them, and a mission history needs "3-player squad", not a roster.
   */
  captureSquadNames?: boolean;
}

/**
 * Tail EE.log, emitting assembled runs.
 *
 * `skipToEnd` means only activity from now on is reported — the app never reads
 * the historical log, which both respects the privacy note above and avoids
 * replaying months of old missions on every launch. It also skips the `Sys
 * [Diag]` header block, which is pure machine fingerprinting.
 */
export function tailEeLog(onRun: (run: MissionRun) => void, options: TailOptions = {}): () => void {
  // Outside Overwolf there is no file API at all. Returning an inert unsubscribe
  // keeps every caller's teardown path identical rather than making each one
  // branch on the host.
  if (!ow) return () => {};
  // Captured into a local so the null check narrows inside the callbacks below:
  // TypeScript will not carry a narrowing on an imported binding across a
  // function boundary.
  const io = ow.io;

  const id = 'codex-ee-log';
  const path = `${io.paths.localAppData}\\Warframe\\EE.log`;
  const tracker = new MissionTracker();

  // UTF8 explicitly: node names carry non-ASCII characters (Stöfler, Kiliken),
  // and reading them as ANSI mangles the name the panel would display.
  const ioOptions: overwolf.io.ListenFileOptions = {
    skipToEnd: true,
    encoding: 'UTF8' as overwolf.io.enums.eEncoding,
  };

  /*
   * THE LISTENER MUST COME BACK.
   *
   * `listenOnFile` reports a failure by calling back with `success: false`, and
   * at that point it has STOPPED. The old code logged and returned, so any
   * transient condition - Warframe truncating EE.log on a relaunch, the file
   * briefly locked, a read error - ended the tail permanently for that session,
   * silently.
   *
   * That cost more than the live mission feed. `inventoryDurable` is parsed from
   * this stream, and it is the ONLY thing that triggers `gep.refresh` after a
   * run. With the tail dead the app kept showing whatever the last push had
   * said, for the rest of the session, with nothing on screen to suggest the
   * numbers had stopped moving.
   *
   * So it re-establishes with backoff. `skipToEnd` means the lines written while
   * we were down are not recovered - the app never replays history, by design
   * and for the privacy reason at the top of this file - but the stream resumes
   * and the next mission is seen.
   */
  const RESTARTS = 6;
  let restarts = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const listen = (): void => {
    if (stopped) return;
    io.listenOnFile(id, path, ioOptions, (result) => {
      const r = result as { success?: boolean; content?: string; error?: string };
      if (!r.success) {
        if (stopped) return;
        if (r.error) console.warn('[eelog] listener stopped:', redact(r.error));
        if (++restarts > RESTARTS) {
          console.warn('[eelog] giving up on the log tail; live mission progress is off for this session');
          return;
        }
        // 1s, 2s, 4s, 8s, 16s, 32s. A relaunch truncation resolves in the first
        // one or two; a missing file exhausts the budget and stops.
        timer = setTimeout(listen, 1_000 * 2 ** (restarts - 1));
        return;
      }
      // A successful read means the stream is healthy again.
      restarts = 0;
      if (!r.content) return;

      const event = parseLine(r.content, options.captureSquadNames);
      if (!event) return;

      if (event.type === 'login' && options.onLogin) options.onLogin(redact(event.username));
      options.onEvent?.(event);
      const run = tracker.push(event);
      if (run) onRun(run);
    });
  };

  listen();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    io.stopFileListener(id);
  };
}
