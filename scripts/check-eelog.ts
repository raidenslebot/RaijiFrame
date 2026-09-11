/**
 * Self-check for the EE.log parser.
 *
 * Line samples are the real shapes taken from a live log, with every PII-bearing
 * value reproduced synthetically — the format is what matters and the real ones
 * must never enter this repo. That covers the account email, the machine IP, the
 * Windows user/computer name, the 24-hex account id and player display names.
 *
 * The most important assertion here is `neverLeaksTheEmailLine`. The login line
 * `Logging in as <email>` sits three lines above the harmless `Logged in <name>`
 * line, and a lazier regex would match both.
 *
 * Run: node scripts/check-eelog.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLine, redact, MissionTracker, type LogEvent, type MissionRun } from '../src/core/eelog.ts';

/** Real line shapes, verbatim except for substituted personal data. */
const LINES = {
  loggingIn: '16.889 Sys [Info]: Logging in as someone@example.com',
  loggedIn: '17.237 Sys [Info]: Logged in GermaticSpread',
  hostLoading:
    '3874.427 Script [Info]: ThemedSquadOverlay.lua: Host loading {"difficulty":1,"name":"SolNode167"} with MissionInfo: ',
  launching:
    '3874.427 Script [Info]: ThemedSquadOverlay.lua: Lobby::Host_StartMatch: launching level for SolNode175 (/Lotus/Levels/Proc/Infestation/InfestedCorpusShipPurify)',
  missionName: '3874.427 Script [Info]: ThemedSquadOverlay.lua: Mission name: Oestrus (Eris)',
  junctionName: '3874.427 Script [Info]: ThemedSquadOverlay.lua: Mission name: ERIS JUNCTION (Pluto)',
  missionType: '3878.009 Game [Info]: OnStateStarted, mission type=MT_PURIFY',
  junctionType: '3878.009 Game [Info]: OnStateStarted, mission type=MT_JUNCTION',
  succeeded: '4100.100 Script [Info]: EndOfMatch.lua: Mission Succeeded',
  failed: '4100.100 Script [Info]: EndOfMatch.lua: Mission Failed',
  noise: '5276.950 Sys [Info]: Resource load completed 0x0000022C250B5190 (12 root types)',

  // Newly mined shapes, all copied from a real capture.
  syncConsumables: '56.424 Sys [Info]: SyncAutoPopulatedConsumables for mission MT_MASTERY with location ',
  syncWithLocation: '56.424 Sys [Info]: SyncAutoPopulatedConsumables for mission MT_EXTERMINATION with location Earth',
  frontEndRules: '9.594 Sys [Info]: Loading game rules: AlternateLotusFrontEndGameRules',
  missionRules: '56.238 Sys [Info]: Loading game rules: LotusRankUpGameRules',
  stateStarted: '56.910 Net [Info]: GameRulesImpl - changing state from SS_WAITING_FOR_PLAYERS to SS_STARTED',
  stateEnding: '167.504 Net [Info]: GameRulesImpl - changing state from SS_STARTED to SS_ENDING',
  stateEnded: '167.504 Net [Info]: GameRulesImpl - changing state from SS_ENDING to SS_ENDED',
  serverReady:
    '53.899 Sys [Info]: Server ready for load [Heap: 701,568,544/873,070,592 Footprint: 3,487,522,816 Handles: 1,358], sessionPlayers=1',
  serverReadyOrbiter:
    '167.723 Sys [Info]: Server ready for load [Heap: 486,650,816/865,206,272 Footprint: 2,902,446,080 Handles: 1,321], sessionPlayers=0',
  addSquadMember: '53.901 Net [Info]: AddSquadMember: SomePlayer, mm=AAAAAAAAAAAAAAAAAAAAAAAA, squadCount=1',
  // The real log appends a U+E000 platform marker straight onto the name.
  addSquadMemberPua: '53.901 Net [Info]: AddSquadMember: SomePlayer\uE000, mm=AAAAAAAAAAAAAAAAAAAAAAAA, squadCount=2',
  hostCallback: '56.374 Net [Info]: GameRulesImpl::StartedSessionHostCallback: success: 1',
  wallTime: '56.109 Sys [Info]: Wall time: 2.2s (time waiting to start: 0.77s)',
  inTrigger: '164.960 Script [Info]: EndOfMatch.lua: SomePlayer - IsInTrigger=true',
  notInTrigger: '164.960 Script [Info]: EndOfMatch.lua: SomePlayer - IsInTrigger=false',
  synBase: '164.961 Sys [Info]: SyndicateXP base for mission: 289',
  synMultiplier: '164.961 Sys [Info]: SyndicateXP post multiplier: 578',
  synCheckpoint: '164.961 Sys [Info]: SyndicateXP post checkpoint amount: 400',
  commitInventory: '164.961 Game [Info]: CommitInventoryChangesToDB',
  dbUpdateComplete: '165.201 Script [Info]: EndOfMatch.lua: DbUpdateComplete',
  exitingMainLoop:
    '3389.376 Sys [Info]: ===[ Exiting main loop ]====================================================================================',

  // Re-stamped onto the real capture's timeline so a full run can be replayed
  // with monotonic timestamps, which is what the wall-clock anchor assumes.
  runName: '53.905 Script [Info]: ThemedSquadOverlay.lua: Mission name: Oestrus (Eris)',
  runHostLoading:
    '53.910 Script [Info]: ThemedSquadOverlay.lua: Host loading {"difficulty":1,"name":"SolNode167"} with MissionInfo: ',
  runType: '56.920 Game [Info]: OnStateStarted, mission type=MT_PURIFY',
  runSucceeded: '164.957 Script [Info]: EndOfMatch.lua: Mission Succeeded',

  // Must never produce an event.
  windowsUser: '0.010 Sys [Diag]: Windows user-name: SomeUser',
  windowsComputer: '0.010 Sys [Diag]: Windows computer-name: SOMEPC',
  natBound: '163.781 Net [Info]: NAT bound for server to 203.0.113.7:4950',

  /*
   * The seven added after the second log survey. Every one is quoted from the
   * 4,738-line capture in docs/research/eelog-mining.md, and every one was
   * checked for a name, an email, an account id, an IP and a machine path
   * before it was added. The `/Lotus/` path below is inside the GAME's virtual
   * filesystem - no drive letter, no user directory - and is the same class of
   * string the vendored item tables are built from.
   */
  dailyTribute: '3172.739 Sys [Info]: Received non-coupon login reward',
  masteryProgress: '58.221 Sys [Info]: Player is 0.101957% towards all available items at max rank',
  masteryXp: '58.220 Sys [Info]: Player has 83700 (item based) XP',
  missionXp: '58.219 Game [Info]: Mission progress XP: 19758',
  loadoutConsumable: '56.428 Sys [Info]: Consumable slot 8 - /Lotus/Types/Restoratives/Cipher: 58',
  connectionState: '43.101 Sys [Info]: EnterState: Connected',
  connectionExit: '167.900 Sys [Info]: ExitState: Connected',
  noExtractionZone:
    '164.900 Script [Info]: EndOfMatch.lua: extractionTrigger is nil! Assuming that all players are touching by default.',

  /*
   * The modding screen, from a real log (docs/research/eelog-upgrade-screen.md).
   * `upgradeSlot` carries a literal TAB before the number, as the game writes it.
   * `buildLoadOut` fires in the SAME SECOND as the upgrade lines and carries the
   * player name; it exists here to be asserted null.
   */
  upgradeSlot: '5958.259 Script [Info]: LoadOutRedux.lua: _T.upgradeItemSlot (_Mod): \t3',
  upgradeSlotHover: '5957.760 Script [Info]: LoadOutRedux.lua: _T.upgradeItemSlot (RefreshStatList): \t3',
  upgradeCardsOpen: '5958.275 Script [Info]: LoadOutRedux.lua: Background::GoToScreen(screenName=UpgradeCards)',
  upgradeCardsClose: '6020.500 Script [Info]: DiegeticUpgradeCards.lua: Background::GoToPreviousScreen(skipScreens=nil)',
  arsenalOpen: '6372.535 Script [Info]: LoadOutRedux.lua: Background::ScreenOpened(screenName=LoadOut)',
  arsenalClose: '6700.100 Script [Info]: LoadOutRedux.lua: Background::GoToPreviousScreen(skipScreens=1)',
  modInstalled:
    '5990.101 Script [Info]: DiegeticUpgradeCards.lua: mod: True Steel - installed: true (/Lotus/Upgrades/Mods/Melee/WeaponCritChanceMod)',
  modRemoved:
    '5990.102 Script [Info]: DiegeticUpgradeCards.lua: mod: Pressure Point - installed: false (/Lotus/Upgrades/Mods/Melee/WeaponMeleeDamageMod)',
  modOwned:
    '5958.552 Script [Info]: DiegeticUpgradeCards.lua: Multiple cards of type /Lotus/Upgrades/Mods/Melee/WeaponFireDamageMod with the same ID.',
  loadoutSaved: '6020.864 Script [Info]: LoadOutRedux.lua: OnSaveLoadOutCompleteCommon',
  // The real byte: a carriage return between the amounts. A fixture without it passed while the log did not.
  fusionCost: 'Endo <FUSION_POINTS>15,330\rCredits <CREDITS>740,439',
  /*
   * THE UNIVERSAL OPEN. Two of the five real visits in the live log came through a
   * non-arsenal path that emits no `_Mod` slot line and no GoToScreen; this
   * `Created` line fired on all five. `HudVis` follows 0.5-0.8 s later and is
   * the first moment the screen is actually visible.
   */
  upgradeCardsCreated: '1950.165 Sys [Info]: Created /Lotus/Interface/DiegeticUpgradeCards.swf',
  upgradeCardsVisible: '1950.682 Script [Info]: DiegeticUpgradeCards.lua: DBG: HudVis 1',
  // The build dump: one stamped line, three unstamped continuations. From the live log.
  buildSlots:
    '6695.781 Sys [Info]: Slots: AP_UNIVERSAL|AP_UNIVERSAL|AP_UNIVERSAL|AP_ATTACK|AP_UNIVERSAL|AP_UNIVERSAL|AP_TACTIC|AP_ATTACK|AP_ATTACK|AP_UNIVERSAL|AP_UNIVERSAL|',
  buildCapacity: 'Initial Capacity: 30|IronPhoenixMeleeTree+4',
  // Trailing \r, as the real file has it: the first regex ended in `$` and matched neither real line.
  buildMods:
    'Modded Capacity: 34|WeaponMeleeStatusChanceSPMod-11|WeaponMeleeDamageModExpert-7|WeaponSlashDamageMod-7|AshenMandibleMod-5|WeaponCritChanceSPMod-6\r',
  buildDrain: 'Final Mod Drain: 4',
  buildLoadOut: '6372.550 Sys [Info]: BuildLoadOut for SomePlayer',
  sendLoadOut: '6020.864 Sys [Info]: LotusHumanPlayer::SendLoadOut: SomePlayer loadout received',
};

/** Feed lines through a tracker, returning the last run it emitted. */
function feed(lines: string[], tracker = new MissionTracker()): MissionRun | null {
  let run: MissionRun | null = null;
  for (const l of lines) {
    const e = parseLine(l);
    if (e) run = tracker.push(e) ?? run;
  }
  return run;
}

function neverLeaksTheEmailLine() {
  const parsed = parseLine(LINES.loggingIn);
  assert.equal(parsed, null, 'the "Logging in as <email>" line must never produce an event');

  // And prove it isn't accidentally caught by the username pattern.
  const asEvent = parseLine(LINES.loggingIn) as { username?: string } | null;
  assert.ok(!asEvent?.username?.includes('@'), 'no email may ever reach a username field');
}

function neverLeaksMachineOrAccountIdentifiers() {
  assert.equal(parseLine(LINES.windowsUser), null, 'the Windows user name must never produce an event');
  assert.equal(parseLine(LINES.windowsComputer), null, 'the machine name must never produce an event');
  assert.equal(parseLine(LINES.natBound), null, 'the NAT/IP line must never produce an event');

  // AddSquadMember is parsed, so prove the account id never rides along on it.
  const e = parseLine(LINES.addSquadMember, true);
  assert.equal(JSON.stringify(e).includes('AAAAAAAAAAAAAAAAAAAAAAAA'), false, 'the mm= account id must never be captured');
}

/**
 * THE HEADER'S PROMISE, CHECKED AT THE EXIT RATHER THAN AT THE PATTERNS.
 *
 * eelog.ts has always said `redact` is applied to every string that escapes the
 * module. It was not: two call sites, neither of them the parser, and three
 * patterns that capture free text - the mission name, the load location and the
 * mod name - handed their captures straight to the consumer. Every one of those
 * three is a place a future log line could put something nobody predicted, and
 * `missionInfo.name` is persisted with the run.
 *
 * So this drives the three loose captures with the PII the header names, and
 * pins that ordinary content comes back byte-identical - a redaction that
 * mangles a SolNode id or a catalogue path would be worse than none, because
 * the joins to the star chart and the mod catalogue would fail silently.
 */
function everyStringLeavingTheParserIsRedacted() {
  const mission = parseLine('12.345 ThemedSquadOverlay.lua: Mission name: someone@example.com (Eris)');
  assert.equal(mission?.type, 'missionInfo');
  assert.equal((mission as { name: string }).name, '[email]', 'the mission name capture is free text and reaches the stored run unredacted');

  const load = parseLine('12.345 Sys [Info]: SyncAutoPopulatedConsumables for mission MT_MASTERY with location 192.168.1.44');
  assert.equal(load?.type, 'missionLoad');
  assert.equal((load as { location: string }).location, '[ip]', 'the location capture runs to end of line and is not redacted');

  const mod = parseLine(
    '12.345 Script [Info]: DiegeticUpgradeCards.lua: mod: someone@example.com - installed: true (/Lotus/Upgrades/Mods/Melee/WeaponCritChanceMod)',
  );
  assert.equal(mod?.type, 'modInstalled');
  assert.equal((mod as { name: string }).name, '[email]', 'the mod name capture is free text and is not redacted');
  assert.equal(
    (mod as { itemType: string }).itemType,
    '/Lotus/Upgrades/Mods/Melee/WeaponCritChanceMod',
    'redaction mangled a catalogue path, which would break the mod join with nothing to say why',
  );

  // Ordinary content, unchanged. These are the joins the app is built on.
  const start = parseLine('12.345 ThemedSquadOverlay.lua: Host loading {"difficulty":1,"name":"SolNode175"}');
  assert.equal((start as { node: string }).node, 'SolNode175', 'redaction mangled a node id');
  const type = parseLine('12.345 Game [Info]: OnStateStarted, mission type=MT_PURIFY');
  assert.equal((type as { missionType: string }).missionType, 'MT_PURIFY', 'redaction mangled a mission type');

  // And it must reach INTO the event, not just across its top level: an array of
  // objects has to come back with its contents, not emptied or stringified.
  const mods = parseLine('Modded Capacity: 34|WeaponMeleeStatusChanceSPMod-11|WeaponMeleeDamageModExpert-7');
  assert.deepEqual(
    (mods as { mods: Array<{ mod: string; drain: number }> }).mods,
    [
      { mod: 'WeaponMeleeStatusChanceSPMod', drain: 11 },
      { mod: 'WeaponMeleeDamageModExpert', drain: 7 },
    ],
    'the build dump lost its mods on the way out of the parser',
  );
}

function redactionStripsPii() {
  assert.equal(redact('Logging in as someone@example.com'), 'Logging in as [email]');
  assert.equal(redact('connected to 192.168.1.44 ok'), 'connected to [ip] ok');
  assert.equal(redact('AddSquadMember: X, mm=AAAAAAAAAAAAAAAAAAAAAAAA, squadCount=1'), 'AddSquadMember: X, mm=[id], squadCount=1');
  assert.equal(redact('Sys [Diag]: Windows user-name: SomeUser'), 'Sys [Diag]: Windows user-name: [redacted]');
  assert.equal(redact('Sys [Diag]: Windows computer-name: SOMEPC'), 'Sys [Diag]: Windows computer-name: [redacted]');
  assert.equal(redact('SolNode167'), 'SolNode167', 'redaction must not mangle ordinary content');
}

function parsesLogin() {
  assert.deepEqual(parseLine(LINES.loggedIn), { at: 17.237, type: 'login', username: 'GermaticSpread' });
}

function parsesNodeFromHostLoading() {
  assert.deepEqual(parseLine(LINES.hostLoading), {
    at: 3874.427,
    type: 'missionStart',
    node: 'SolNode167',
    difficulty: 1,
  });
}

function parsesNodeFromLaunching() {
  // The client-side route, used when the host-loading line is absent.
  assert.deepEqual(parseLine(LINES.launching), {
    at: 3874.427,
    type: 'missionStart',
    node: 'SolNode175',
    difficulty: 1,
  });
}

function parsesMissionInfo() {
  assert.deepEqual(parseLine(LINES.missionName), {
    at: 3874.427,
    type: 'missionInfo',
    name: 'Oestrus',
    planet: 'Eris',
  });
  assert.deepEqual(parseLine(LINES.junctionName), {
    at: 3874.427,
    type: 'missionInfo',
    name: 'ERIS JUNCTION',
    planet: 'Pluto',
  });
}

function parsesTypeAndOutcome() {
  assert.deepEqual(parseLine(LINES.missionType), { at: 3878.009, type: 'missionType', missionType: 'MT_PURIFY' });
  assert.deepEqual(parseLine(LINES.junctionType), { at: 3878.009, type: 'missionType', missionType: 'MT_JUNCTION' });
  assert.deepEqual(parseLine(LINES.succeeded), { at: 4100.1, type: 'missionEnd', success: true });
  assert.deepEqual(parseLine(LINES.failed), { at: 4100.1, type: 'missionEnd', success: false });
}

function capturesTimestamps() {
  const e = parseLine(LINES.stateStarted);
  assert.equal(e?.at, 56.91, 'the seconds-since-start prefix must be captured');
  // 14 lines in a real capture carry no prefix at all; null, never a guess.
  const noStamp = parseLine('Sys [Info]: Logged in GermaticSpread');
  assert.equal(noStamp?.at, null);
}

function parsesSessionStates() {
  assert.deepEqual(parseLine(LINES.stateStarted), {
    at: 56.91,
    type: 'sessionState',
    from: 'SS_WAITING_FOR_PLAYERS',
    to: 'SS_STARTED',
  });
  assert.deepEqual(parseLine(LINES.stateEnding), {
    at: 167.504,
    type: 'sessionState',
    from: 'SS_STARTED',
    to: 'SS_ENDING',
  });
}

function parsesMissionLoad() {
  // The location field is empty for a dojo — empty must mean null, not "".
  assert.deepEqual(parseLine(LINES.syncConsumables), {
    at: 56.424,
    type: 'missionLoad',
    missionType: 'MT_MASTERY',
    location: null,
  });
  assert.deepEqual(parseLine(LINES.syncWithLocation), {
    at: 56.424,
    type: 'missionLoad',
    missionType: 'MT_EXTERMINATION',
    location: 'Earth',
  });
}

function parsesGameRules() {
  assert.deepEqual(parseLine(LINES.frontEndRules), {
    at: 9.594,
    type: 'gameRules',
    rules: 'AlternateLotusFrontEndGameRules',
  });
  assert.deepEqual(parseLine(LINES.missionRules), { at: 56.238, type: 'gameRules', rules: 'LotusRankUpGameRules' });
}

function parsesSquadSignals() {
  assert.deepEqual(parseLine(LINES.serverReady), { at: 53.899, type: 'squadSize', players: 1 });
  assert.deepEqual(parseLine(LINES.serverReadyOrbiter), { at: 167.723, type: 'squadSize', players: 0 });

  // Names are off by default: squad size is mission data, a roster is not.
  assert.deepEqual(parseLine(LINES.addSquadMember), { at: 53.901, type: 'squadMember', name: null, squadCount: 1 });
  assert.deepEqual(parseLine(LINES.addSquadMember, true), {
    at: 53.901,
    type: 'squadMember',
    name: 'SomePlayer',
    squadCount: 1,
  });
  // The U+E000 platform marker must not survive into a captured name.
  const pua = parseLine(LINES.addSquadMemberPua, true) as { name?: string } | null;
  assert.equal(pua?.name, 'SomePlayer', 'the Private Use Area marker must be stripped');
}

function parsesHostAndTiming() {
  assert.deepEqual(parseLine(LINES.hostCallback), { at: 56.374, type: 'hostSession', success: true });
  assert.deepEqual(parseLine(LINES.wallTime), { at: 56.109, type: 'loadTime', seconds: 2.2, waitingSeconds: 0.77 });
}

function parsesExtractionAndSyndicateXp() {
  assert.deepEqual(parseLine(LINES.inTrigger), { at: 164.96, type: 'extraction', inTrigger: true });
  assert.deepEqual(parseLine(LINES.notInTrigger), { at: 164.96, type: 'extraction', inTrigger: false });
  // The player name on that line must never be captured.
  assert.equal(JSON.stringify(parseLine(LINES.inTrigger)).includes('SomePlayer'), false);

  assert.deepEqual(parseLine(LINES.synBase), { at: 164.961, type: 'syndicateXp', stage: 'base', amount: 289 });
  assert.deepEqual(parseLine(LINES.synMultiplier), {
    at: 164.961,
    type: 'syndicateXp',
    stage: 'multiplier',
    amount: 578,
  });
  assert.deepEqual(parseLine(LINES.synCheckpoint), {
    at: 164.961,
    type: 'syndicateXp',
    stage: 'checkpoint',
    amount: 400,
  });
}

function parsesInventoryDiffTriggers() {
  // These two are the whole reason loot attribution can be exact: snapshot on
  // the second, never the first.
  assert.deepEqual(parseLine(LINES.commitInventory), { at: 164.961, type: 'inventoryCommitted' });
  assert.deepEqual(parseLine(LINES.dbUpdateComplete), { at: 165.201, type: 'inventoryDurable' });
  assert.deepEqual(parseLine(LINES.exitingMainLoop), { at: 3389.376, type: 'sessionEnd' });
}

function ignoresNoise() {
  assert.equal(parseLine(LINES.noise), null);
  assert.equal(parseLine(''), null);
}

function assemblesACompleteRun() {
  // Real order: name, then node, then type, then outcome.
  const run = feed([LINES.missionName, LINES.hostLoading, LINES.missionType, LINES.succeeded]);
  assert.equal(run?.node, 'SolNode167');
  assert.equal(run?.name, 'Oestrus');
  assert.equal(run?.planet, 'Eris');
  assert.equal(run?.missionType, 'MT_PURIFY');
  assert.equal(run?.difficulty, 1);
  assert.equal(run?.success, true);
  assert.equal(run?.aborted, false);
}

function carriesEveryMinedFieldIntoTheRun() {
  const NOW = 1_700_000_000_000;
  const t = new MissionTracker(() => NOW);
  const run = feed(
    [
      LINES.serverReady, // 53.899, squad size 1, first timestamp -> anchor
      LINES.runName,
      LINES.runHostLoading,
      LINES.wallTime,
      LINES.missionRules,
      LINES.hostCallback,
      LINES.syncConsumables,
      LINES.stateStarted, // 56.910
      LINES.runType,
      LINES.runSucceeded, // 164.957
      LINES.inTrigger,
      LINES.notInTrigger,
      LINES.synBase,
      LINES.synMultiplier,
      LINES.synCheckpoint,
      LINES.commitInventory,
      LINES.dbUpdateComplete,
      LINES.stateEnding, // 167.504 - the run is emitted here, not at the outcome
    ],
    t,
  );

  assert.equal(run?.squadSize, 1);
  assert.equal(run?.gameRules, 'LotusRankUpGameRules');
  assert.equal(run?.loadSeconds, 2.2);
  assert.equal(run?.isHost, true);
  assert.equal(run?.location, null, 'a dojo has no location and must not invent one');
  // The real capture's own numbers: SS_STARTED 56.910 -> Mission Succeeded 164.957.
  assert.equal(run?.durationSeconds, 108.047);
  // Anchor is taken from the first timestamped line, at 53.899.
  assert.equal(run?.endedAtMs, Math.round(NOW - 53.899 * 1000 + 164.957 * 1000));
  assert.equal(run?.squad, null, 'names must stay out unless opted in');
  assert.deepEqual(run?.syndicateXp, { base: 289, afterMultiplier: 578, afterCheckpoint: 400 });
  assert.deepEqual(run?.extraction, { inTrigger: 1, total: 2 });
}

function extractionAndSyndicateAreAbsentWhenUnreported() {
  const run = feed([LINES.hostLoading, LINES.succeeded]);
  assert.equal(run?.extraction, null);
  assert.equal(run?.syndicateXp, null);
  assert.equal(run?.durationSeconds, null, 'no SS_STARTED means no honest duration');
  assert.equal(run?.isHost, null, 'absence of the host callback proves nothing');
}

function partialSyndicateXpFallsBackRatherThanDroppingTheNumber() {
  const run = feed([LINES.hostLoading, LINES.synBase, LINES.succeeded]);
  assert.deepEqual(run?.syndicateXp, { base: 289, afterMultiplier: 289, afterCheckpoint: 289 });
}

function squadSizeIgnoresTheOrbiterZero() {
  const run = feed([LINES.serverReady, LINES.hostLoading, LINES.serverReadyOrbiter, LINES.succeeded]);
  assert.equal(run?.squadSize, 1, 'sessionPlayers=0 on the orbiter load must not wipe the real squad size');
}

function capturesSquadNamesOnlyWhenOptedIn() {
  const t = new MissionTracker();
  for (const l of [LINES.addSquadMemberPua, LINES.hostLoading]) t.push(parseLine(l, true)!);
  const run = t.push(parseLine(LINES.succeeded, true)!);
  assert.deepEqual(run?.squad, ['SomePlayer']);

  assert.equal(feed([LINES.addSquadMemberPua, LINES.hostLoading, LINES.succeeded])?.squad, null);
}

function detectsAnAbortStructurally() {
  // The log has no abort line at all. Leaving SS_STARTED with no end-of-match
  // screen is the only signal there is.
  const run = feed([LINES.missionName, LINES.hostLoading, LINES.stateStarted, LINES.stateEnding]);
  assert.equal(run?.aborted, true);
  assert.equal(run?.success, false, 'an abort must never look like a clear');
  assert.equal(run?.node, 'SolNode167', 'an aborted run still knows where it was');
}

function normalEndDoesNotAlsoReportAnAbort() {
  const t = new MissionTracker();
  const runs: MissionRun[] = [];
  for (const l of [LINES.hostLoading, LINES.stateStarted, LINES.succeeded, LINES.stateEnding, LINES.stateEnded]) {
    const r = t.push(parseLine(l)!);
    if (r) runs.push(r);
  }
  assert.equal(runs.length, 1, 'SS_ENDING after a completed mission must not emit a second, aborted run');
  assert.equal(runs[0]?.success, true);
}

function parsesTheSurveyedMeasurements() {
  assert.deepEqual(parseLine(LINES.dailyTribute), { at: 3172.739, type: 'dailyTribute' });
  assert.deepEqual(parseLine(LINES.masteryProgress), { at: 58.221, type: 'masteryProgress', percent: 0.101957 });
  assert.deepEqual(parseLine(LINES.masteryXp), { at: 58.22, type: 'masteryXp', xp: 83700 });
  assert.deepEqual(parseLine(LINES.missionXp), { at: 58.219, type: 'missionXp', xp: 19758 });
  assert.deepEqual(parseLine(LINES.loadoutConsumable), {
    at: 56.428,
    type: 'loadoutConsumable',
    slot: 8,
    itemType: '/Lotus/Types/Restoratives/Cipher',
    count: 58,
  });
  assert.deepEqual(parseLine(LINES.connectionState), {
    at: 43.101,
    type: 'connectionState',
    edge: 'enter',
    state: 'Connected',
  });
  assert.deepEqual(parseLine(LINES.connectionExit), {
    at: 167.9,
    type: 'connectionState',
    edge: 'exit',
    state: 'Connected',
  });

  // The percent is a float and must stay one: rounded to an integer it can no
  // longer detect the catalogue drift it exists to detect.
  const pct = parseLine(LINES.masteryProgress);
  assert.ok(pct?.type === 'masteryProgress' && !Number.isInteger(pct.percent));
}

/*
 * THE CORRECTION, not an addition. Without the `extractionTrigger is nil` line
 * a zoneless mission reports `{inTrigger: 1, total: 1}` - which reads as a clean
 * extraction and is the engine openly saying it invented the flags. Unknown is
 * not a value, so the run must report null.
 */
function anAssumedExtractionIsNotAMeasuredOne() {
  /*
   * The session bracket is required, not decoration: with no `SS_STARTED` the
   * run is not live, `missionEnd` finishes it at once, and the extraction lines
   * that follow the outcome land on nothing. Writing this test without the
   * bracket produced `null` for BOTH cases and would have "passed" the new
   * behaviour while measuring the arrangement instead.
   */
  const bracket = (extra: string[]) => [
    LINES.runHostLoading,
    LINES.stateStarted,
    ...extra,
    LINES.runSucceeded,
    LINES.inTrigger,
    LINES.stateEnding,
  ];

  const measured = feed(bracket([]));
  assert.deepEqual(measured?.extraction, { inTrigger: 1, total: 1 }, 'the ordinary case must still report');

  const assumed = feed(bracket([LINES.noExtractionZone]));
  assert.equal(assumed?.extraction, null, 'an invented extraction was reported as measured');

  // And it is PER RUN. Left set, one zoneless mission would erase the
  // extraction of every run after it for the rest of the session.
  const tracker = new MissionTracker();
  feed(bracket([LINES.noExtractionZone]), tracker);
  const next = feed(bracket([]), tracker);
  assert.deepEqual(next?.extraction, { inTrigger: 1, total: 1 }, 'the flag leaked into the next run');
}

/** None of the seven may carry a name, an email, an account id, an IP or a path. */
function theNewLinesCarryNoIdentifier() {
  const added = [
    LINES.dailyTribute,
    LINES.masteryProgress,
    LINES.masteryXp,
    LINES.missionXp,
    LINES.loadoutConsumable,
    LINES.connectionState,
    LINES.connectionExit,
    LINES.noExtractionZone,
  ];
  for (const line of added) {
    const json = JSON.stringify(parseLine(line) ?? {});
    assert.ok(!/@/.test(json), `an email-shaped value survived: ${line}`);
    assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(json), `an IP-shaped value survived: ${line}`);
    assert.ok(!/[A-Za-z]:\\/.test(json), `a machine path survived: ${line}`);
    // A game asset path is fine; a user directory is not.
    assert.ok(!/Users|AppData|Documents/i.test(json), `a user path survived: ${line}`);
  }
}

function parsesTheModdingScreen() {
  assert.deepEqual(parseLine(LINES.upgradeSlot), { at: 5958.259, type: 'upgradeSlot', slot: 3 });
  // Hovering a slot is not pressing Upgrade on it.
  assert.equal(parseLine(LINES.upgradeSlotHover), null, 'RefreshStatList was read as the trigger');
  assert.deepEqual(parseLine(LINES.upgradeCardsOpen), { at: 5958.275, type: 'screen', name: 'UpgradeCards', open: true });
  assert.deepEqual(parseLine(LINES.upgradeCardsClose), { at: 6020.5, type: 'screen', name: 'UpgradeCards', open: false });
  assert.deepEqual(parseLine(LINES.arsenalOpen), { at: 6372.535, type: 'screen', name: 'LoadOut', open: true });
  assert.deepEqual(parseLine(LINES.arsenalClose), { at: 6700.1, type: 'screen', name: 'LoadOut', open: false });
  assert.deepEqual(parseLine(LINES.modInstalled), {
    at: 5990.101,
    type: 'modInstalled',
    name: 'True Steel',
    itemType: '/Lotus/Upgrades/Mods/Melee/WeaponCritChanceMod',
    installed: true,
  });
  assert.deepEqual(parseLine(LINES.modRemoved), {
    at: 5990.102,
    type: 'modInstalled',
    name: 'Pressure Point',
    itemType: '/Lotus/Upgrades/Mods/Melee/WeaponMeleeDamageMod',
    installed: false,
  });
  assert.deepEqual(parseLine(LINES.modOwned), {
    at: 5958.552,
    type: 'modOwned',
    itemType: '/Lotus/Upgrades/Mods/Melee/WeaponFireDamageMod',
  });
  assert.deepEqual(parseLine(LINES.loadoutSaved), { at: 6020.864, type: 'loadoutSaved' });
  // No timestamp on the fusion line, and the thousands separators are gone.
  assert.deepEqual(parseLine(LINES.fusionCost), { at: null, type: 'fusionCost', endo: 15330, credits: 740439 });
  // The open that fires on EVERY path, and the visibility line that gates showing anything.
  assert.deepEqual(parseLine(LINES.upgradeCardsCreated), { at: 1950.165, type: 'screen', name: 'UpgradeCards', open: true });
  assert.deepEqual(parseLine(LINES.upgradeCardsVisible), { at: 1950.682, type: 'hudVisible', screen: 'UpgradeCards', level: 1 });
}

/*
 * THE BUILD DUMP. Eleven polarities, the base capacity and stance bonus, and
 * every installed mod with its polarity-adjusted drain - the numbers the
 * screenshot's drain tags show, and the only ground truth of a build the app
 * can get without a live push.
 */
function parsesTheBuildDump() {
  const slots = parseLine(LINES.buildSlots);
  assert.equal(slots?.type, 'buildSlots');
  assert.equal(slots?.type === 'buildSlots' && slots.polarities.length, 11, 'eleven slots, always');
  assert.equal(slots?.type === 'buildSlots' && slots.polarities[3], 'AP_ATTACK');
  assert.equal(slots?.type === 'buildSlots' && slots.polarities[6], 'AP_TACTIC');

  assert.deepEqual(parseLine(LINES.buildCapacity), {
    at: null,
    type: 'buildCapacity',
    initial: 30,
    stance: 'IronPhoenixMeleeTree',
    stanceBonus: 4,
  });
  const mods = parseLine(LINES.buildMods);
  assert.equal(mods?.type, 'buildMods');
  if (mods?.type === 'buildMods') {
    assert.equal(mods.capacity, 34);
    assert.deepEqual(mods.mods.map((m) => [m.mod, m.drain]), [
      ['WeaponMeleeStatusChanceSPMod', 11],
      ['WeaponMeleeDamageModExpert', 7],
      ['WeaponSlashDamageMod', 7],
      ['AshenMandibleMod', 5],
      ['WeaponCritChanceSPMod', 6],
    ]);
  }
  assert.deepEqual(parseLine(LINES.buildDrain), { at: null, type: 'buildDrain', drain: 4 });
}

/*
 * THE ADJACENCY TRAP. `BuildLoadOut for <name>` and `SendLoadOut: <name> …` fire
 * in the same second as every upgrade-screen line, and both carry the player's
 * name. Every arsenal regex is anchored on its Lua script so neither can match.
 */
function theArsenalLinesNeverCarryTheName() {
  assert.equal(parseLine(LINES.buildLoadOut), null, 'BuildLoadOut for <player> produced an event');
  assert.equal(parseLine(LINES.sendLoadOut), null, 'SendLoadOut: <player> produced an event');
  for (const line of [
    LINES.upgradeSlot, LINES.upgradeCardsOpen, LINES.upgradeCardsClose, LINES.arsenalOpen,
    LINES.arsenalClose, LINES.modInstalled, LINES.modRemoved, LINES.modOwned, LINES.loadoutSaved, LINES.fusionCost,
    LINES.upgradeCardsCreated, LINES.upgradeCardsVisible,
    LINES.buildSlots, LINES.buildCapacity, LINES.buildMods, LINES.buildDrain,
  ]) {
    const json = JSON.stringify(parseLine(line) ?? {});
    assert.ok(!json.includes('SomePlayer'), `a name survived: ${line}`);
    assert.ok(!/@|[A-Za-z]:\\|Users|AppData/.test(json), `an identifier survived: ${line}`);
  }
}

/** The arsenal is not a mission: none of these may open, alter or close a run. */
function theArsenalDoesNotTouchARun() {
  const tracker = new MissionTracker();
  const bracket = [LINES.runHostLoading, LINES.stateStarted, LINES.runSucceeded, LINES.inTrigger, LINES.stateEnding];
  const clean = feed(bracket);
  const withArsenal = feed(
    [LINES.arsenalOpen, LINES.upgradeSlot, LINES.upgradeCardsOpen, LINES.modInstalled, ...bracket, LINES.loadoutSaved, LINES.upgradeCardsClose],
    tracker,
  );
  assert.ok(clean && withArsenal);
  assert.equal(withArsenal.success, clean.success);
  assert.equal(withArsenal.node, clean.node);
  assert.deepEqual(withArsenal.extraction, clean.extraction);
}

function sessionEndClosesADanglingRun() {
  const run = feed([LINES.hostLoading, LINES.stateStarted, LINES.exitingMainLoop]);
  assert.equal(run?.aborted, true, 'closing the game mid-mission must close the run, not leak it');

  // And it must not manufacture a run when nothing was in progress.
  assert.equal(feed([LINES.frontEndRules, LINES.exitingMainLoop]), null);
}

function reAnchorsWhenTheGameRestarts() {
  // Relaunching Warframe truncates the log and restarts the clock at zero.
  const NOW = 1_700_000_000_000;
  // Forwards-only: the anchor is taken once, from the first timestamp seen.
  const t = new MissionTracker(() => NOW);
  const run = feed([LINES.serverReady, LINES.stateStarted, LINES.runSucceeded, LINES.stateEnding], t);
  assert.equal(run?.endedAtMs, Math.round(NOW - 53.899 * 1000 + 164.957 * 1000));

  // Now the clock goes backwards, which only a relaunch can cause.
  const t2 = new MissionTracker(() => NOW);
  t2.push(parseLine(LINES.succeeded)!); // t=4100.100, from the previous session
  const after = feed([LINES.serverReady, LINES.stateStarted, LINES.runSucceeded, LINES.stateEnding], t2); // t drops to 53.899
  assert.equal(
    after?.endedAtMs,
    Math.round(NOW - 53.899 * 1000 + 164.957 * 1000),
    'a backwards timestamp must re-anchor',
  );
}

function realWorldOrderingKeepsTheName() {
  // Verified against a live log: the name line precedes the node line. Getting
  // this backwards silently dropped the name from every single run.
  const sameNodeLaunch =
    '3874.428 Script [Info]: ThemedSquadOverlay.lua: Lobby::Host_StartMatch: launching level for SolNode167 (/Lotus/Levels/Proc/X)';
  const run = feed([LINES.missionName, LINES.hostLoading, sameNodeLaunch, LINES.missionType, LINES.succeeded]);
  assert.equal(run?.name, 'Oestrus', 'the name logged before the node must survive');
  assert.equal(run?.node, 'SolNode167', 'the repeated node line must not wipe the run');
}

function abortedRunIsOverwrittenNotEmitted() {
  const t = new MissionTracker();
  // Start a mission and abandon it without an outcome or a session teardown.
  t.push(parseLine(LINES.missionName)!);
  const emitted = t.push(parseLine(LINES.hostLoading)!);
  assert.equal(emitted, null, 'abandoning a mission must not report a completion');

  // A different mission then begins; its own name line opens a fresh run.
  t.push(parseLine('0 Script [Info]: ThemedSquadOverlay.lua: Mission name: Linea (Venus)')!);
  t.push(parseLine(LINES.launching)!);
  const run = t.push(parseLine(LINES.succeeded)!);
  assert.equal(run?.name, 'Linea', "the new mission must not inherit the abandoned one's name");
  assert.equal(run?.node, 'SolNode175');
}

function orderIndependence() {
  // The same facts in the reverse order must assemble the same run, so the
  // parser does not depend on a log ordering we merely happened to observe.
  const order = [LINES.missionName, LINES.hostLoading, LINES.missionType, LINES.missionRules, LINES.serverReady];
  const NOW = 1_700_000_000_000;

  const a = feed([...order, LINES.succeeded], new MissionTracker(() => NOW));
  const b = feed([...order].reverse().concat(LINES.succeeded), new MissionTracker(() => NOW));

  // endedAtMs legitimately differs: the anchor comes from whichever timestamped
  // line arrives first. Everything the run actually asserts about the mission
  // must not.
  assert.deepEqual({ ...a, endedAtMs: 0 }, { ...b, endedAtMs: 0 }, 'run assembly must not depend on line order');
}

function parsesFractionalDifficulty() {
  const line =
    '2398.343 Script [Info]: ThemedSquadOverlay.lua: Host loading {"difficulty":0.375,"name":"SolNode109"} with MissionInfo: ';
  assert.deepEqual(parseLine(line), { at: 2398.343, type: 'missionStart', node: 'SolNode109', difficulty: 0.375 });
}

function failedRunIsNotProgress() {
  const run = feed([LINES.hostLoading, LINES.failed]);
  assert.equal(run?.success, false, 'a failed mission must be reported as such, not as a clear');
  assert.equal(run?.aborted, false, 'a failure is not an abort — the results screen ran');
}

function tracksUsername() {
  const t = new MissionTracker();
  t.push(parseLine(LINES.loggedIn)!);
  assert.equal(t.username, 'GermaticSpread');
}

function everyEventTypeIsHandled() {
  // A new variant added to LogEvent without a tracker case would fail the
  // exhaustiveness check in `push`; this proves each one is at least reachable
  // from a real line rather than being dead code.
  const seen = new Set<LogEvent['type']>();
  for (const line of Object.values(LINES)) {
    const e = parseLine(line, true);
    if (e) seen.add(e.type);
  }
  const expected: LogEvent['type'][] = [
    'login',
    'missionStart',
    'missionInfo',
    'missionType',
    'missionEnd',
    'missionLoad',
    'gameRules',
    'sessionState',
    'squadSize',
    'squadMember',
    'hostSession',
    'loadTime',
    'extraction',
    'syndicateXp',
    'inventoryCommitted',
    'inventoryDurable',
    'sessionEnd',
  'dailyTribute',
  'masteryProgress',
  'masteryXp',
  'missionXp',
  'loadoutConsumable',
  'connectionState',
  'noExtractionZone',
  'screen',
  'upgradeSlot',
  'modInstalled',
  'modOwned',
  'loadoutSaved',
  'fusionCost',
  'hudVisible',
  'buildSlots',
  'buildCapacity',
  'buildMods',
  'buildDrain',
  ];
  for (const type of expected) assert.ok(seen.has(type), `no fixture line produces a "${type}" event`);
}

/**
 * THE TAIL STARTS AT THE END OF THE FILE, AND THAT IS A PRIVACY SETTING.
 *
 * `listenOnFile` takes `skipToEnd`. With it true the app sees only lines
 * written after it starts listening. With it false it replays the WHOLE of
 * EE.log from the first byte - and the header of `core/eelog.ts` lists what is
 * in there: the account's email address in plaintext on the login line, the
 * machine's IP, the Windows user and computer name, the 24-hex account id, and
 * other players' display names.
 *
 * `parseLine` allowlists, so none of that would be emitted. The point is that
 * it would be READ, and defence in depth is the whole posture of that file:
 * the parser not matching a line is the second line of defence, not the first.
 *
 * It is also a correctness setting. Replaying history means the reducer walks
 * every modding session the player has ever had, so the overlay can open on a
 * screen closed days ago.
 *
 * Flipping one word does all of that, and no other check in this repository
 * notices - verified by doing it. This is a source-text assertion because the
 * option is handed to Overwolf and never returned.
 */
/**
 * THE LOG IS READ AS UTF-8, and the alternative mangles half the star chart.
 *
 * Node names carry non-ASCII characters - Stofler with an umlaut, Kiliken -
 * and Overwolf's `listenOnFile` will happily hand them over as ANSI, where
 * every one of those bytes becomes a different character. The mission would be
 * recorded against a node id that joins to nothing.
 *
 * Same shape as `skipToEnd` below: one word, handed to a platform API, never
 * read back, invisible to every other check here.
 */
function theTailReadsUtf8(): void {
  const src = readFileSync(new URL('../src/core/eelog.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');
  const m = /encoding:\s*'(\w+)'/.exec(src);
  assert.ok(m, 'the tail no longer states an encoding, so it takes the platform default');
  assert.equal(m[1], 'UTF8', 'the tail reads the log as something other than UTF-8; node names with accents will mangle');
}

function theTailSkipsToTheEnd(): void {
  const src = readFileSync(new URL('../src/core/eelog.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ');
  const m = /skipToEnd:\s*(\w+)/.exec(src);
  assert.ok(m, 'the tail no longer sets skipToEnd at all, so it defaults to replaying the whole log');
  assert.equal(m[1], 'true', 'the tail replays EE.log from the first byte, which is where the account email is');
}

const checks = [
  neverLeaksTheEmailLine,
  neverLeaksMachineOrAccountIdentifiers,
  redactionStripsPii,
  everyStringLeavingTheParserIsRedacted,
  parsesLogin,
  parsesNodeFromHostLoading,
  parsesNodeFromLaunching,
  parsesMissionInfo,
  parsesTypeAndOutcome,
  capturesTimestamps,
  parsesSessionStates,
  parsesMissionLoad,
  parsesGameRules,
  parsesSquadSignals,
  parsesHostAndTiming,
  parsesExtractionAndSyndicateXp,
  parsesInventoryDiffTriggers,
  ignoresNoise,
  assemblesACompleteRun,
  carriesEveryMinedFieldIntoTheRun,
  extractionAndSyndicateAreAbsentWhenUnreported,
  partialSyndicateXpFallsBackRatherThanDroppingTheNumber,
  squadSizeIgnoresTheOrbiterZero,
  capturesSquadNamesOnlyWhenOptedIn,
  detectsAnAbortStructurally,
  normalEndDoesNotAlsoReportAnAbort,
  parsesTheSurveyedMeasurements,
  anAssumedExtractionIsNotAMeasuredOne,
  theNewLinesCarryNoIdentifier,
  parsesTheModdingScreen,
  parsesTheBuildDump,
  theArsenalLinesNeverCarryTheName,
  theArsenalDoesNotTouchARun,
  sessionEndClosesADanglingRun,
  reAnchorsWhenTheGameRestarts,
  realWorldOrderingKeepsTheName,
  abortedRunIsOverwrittenNotEmitted,
  orderIndependence,
  parsesFractionalDifficulty,
  failedRunIsNotProgress,
  tracksUsername,
  everyEventTypeIsHandled,
  theTailSkipsToTheEnd,
  theTailReadsUtf8,
];

let failed = 0;
for (const c of checks) {
  try {
    c();
    console.log(`  ok    ${c.name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${c.name}\n        ${(err as Error).message}`);
  }
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall EE.log parser rules hold');
// Set the code rather than calling process.exit(): exiting immediately can
// race stdout flushing on Windows and print a libuv assertion after the report.
process.exitCode = failed ? 1 : 0;
