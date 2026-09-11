/**
 * Dev-only live data bridge.
 *
 * The browser cannot read the filesystem, so the visual lab had no way to reach
 * real account data and was falling back on hand-written scenarios. Simulated
 * data is worse than no data: it hides exactly the bugs that only real input
 * exposes, and it makes a screenshot a lie.
 *
 * This Vite middleware reads the player's actual EE.log and serves the parsed,
 * REDACTED result at /__live. The lab then renders real cleared nodes, the real
 * username and the real mission history.
 *
 * Dev only - it is a Vite plugin and never exists in the Overwolf build, where
 * `overwolf.io.listenOnFile` does the same job properly.
 *
 * PRIVACY: EE.log contains the account email, the machine's IP, Windows user and
 * computer names, and other players' display names. Nothing here streams raw
 * lines. Every line goes through the same allowlist parser the app uses, and the
 * response carries only parsed events.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const EE_LOG = join(process.env.LOCALAPPDATA ?? '', 'Warframe', 'EE.log');

/**
 * A deliberately small mirror of src/core/eelog.ts.
 *
 * Importing the real parser would mean running TypeScript inside the Vite config
 * process; the patterns are few and stable enough that duplicating them is the
 * lesser evil. The check script asserts the app's parser against the same log,
 * so a divergence surfaces there.
 */
function parseLine(line) {
  const login = /Sys \[Info\]: Logged in ([A-Za-z0-9_.-]+)/.exec(line);
  if (login?.[1]) return { type: 'login', username: login[1] };

  const start = /Host loading \{[^}]*"name"\s*:\s*"([A-Za-z0-9_]+)"/.exec(line);
  if (start?.[1]) {
    const diff = /"difficulty"\s*:\s*(\d+(?:\.\d+)?)/.exec(line);
    return { type: 'missionStart', node: start[1], difficulty: diff?.[1] ? Number(diff[1]) : 1 };
  }

  const launching = /launching level for ([A-Za-z0-9_]+)/.exec(line);
  if (launching?.[1]) return { type: 'missionStart', node: launching[1], difficulty: 1 };

  const info = /Mission name: (.+?) \(([^)]+)\)/.exec(line);
  if (info?.[1] && info[2]) return { type: 'missionInfo', name: info[1].trim(), planet: info[2].trim() };

  const type = /OnStateStarted, mission type=([A-Z_]+)/.exec(line);
  if (type?.[1]) return { type: 'missionType', missionType: type[1] };

  const end = /EndOfMatch\.lua: Mission (Succeeded|Failed)/.exec(line);
  if (end?.[1]) return { type: 'missionEnd', success: end[1] === 'Succeeded' };

  /*
   * Account-level signals the log carries outside any mission.
   *
   * These matter because they are the ONLY real account numbers available
   * without Overwolf/GEP. They are emitted on login and after missions, so a
   * relay visit is enough to produce them.
   */

  // "Player has 83700 (item based) XP" - cumulative mastery XP from items.
  const xp = /Player has (\d+) \(item based\) XP/.exec(line);
  if (xp?.[1]) return { type: 'masteryXp', xp: Number(xp[1]) };

  // "Player is 0.101957% towards all available items at max rank"
  // The game's own completion figure - no catalog join needed.
  const pct = /Player is ([\d.]+)% towards all available items at max rank/.exec(line);
  if (pct?.[1]) return { type: 'completion', percent: Number(pct[1]) };

  // Which game rules are loaded - the cheapest hub-vs-mission discriminator.
  const rules = /Loading game rules: ([A-Za-z]+)/.exec(line);
  if (rules?.[1]) return { type: 'gameRules', rules: rules[1] };

  return null;
}

/** Defence in depth; the allowlist above should already prevent all of this. */
function redact(s) {
  return String(s)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '[ip]')
    .replace(/\b[0-9a-fA-F]{24}\b/g, '[id]');
}

function readLive() {
  if (!existsSync(EE_LOG)) {
    return { available: false, reason: 'EE.log not found - has Warframe been run on this machine?' };
  }

  const stat = statSync(EE_LOG);
  // latin1 then redact: the file is not valid UTF-8 throughout, and a decode
  // error must never take the bridge down.
  const lines = readFileSync(EE_LOG, 'latin1').split(/\r?\n/);

  let username = null;
  let masteryXp = null;
  let completionPercent = null;
  let location = null;
  const runs = [];
  let cur = {};

  for (const line of lines) {
    const e = parseLine(line);
    if (!e) continue;
    if (e.type === 'login') {
      username = e.username;
    } else if (e.type === 'masteryXp') {
      // Take the largest: the log emits a 0 during early init.
      masteryXp = Math.max(masteryXp ?? 0, e.xp);
    } else if (e.type === 'completion') {
      completionPercent = e.percent;
    } else if (e.type === 'gameRules') {
      location =
        e.rules === 'LotusHubGameRulesProd'
          ? 'Relay'
          : e.rules === 'AlternateLotusFrontEndGameRules'
            ? 'Orbiter'
            : 'Mission';
    } else if (e.type === 'missionStart') {
      cur.node = e.node;
      cur.difficulty = e.difficulty;
    } else if (e.type === 'missionInfo') {
      cur.name = e.name;
      cur.planet = e.planet;
    } else if (e.type === 'missionType') {
      cur.missionType = e.missionType;
    } else if (e.type === 'missionEnd') {
      runs.push({
        node: cur.node ?? null,
        name: cur.name ?? null,
        planet: cur.planet ?? null,
        missionType: cur.missionType ?? null,
        difficulty: cur.difficulty ?? 1,
        success: e.success,
      });
      cur = {};
    }
  }

  // Nodes actually cleared, observed in this log. Real, not simulated - but only
  // what this log file covers, which the UI must say out loud.
  const cleared = [...new Set(runs.filter((r) => r.success && r.node).map((r) => r.node))];

  return {
    available: true,
    source: 'EE.log',
    username: username ? redact(username) : null,
    masteryXp,
    completionPercent,
    location,
    sizeBytes: stat.size,
    modified: stat.mtimeMs,
    lines: lines.length,
    runs,
    cleared,
    // Stated plainly so nothing downstream can present this as a full account.
    coverage:
      'Nodes observed cleared in the current EE.log only. Full account history requires the Overwolf build reading GEP match_info.inventory.',
  };
}

/** @returns {import('vite').Plugin} */
export function liveDataPlugin() {
  return {
    name: 'raijiframe-live-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__live', (_req, res) => {
        try {
          const payload = readLive();
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(payload));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ available: false, reason: redact(String(err)) }));
        }
      });
    },
  };
}
