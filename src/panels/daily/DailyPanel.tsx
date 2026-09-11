/**
 * DAILY — what is still on the clock.
 *
 * The whole panel answers one question: *what should I do before reset?* So the
 * sort order is not by category, it is by state. Anything still open is on top,
 * at full size, in gold. Anything the inventory genuinely cannot settle sits in
 * its own band and says why. Anything already cleared is compressed and dimmed
 * to the bottom, because a finished chore is reference, not a call to action.
 *
 * The honesty rule this panel lives or dies by: `dailyState` returns `done: null`
 * for the sortie and the archon hunt, because the inventory stores the ids of
 * every sortie ever cleared and matching *today's* id needs worldState. A
 * checklist that renders that gap as an unticked box is lying in the direction
 * that costs the player a run, so those rows are a third state — UNVERIFIED —
 * and never pretend to be either.
 */

import { useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useAccount } from '../../core/store';
import type { RawAccount } from '../../data/account';
import {
  dailyState,
  nextDailyResetUtc,
  syndicateState,
  type DailyState,
  type Remaining,
  type SyndicateStanding,
} from '../../data/subsystems';
import { humanDuration } from '../../data/worldstate';
import { CLIP, EmptyState, cx } from '../../ui/orokin';
import { navigate } from '../../ui/navigation';
import { Clamp, Disclosure } from '../../ui/Disclosure';
import { Segmented } from '../shared/Segmented';
import { CHAMFER, PLATE_LIFT as PLATE } from '../../ui/geometry';

const DAY_MS = 86_400_000;


/**
 * The wall clock as an external store rather than state.
 *
 * Render stays pure — no `Date.now()` in the body — and there is no
 * setState-in-effect. The snapshot is quantised to the tick so it is referentially
 * stable between ticks, which is what `getSnapshot` is required to be.
 */
function useNow(ms = 1000): number {
  return useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, ms);
      return () => {
        clearInterval(id);
      };
    },
    () => Math.floor(Date.now() / ms) * ms,
    () => 0,
  );
}

/** Hours and minutes to the reset. Clamped to one day: the reset is never further off than that. */
function hm(ms: number): string {
  const m = Math.floor(Math.min(DAY_MS, Math.max(0, ms)) / 60_000);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

const int = (n: number): string => Math.round(n).toLocaleString();

/* ---------------------------------------------------------------- task model */

type TaskState = 'open' | 'unknown' | 'done';

interface Task {
  id: string;
  name: string;
  /** Cadence chip. Free text so a weekly pool can say which week it means. */
  cadence: string;
  /** One line of why. For UNVERIFIED rows this is the whole point of the row. */
  note: string;
  state: TaskState;
  /**
   * 0..1 for the meter. The invariant across the whole panel: a bar always
   * visualises the number printed beside it. A pool prints what is LEFT, so its
   * bar drains; a scan counter prints what is DONE, so its bar fills. Getting
   * this backwards puts a long bar next to a small number, which reads as a
   * contradiction and is worse than no bar at all. `null` omits the meter.
   */
  progress: number | null;
  /** Right-hand readout. Kept short; the note carries the explanation. */
  value: string | null;
  resetsAtMs: number | null;
  /** Higher sorts first inside its band. Ordered by what actually expires. */
  weight: number;
}

/** A pool row: open while there is allowance left, done once it is spent. */
function poolTask(
  id: string,
  name: string,
  note: string,
  r: Remaining,
  resetsAtMs: number | null,
  weight: number,
  missing: string,
): Task {
  if (r.remaining === null) {
    return { id, name, cadence: 'DAILY', note: missing, state: 'unknown', progress: null, value: null, resetsAtMs, weight };
  }
  const left = r.cap === null || r.cap <= 0 ? null : Math.min(1, r.remaining / r.cap);
  return {
    id,
    name,
    cadence: 'DAILY',
    note: r.remaining > 0 ? note : 'Capped for today. Further earnings are wasted until reset.',
    state: r.remaining > 0 ? 'open' : 'done',
    progress: left,
    value: r.cap === null ? `${int(r.remaining)} left` : `${int(r.remaining)} / ${int(r.cap)}`,
    resetsAtMs,
    weight,
  };
}

function buildTasks(daily: DailyState, now: number, measured: boolean): Task[] {
  const reset = daily.resetsAtMs;
  const tasks: Task[] = [];

  tasks.push(
    poolTask(
      'focus',
      'Daily focus',
      'Focus still earnable today. Cap is 250,000 + MR × 5,000.',
      daily.focus,
      reset,
      daily.focus.remaining !== null && daily.focus.remaining > 0 ? 96 : 40,
      measured ? 'Today’s focus count is not in this account read.' : 'Today’s focus cap needs your account.',
    ),
  );

  tasks.push(
    poolTask(
      'standing',
      'Syndicate standing — shared pool',
      'One pool feeding Steel Meridian, Arbiters, Suda, Perrin, Red Veil and New Loka.',
      daily.standing,
      reset,
      daily.standing.remaining !== null && daily.standing.remaining > 0 ? 94 : 38,
      measured ? 'The shared standing pool is not in this account read.' : 'The shared standing pool needs your account.',
    ),
  );

  // Simaris: `Scans` only exists once the daily is started, so an absent value
  // means "not begun", never zero-of-zero.
  const { target, scans, scansRequired } = daily.simaris;
  if (target === null) {
    tasks.push({
      id: 'simaris',
      name: 'Simaris target',
      cadence: 'DAILY',
      /*
       * "No target recorded" is a reading of an account. Without one, an absent
       * `target` means the same thing an absent everything else does - not
       * measured - and telling a player to go and take a target they may already
       * have is advice built on a field we never looked at.
       */
      note: measured
        ? 'No personal target recorded. Speak to Simaris in the Relay to take one.'
        : 'Whether you have a target today is read from your account.',
      state: 'unknown',
      progress: null,
      value: null,
      resetsAtMs: reset,
      weight: 60,
    });
  } else {
    const complete = scans !== null && scansRequired !== null && scans >= scansRequired;
    tasks.push({
      id: 'simaris',
      name: 'Simaris target',
      cadence: 'DAILY',
      note:
        scans === null
          ? `Not started. Target: ${prettyPath(target)}.`
          : complete
            ? `Scans complete. Standing is waiting at the Sanctuary terminal.`
            : `Scanning ${prettyPath(target)}.`,
      state: complete ? 'done' : 'open',
      progress: scans === null || scansRequired === null || scansRequired <= 0 ? null : Math.min(1, scans / scansRequired),
      value: scans === null ? 'not started' : scansRequired === null ? `${scans} scans` : `${scans} / ${scansRequired}`,
      resetsAtMs: reset,
      weight: complete ? 36 : 88,
    });
  }

  /*
   * The two rows that must not lie. `done` is null by construction.
   *
   * `everCompleted` is an array LENGTH, so an absent field and a genuinely empty
   * history produce the identical 0 - the trap this file already warns about
   * where the capacity strip reads the same value. That warning was applied
   * there and not here, so with no account this row still announced "0 ever",
   * telling a player who has never been measured that they have never cleared a
   * sortie. Without an account the lifetime count is simply not known.
   */
  const sortieEver = daily.sortie.everCompleted === null ? null : int(daily.sortie.everCompleted);
  tasks.push({
    id: 'sortie',
    name: 'Sortie',
    cadence: 'DAILY',
    note:
      sortieEver === null
        ? 'Your account will not answer this even once it is read — it records every sortie ever cleared, not which one was today.'
        : `Your account cannot answer this — it records every sortie ever cleared (${sortieEver}), not which one was today.${daily.sortie.rewardPending ? ' A sortie reward is recorded, so a run happened at some point.' : ''}`,
    state: 'unknown',
    progress: null,
    value: sortieEver === null ? null : `${sortieEver} ever`,
    resetsAtMs: reset,
    weight: 80,
  });

  tasks.push({
    id: 'archon',
    name: 'Archon Hunt',
    cadence: 'WEEKLY',
    note: `Your account cannot answer this either, for the same reason as the sortie.${measured && daily.archon.rewardPending ? ' An archon reward is recorded, so a hunt was run at some point.' : ''}`,
    state: 'unknown',
    progress: null,
    value: null,
    resetsAtMs: null,
    weight: 78,
  });

  // Netracells: runs *used*, and the weekly cap is genuinely absent from the
  // payload — so this never claims to be finished, only counts what was spent.
  const nc = daily.netracells;
  tasks.push({
    id: 'netracells',
    name: 'Netracells',
    cadence: 'WEEKLY',
    note:
      nc.used === null
        ? measured
          ? 'The vault run count is not in this account read.'
          : 'The vault run count needs your account.'
        : 'Runs used this period. Your account does not carry the weekly cap, so remaining runs cannot be stated.',
    state: nc.used === null ? 'unknown' : 'open',
    progress: null,
    value: nc.used === null ? null : `${int(nc.used)} used`,
    resetsAtMs: nc.resetsAtMs,
    weight: nc.used === null ? 50 : 76,
  });

  // Blessing and the rank test are cooldowns: open the moment they elapse.
  if (daily.blessingReadyAtMs !== null) {
    const ready = daily.blessingReadyAtMs <= now;
    tasks.push({
      id: 'blessing',
      name: 'Relay blessing',
      cadence: 'COOLDOWN',
      note: ready ? 'Off cooldown. A blessing can be cast in any Relay.' : 'On cooldown since the last blessing.',
      state: ready ? 'open' : 'done',
      progress: null,
      value: ready ? 'ready' : null,
      resetsAtMs: ready ? null : daily.blessingReadyAtMs,
      weight: ready ? 62 : 20,
    });
  }

  if (daily.masteryTestAtMs !== null) {
    const ready = daily.masteryTestAtMs <= now;
    tasks.push({
      id: 'mastery-test',
      name: 'Mastery rank test',
      cadence: 'COOLDOWN',
      note: ready
        ? 'The test is unlocked. Whether you have the mastery for the next rank is a separate question.'
        : 'Locked after a failed or passed attempt.',
      state: ready ? 'open' : 'done',
      progress: null,
      value: ready ? 'unlocked' : null,
      resetsAtMs: ready ? null : daily.masteryTestAtMs,
      weight: ready ? 58 : 18,
    });
  }

  tasks.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
  return tasks;
}

/** `/Lotus/Types/Enemies/Grineer/Butcher` -> `Butcher`. */
function prettyPath(path: string): string {
  const tail = path.split('/').filter(Boolean).at(-1);
  return (tail ?? path).replace(/([a-z])([A-Z])/g, '$1 $2');
}

/* ------------------------------------------------------------ syndicate names */

/**
 * Tag -> the name the game shows. Only the pools with a verified daily counter
 * in `subsystems.ts` are named here; anything else falls back to its raw tag,
 * which is honest and still greppable.
 */
const SYNDICATE_NAMES: Readonly<Record<string, string>> = {
  CetusSyndicate: 'Ostrons',
  SolarisSyndicate: 'Solaris United',
  EntratiSyndicate: 'Entrati',
  EntratiLabSyndicate: 'Cavia',
  ZarimanSyndicate: 'The Holdfasts',
  KahlSyndicate: "Kahl's Garrison",
  LibrarySyndicate: 'Cephalon Simaris',
  HexSyndicate: 'The Hex',
  SteelMeridianSyndicate: 'Steel Meridian',
  ArbitersSyndicate: 'Arbiters of Hexis',
  CephalonSudaSyndicate: 'Cephalon Suda',
  PerrinSyndicate: 'The Perrin Sequence',
  RedVeilSyndicate: 'Red Veil',
  NewLokaSyndicate: 'New Loka',
  ConclaveSyndicate: 'Conclave',
  QuillsSyndicate: 'The Quills',
  VentKidsSyndicate: 'Vent Kids',
  VoxSyndicate: 'Vox Solaris',
  NecraloidSyndicate: 'Necraloid',
};

const syndicateName = (tag: string): string => SYNDICATE_NAMES[tag] ?? tag.replace(/Syndicate$/, '');

/* --------------------------------------------------------------------- marks */

const STATE_INK: Record<TaskState, string> = {
  open: 'var(--color-orokin-400)',
  unknown: 'var(--color-signal-warn)',
  done: 'var(--color-signal-good)',
};

/** The status diamond. Filled and lit when open, ticked when spent, ringed when unknown. */
function Mark({ state }: { state: TaskState }) {
  const ink = STATE_INK[state];
  return (
    <span aria-hidden className="relative grid h-6 w-6 shrink-0 place-items-center">
      <span
        className="absolute h-5 w-5 rotate-45"
        style={{ boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${ink} ${state === 'done' ? 40 : 70}%, transparent)` }}
      />
      {state === 'open' && <span className="h-2.5 w-2.5 rotate-45" style={{ background: ink }} />}
      {state === 'unknown' && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M4 4.3a2 2 0 1 1 2.6 2.1c-.5.2-.7.6-.7 1.1v.4"
            stroke={ink}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <circle cx="5.9" cy="10" r="0.8" fill={ink} />
        </svg>
      )}
      {state === 'done' && (
        <svg width="11" height="9" viewBox="0 0 11 9" fill="none" aria-hidden>
          <path d="M1 4.6 L4 7.6 L10 1" stroke={ink} strokeWidth="1.6" />
        </svg>
      )}
    </span>
  );
}

/* ----------------------------------------------------------------- task rows */

function SectionTitle({ children, count, note }: { children: string; count?: number; note?: string }) {
  return (
    <header className="mb-2.5 flex items-baseline gap-3">
      <h2
        className="font-[family-name:var(--font-title)] text-[length:var(--text-small)] tracking-[0.26em] uppercase"
        style={{ color: 'var(--color-orokin-300)' }}
      >
        {children}
      </h2>
      {count !== undefined && (
        <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text-faint)' }}>
          {count}
        </span>
      )}
      <span
        aria-hidden
        className="h-px flex-1"
        style={{ background: 'var(--rule-hairline)' }}
      />
      {note !== undefined && <span className="eyebrow">{note}</span>}
    </header>
  );
}

function TaskRow({
  task,
  index,
  now,
  sharedReset,
}: {
  task: Task;
  index: number;
  now: number;
  /**
   * The reset the hero already counts down, at four times this size.
   *
   * Four rows ran to the same 00:00 UTC daily reset, so the same "14m 13s" was
   * printed five times on one screen. A row only shows a clock when it runs to
   * its OWN deadline — a cooldown, or the Entrati vault week.
   */
  sharedReset: number | null;
}) {
  const ink = STATE_INK[task.state];
  const open = task.state === 'open';
  const until =
    task.resetsAtMs === null || task.resetsAtMs === sharedReset ? null : Math.max(0, task.resetsAtMs - now);
  // Amber once a gate is inside the last hour of its window: the only place on
  // this panel where a row changes colour on its own.
  const clockInk = until !== null && until < 3_600_000 ? 'var(--color-signal-warn)' : 'var(--text-muted)';

  /*
   * THE NOTE MOVED ONE LEVEL DOWN, AND THAT IS THE WHOLE CHANGE.
   *
   * Every row printed its `note` — a full sentence, up to 76 characters wide —
   * permanently, on eleven rows, in three bands. That is the wall: eleven
   * paragraphs of explanation stacked under eleven headings, all at the same
   * weight, when the reader came to find out whether they still have focus to
   * earn. The state mark, the name, the cadence and the number stay on the
   * closed row, because a row that says nothing when closed is a row nobody
   * opens. The sentence explaining WHY is one press away.
   *
   * The UNVERIFIED rows are the exception the design has to survive: for them
   * the note IS the row's content, because there is no number to give. So they
   * open by default is NOT the answer — instead their answer reads "cannot be
   * confirmed", which states the verdict without the paragraph.
   */
  return (
    <li
      className={cx('mo-in-up relative', task.state === 'done' && 'opacity-70')}
      style={{
        '--i': Math.min(index, 12),
        clipPath: CHAMFER,
        background: PLATE,
      } as CSSProperties}
    >
      <span aria-hidden className="absolute top-0 bottom-0 left-0 z-10 w-[2px]" style={{ background: ink, opacity: open ? 1 : 0.5 }} />

      <Disclosure
        depth={1}
        accent={ink}
        eyebrow={task.cadence}
        summary={
          <span className="flex items-center gap-2.5">
            <Mark state={task.state} />
            <span
              className={cx(
                'font-[family-name:var(--font-display)] leading-tight font-semibold',
                open ? 'text-[length:var(--text-body)]' : 'text-[length:var(--text-small)]',
              )}
              style={{ color: open ? 'var(--color-orokin-200)' : 'var(--text)' }}
            >
              {task.name}
            </span>
          </span>
        }
        answer={
          <span className="flex w-[150px] flex-col items-end gap-1.5">
            {/* The closed row's own answer. Never a placeholder: a gate with no
                number to give says what state it is in instead of printing a
                dash that reads as a measured nothing. */}
            <span
              className="numeric text-[length:var(--text-micro)] leading-none"
              style={{ color: task.state === 'unknown' ? ink : open ? ink : 'var(--text-muted)' }}
            >
              {task.value ?? (task.state === 'unknown' ? 'not confirmable' : task.state === 'done' ? 'spent' : 'open')}
            </span>
            {task.progress !== null && (
              // Width, not a transform tween: this panel repaints every second
              // and a tween would never settle between ticks.
              <span aria-hidden className="block h-[3px] w-full overflow-hidden" style={{ background: 'oklch(1 0 0 / 0.07)' }}>
                <span className="block h-full" style={{ width: `${Math.max(2, task.progress * 100)}%`, background: ink }} />
              </span>
            )}
            {until !== null ? (
              <span className="numeric text-[length:var(--text-nano)]" style={{ color: clockInk }}>
                {humanDuration(until)}
              </span>
            ) : (
              /*
               * A weekly gate with no clock says so, rather than leaving the
               * slot blank beside daily rows that have one.
               *
               * Nothing the app reads carries the weekly rollover: the Entrati
               * vault pushes its own reset date and gets a real countdown
               * above, and there is no other weekly reset in the account.
               * Computing "next Monday 00:00 UTC" here would be a number we
               * invented, so the slot states the cadence and a dash instead.
               */
              task.cadence === 'WEEKLY' && (
                <span className="numeric text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
                  — weekly
                </span>
              )
            )}
          </span>
        }
      >
        {/* A div, not a p: `Clamp` renders a block, and a block inside a
            paragraph makes the browser close the paragraph early. */}
        <div className="max-w-[76ch] text-[length:var(--text-micro)] leading-snug" style={{ color: 'var(--text-muted)' }}>
          <Clamp lines={3}>{task.note}</Clamp>
        </div>
      </Disclosure>
    </li>
  );
}

/**
 * A band of tasks, as a disclosure rather than a heading over a list.
 *
 * The panel stacked three headed lists — open, unconfirmed, spent — and every
 * one of them was permanently expanded, so a player with nothing open still
 * scrolled past eleven rows to reach the syndicate pools. The band now states
 * its own count and its own rule on the closed row, and only the band that is
 * the subject of the screen opens by itself.
 */
function Band({
  title,
  note,
  tasks,
  offset,
  now,
  sharedReset,
  defaultOpen = false,
  accent,
}: {
  title: string;
  note: string;
  tasks: Task[];
  offset: number;
  now: number;
  sharedReset: number | null;
  defaultOpen?: boolean;
  accent?: string;
}) {
  if (tasks.length === 0) return null;
  return (
    <section className="mo-arrive">
      <Disclosure
        defaultOpen={defaultOpen}
        accent={accent}
        eyebrow={note}
        summary={
          <span className="font-[family-name:var(--font-title)] text-[length:var(--text-small)] tracking-[0.26em] uppercase" style={{ color: 'var(--color-orokin-300)' }}>
            {title}
          </span>
        }
        answer={
          <span className="numeric">
            {tasks.length} {tasks.length === 1 ? 'gate' : 'gates'}
          </span>
        }
      >
        <ul className="mo-stagger flex flex-col gap-[3px]">
          {tasks.map((t, i) => (
            <TaskRow key={t.id} task={t} index={offset + i} now={now} sharedReset={sharedReset} />
          ))}
        </ul>
      </Disclosure>
    </section>
  );
}

/* --------------------------------------------------------------- syndicates */

/**
 * Per-hub standing pools.
 *
 * The six faction syndicates are deliberately excluded — they all draw on the
 * one shared pool that already has its own checklist row, so listing them here
 * would show the same number six times and imply six separate budgets.
 */
function SyndicateGrid({ rows, now, resetsAtMs }: { rows: SyndicateStanding[]; now: number; resetsAtMs: number | null }) {
  const tracked = rows.filter((s) => !s.sharedPool && !s.isNightwave && s.dailyRemaining !== null);
  const untracked = rows.filter((s) => !s.sharedPool && !s.isNightwave && s.dailyRemaining === null);
  const until = resetsAtMs === null ? null : Math.max(0, resetsAtMs - now);

  return (
    /*
     * THE ONE SECTION ON THIS PANEL WITH NO ENTRANCE, and a frame capture is
     * what noticed: five siblings rise or settle into place and this one
     * popped. It renders seventh, under the hero and two bands, so it is below
     * the fold on every viewport this app runs at - which makes a time-based
     * `mo-in-up` the wrong instrument (on a frozen document timeline it would
     * sit twelve pixels low for ever, and that timeline was measured frozen
     * again today) and `mo-arrive` the right one: progress comes from scroll
     * position, there is no clock in it to stop, and where the browser has no
     * view timelines it does nothing, which beats a stranded entrance.
     */
    <section className="mo-arrive">
      <SectionTitle count={tracked.length} note={until === null ? undefined : `${humanDuration(until)} left`}>
        Daily standing pools
      </SectionTitle>

      {tracked.length === 0 ? (
        <EmptyState
          title="No per-hub pools read"
          detail="Your account carries no hub syndicate with a daily counter yet."
        />
      ) : (
        // Single column below ~640px: an overlay is often docked narrow, and two
        // columns of three-line cells collide long before the text would wrap.
        <div className="mo-stagger grid grid-cols-1 gap-[3px] sm:grid-cols-2 xl:grid-cols-3">
          {tracked.map((s, i) => {
            // Non-null by the filter above; narrowed here so the bar is exact.
            const remaining = s.dailyRemaining ?? 0;
            const left = s.dailyCap === null || s.dailyCap <= 0 ? null : Math.min(1, remaining / s.dailyCap);
            const spentOut = remaining === 0;
            const ink = spentOut ? 'var(--color-void-500)' : 'var(--color-orokin-400)';
            return (
              /*
               * Each card is a way into that syndicate's ladder.
               *
               * This card answers "how much can I still earn today"; the very
               * next question is always "and what does it get me" - how far the
               * next rank is, how many days at this rate. The Syndicates panel
               * answers exactly that and there was no way to get to it from here
               * except the nav rail and a hunt down a list of twenty-two.
               */
              <button
                type="button"
                key={s.tag}
                onClick={() => {
                  navigate('syndicates');
                }}
                title={`Open ${syndicateName(s.tag)} in Syndicates`}
                /*
                 * `.rf-row` is already on the document pointer tracker's
                 * selector list, so `mo-sheen` gets its cursor-following light
                 * here with no extra class and, more to the point, no React
                 * handler per card.
                 */
                className={cx(
                  'rf-row rf-clipped mo-sheen mo-lift mo-focusable mo-in-up w-full px-4 py-2.5 text-left',
                  spentOut && 'opacity-60',
                )}
                style={{
                  clipPath: CHAMFER,
                  background: PLATE,
                  '--i': Math.min(i, 12),
                  '--rf-row-accent': ink,
                } as React.CSSProperties}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className="font-[family-name:var(--font-display)] text-[length:var(--text-small)] font-semibold"
                    style={{ color: spentOut ? 'var(--text-muted)' : 'var(--color-orokin-200)' }}
                  >
                    {syndicateName(s.tag)}
                  </span>
                  <span className="numeric shrink-0 text-[length:var(--text-micro)]" style={{ color: 'var(--text)' }}>
                    {int(remaining)}
                    {s.dailyCap !== null && <span style={{ color: 'var(--text-faint)' }}> / {int(s.dailyCap)}</span>}
                  </span>
                </div>
                {/* Drains toward empty: a long bar is standing still to be earned,
                    which is exactly the thing worth walking to a hub for. No cap
                    means no fraction to draw, and a floored 2% stub read as "you
                    are nearly out" — a claim about the day made out of a missing
                    cap. Omitted instead, the way TaskRow omits a null meter. */}
                {left !== null && (
                  <span
                    aria-hidden
                    className="mt-1.5 block h-[3px] w-full overflow-hidden"
                    style={{ background: 'oklch(1 0 0 / 0.07)' }}
                  >
                    <span className="block h-full" style={{ width: `${Math.max(2, left * 100)}%`, background: ink }} />
                  </span>
                )}
                <div className="mt-1.5 flex items-center justify-between text-[length:var(--text-nano)]">
                  <span style={{ color: 'var(--text-muted)' }}>{s.rank === null ? 'rank unknown' : `rank ${s.rank}`}</span>
                  <span className="numeric" style={{ color: 'var(--text-muted)' }}>
                    {int(s.standing)} held
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {untracked.length > 0 && (
        <div className="mt-3 text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
          <Clamp lines={2}>
            Today’s standing for {untracked.map((s) => syndicateName(s.tag)).join(', ')} is not tracked here yet — their
            standing is shown as the total held, never as what is left to earn today.
          </Clamp>
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------------- hero */

/**
 * The single bold element on the panel: how long is left before everything on
 * it resets. The count of open gates rides alongside it because those are the
 * only two numbers that decide whether you log in tonight.
 *
 * The old version of this sat inside an `EnergyField` — a drifting cyan bloom
 * behind gold text. It cost a scrim to stay readable and still read as a cheap
 * lens flare. The plate below is flat, cut, and legible at every intensity.
 */
function Hero({
  open,
  unknown,
  resetsAtMs,
  now,
  measured,
  next,
}: {
  open: number;
  unknown: number;
  resetsAtMs: number;
  now: number;
  /**
   * The one thing to do first, or null when nothing can be confirmed open.
   *
   * A COUNT IS NOT AN INSTRUCTION. "Four things still open" was the largest
   * sentence on this panel and it left the reader to scroll, read four rows,
   * work out which expires soonest and decide - which is the whole job the
   * panel was supposed to have done. The rows are already sorted by what
   * actually expires first, so the answer was sitting in `openTasks[0]` and was
   * simply never said out loud.
   */
  next: Task | null;
  /**
   * Whether there is an account to count against.
   *
   * Without one, `open` is 0 because nothing CAN be settled - not because
   * nothing is outstanding. Printing "0 things still open" beside a running
   * clock is the panel's most prominent line and it was stating, in the largest
   * type on the screen, a fact it had no basis for.
   */
  measured: boolean;
}) {
  // Never negative and never past a day: the reset is the next 00:00 UTC.
  const until = Math.min(DAY_MS, Math.max(0, resetsAtMs - now));
  // The bar drains over the UTC day.
  const left = until / DAY_MS;
  // Inside the last hour the reset itself is the urgent thing on screen.
  const ink = until < 3_600_000 ? 'var(--color-signal-warn)' : 'var(--color-orokin-200)';

  return (
    // The one plate on the panel that reacts to the pointer in three dimensions.
    // `mo-tilt` reads the signed offset the document tracker writes and turns the
    // card a few degrees toward the cursor; `mo-sheen` puts the light where the
    // cursor is. Both are hover-driven, so neither can be caught mid-flight by a
    // stopped document timeline — see the family rules in motion.css.
    /*
     * THE FIRST PANEL TO WEAR THE FRAME (UI-SPEC §2.0, Wave 2).
     * ────────────────────────────────────────────────────────
     * This plate was already the frame by hand - a clipped rim, one pixel of
     * padding, a clipped fill - minus the two things the hand version could
     * not do: the compensated inner notch, so the diagonal is not thicker
     * than the edges, and the measured second hairline at 56% following the
     * chamfer. `.wf-frame` supplies both; the rim and fill it always had are
     * passed through as `--frame-edge` / `--frame-fill`.
     *
     * TWO DECISIONS, STATED. `--notch` is the app's 10px cut, not the frame's
     * 22px default, so the size does not change. And the cut now points
     * top-left / bottom-right: the research measured the game's cuts pointing
     * AWAY from screen centre, and the spec's Panel defaults to exactly that
     * with `mirror` reserved for a right-hand rail. The app's uniform
     * top-right / bottom-left was one direction applied regardless of
     * position. This plate is the representative sample; the rest follow the
     * same recipe, each with its own before-and-after.
     */
    <section
      className="wf-frame mo-field mo-tilt mo-sheen mo-in-settle relative isolate shrink-0"
      style={
        {
          '--notch': 'var(--cut-base)',
          '--frame-edge': 'var(--plate-gold-rim)',
          '--frame-fill': 'var(--plate-gold-fill)',
        } as CSSProperties
      }
    >
      <div className="wf-fill relative px-7 py-6">
        {/*
          Absolutely positioned, `pointer-events: none`, inset six pixels inside
          twenty-four of padding: it cannot overlap content whatever the paint
          order. (A first comment here claimed DOM order put it beneath the
          content; a positioned box paints after in-flow content regardless.)
        */}
        <div className="wf-hairline" aria-hidden />
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="size-[5px] rotate-45" style={{ background: 'var(--color-orokin-400)' }} />
          <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
            Before 00:00 UTC
          </span>
          <span className="eyebrow ml-auto">daily reset</span>
        </div>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="stat text-[length:var(--text-hero)] leading-none" style={{ color: ink }}>
            {hm(until)}
          </span>
          <span
            className="font-[family-name:var(--font-display)] text-[length:var(--text-lead)]"
            style={{ color: 'var(--text)' }}
          >
            {!measured
              ? 'nothing counted yet'
              : open === 1
                ? '1 thing still open'
                : `${int(open)} things still open`}
          </span>
        </div>

        {/* ---------------------------------------------- the one instruction */}
        {next !== null && (
          <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="eyebrow shrink-0" style={{ color: 'var(--color-orokin-300)' }}>
              Do this first
            </span>
            <span
              className="font-[family-name:var(--font-title)] text-[length:var(--text-lead)] leading-none tracking-[0.04em]"
              style={{ color: 'var(--color-orokin-200)' }}
            >
              {next.name}
            </span>
            {next.value !== null && (
              <span className="numeric text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
                {next.value}
              </span>
            )}
            <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
              {next.note}
            </span>
          </div>
        )}

        {/* The day, draining. Width rather than a tween: the panel repaints every
            second and a transform tween would never settle between ticks. */}
        <span
          aria-hidden
          className="mt-4 block h-[4px] w-full overflow-hidden"
          style={{ clipPath: CLIP.meter, background: 'oklch(0 0 0 / 0.45)' }}
        >
          <span className="block h-full" style={{ width: `${Math.max(0.5, left * 100)}%`, background: ink }} />
        </span>

        <p className="wf-prose mt-3">
          {unknown > 0
            ? // With no account they are unknown because nothing has been read;
              // with one, the sortie and archon rows stay unknown because the
              // account genuinely does not record which one was TODAY. Two
              // different facts, so two different sentences.
              measured
              ? `${unknown} more are not in your account; they are listed separately rather than guessed.`
              : `${unknown} more need your account; they are listed separately rather than guessed.`
            : 'Every tracked gate was read from your account.'}
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- capacity strip */

/**
 * `nightwaveActsDone` and `sortie.everCompleted` are null when the game never
 * sent the list: "0 Nightwave acts completed" would be a statement about the
 * player produced entirely by our own lack of data.
 */
function Capacity({ daily, measured }: { daily: DailyState; measured: boolean }) {
  /*
   * Three different reasons produce the same dash, and saying the wrong one is
   * its own small lie. `staleAcrossReset` is the interesting case: the account
   * WAS read, it did carry a number, and that number is simply about yesterday.
   */
  const why = (): string =>
    daily.staleAcrossReset
      ? 'reset at 00:00 UTC since your last read \u2014 open Warframe to see today'
      : measured
        ? 'not in this account read'
        : 'needs your account';

  const cells: Array<{ label: string; value: string; sub: string }> = [
    {
      label: 'Trades',
      value:
        daily.trades.remaining === null
          ? '—'
          : daily.trades.cap === null
            ? int(daily.trades.remaining)
            : `${int(daily.trades.remaining)} / ${int(daily.trades.cap)}`,
      // Not the raw field name. `TradesRemaining absent` is a note to whoever
      // wrote the parser, printed at a player who has no idea what that is; the
      // fact they need is simply that the game has not told us yet.
      sub: daily.trades.remaining === null ? why() : 'resets with the day',
    },
    {
      label: 'Gifts',
      value:
        daily.gifts.remaining === null
          ? '—'
          : daily.gifts.cap === null
            ? int(daily.gifts.remaining)
            : `${int(daily.gifts.remaining)} / ${int(daily.gifts.cap)}`,
      sub: daily.gifts.remaining === null ? why() : 'resets with the day',
    },
    {
      label: 'Nightwave acts',
      value: daily.nightwaveActsDone === null ? '—' : int(daily.nightwaveActsDone),
      // Same words as the Worldstate panel's Nightwave footer, which states the
      // same split: which acts are running is public, which you have finished
      // is read from your account.
      sub: daily.nightwaveActsDone !== null
        ? 'finished, as your account records them. Which acts are running is public — see Worldstate.'
        : measured
          ? 'The game has not sent which acts you have finished yet. Which acts are running is public — see Worldstate.'
          : 'Whether you have finished one is read from your account. Which acts are running is public — see Worldstate.',
    },
    {
      label: 'Sorties cleared',
      value: daily.sortie.everCompleted === null ? '—' : int(daily.sortie.everCompleted),
      sub:
        daily.sortie.everCompleted !== null ? 'lifetime' : measured ? 'the game has not sent the sortie history yet' : 'needs your account',
    },
  ];

  /*
   * FOUR NUMBERS, AND FOUR REASONS THEY ARE WHAT THEY ARE.
   *
   * The `sub` line under each cell is the honest half of this strip and it is
   * also the longest thing in it: the Nightwave one runs to two full sentences
   * about which half is public and which is read from the account. Four of them
   * printed permanently, in a four-column grid, made a caption block taller
   * than the numbers it was captioning. The number and its label are the answer
   * and stay on the closed row; the reason it says what it says is one press
   * down.
   */
  return (
    <div className="mo-stagger grid shrink-0 grid-cols-2 gap-[3px] lg:grid-cols-4">
      {cells.map((c, i) => (
        <div
          key={c.label}
          className="rf-plate mo-field mo-sheen mo-lift mo-in-up"
          style={{ '--i': i, clipPath: CHAMFER, background: PLATE } as CSSProperties}
        >
          <Disclosure
            eyebrow={c.label}
            summary={
              <span className="numeric text-[length:var(--text-lead)] leading-none" style={{ color: 'var(--text)' }}>
                {c.value}
              </span>
            }
            answer={<span className="eyebrow">why</span>}
          >
            <div className="text-[length:var(--text-nano)] leading-snug" style={{ color: 'var(--text-muted)' }}>
              <Clamp lines={3}>{c.sub}</Clamp>
            </div>
          </Disclosure>
        </div>
      ))}
    </div>
  );
}

/**
 * The panel WITHOUT an account.
 *
 * Every deadline on this screen is a property of the GAME — the daily counters
 * roll at 00:00 UTC whether or not anyone has looked — so the countdowns are
 * correct before Warframe has ever been launched. Only "have you already used
 * it" comes out of the account, and each of those rows already reads as
 * unverified by construction.
 *
 * Refusing to render the whole panel over that one missing half was the same
 * mistake the star chart and the progression board used to make.
 */
function AccountBanner({ running, gep }: { running: boolean; gep: string }) {
  const [title, detail] = !running
    ? ([
        'Showing the clocks, your usage unmeasured',
        'Every reset time here is game data and is running now. Which gates you have already spent today is read from your account — run Warframe once and it is captured and kept.',
      ] as const)
    : gep === 'connected'
      ? ([
          'Linked — waiting for your account',
          'The gates fill in on the next account update the game pushes, usually within a minute of loading into the Orbiter.',
        ] as const)
      : ([
          'Linking to the game',
          'Establishing the game-events connection. This takes a few seconds after launch.',
        ] as const);

  /*
   * The heading is the state; the paragraph is the explanation. Nested, so the
   * first thing on the panel is not four lines of prose above the clock the
   * player opened it for.
   */
  return (
    <section
      className="mo-in-up"
      style={{
        clipPath: CHAMFER,
        background: 'linear-gradient(168deg, oklch(0.17 0.03 80 / 0.55), oklch(0.12 0.02 70 / 0.6))',
        boxShadow: 'inset 2px 0 0 var(--color-orokin-500)',
      }}
    >
      <Disclosure summary={title} eyebrow="account" answer="what would change it" accent="var(--color-orokin-300)">
        <div className="text-[length:var(--text-small)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          <Clamp lines={2}>{detail}</Clamp>
        </div>
      </Disclosure>
    </section>
  );
}

/* -------------------------------------------------------------------- panel */

/** Soonest reset first inside a band; a gate with no clock sorts last. */
function bySoonest(a: Task, b: Task): number {
  return (a.resetsAtMs ?? Infinity) - (b.resetsAtMs ?? Infinity) || b.weight - a.weight;
}

export default function DailyPanel() {
  const inventory = useAccount((s) => s.inventory);
  const gameRunning = useAccount((s) => s.gameRunning);
  const gep = useAccount((s) => s.gep);
  const now = useNow(1000);

  // The GEP payload and `RawAccount` describe the same bytes with different
  // precision, and `subsystems.ts` re-validates every field at runtime anyway,
  // so this cast asserts nothing the module then trusts.
  const derived = useMemo(() => {
    if (!inventory) return null;
    const acc = inventory as unknown as RawAccount;
    return {
      daily: dailyState(acc),
      syndicates: syndicateState(acc),
    };
  }, [inventory]);

  /**
   * The daily reset is the GAME's, not the account's.
   *
   * The stored `NextRefill` names whatever instant the game last sent, and a
   * kept read is stale within a day of capture - the hero then counted to a
   * moment already gone. Every countdown here runs to the next 00:00 UTC from
   * the clock instead, with or without an account. `dailyState({})` returns
   * null for each pool, which is exactly right: an absent field is not a zero.
   */
  const resetAt = nextDailyResetUtc(now);
  const daily = useMemo(
    () => ({ ...(derived ? derived.daily : dailyState({} as RawAccount)), resetsAtMs: resetAt }),
    [derived, resetAt],
  );

  // Split from the derivation above: the cooldown rows flip on the clock, so
  // this recomputes each tick while the expensive parse does not.
  const tasks = useMemo(() => buildTasks(daily, now, derived !== null), [daily, now, derived]);

  // Presentation ordering only: inside each band, whatever expires soonest leads.
  const allOpen = tasks.filter((t) => t.state === 'open').sort(bySoonest);
  const allUnknown = tasks.filter((t) => t.state === 'unknown').sort(bySoonest);
  const allDone = tasks.filter((t) => t.state === 'done').sort(bySoonest);
  const syndicates = derived ? derived.syndicates : null;

  /*
   * WHICH CLOCK — the control this panel did not have.
   *
   * Every row already carried a cadence chip: DAILY, WEEKLY, COOLDOWN. The
   * panel computed that fact eleven times, printed it eleven times, and offered
   * no way to ask "what is on the weekly clock" — which is the question a
   * player has on a Sunday and cannot answer without reading every row. Three
   * click handlers in a thousand lines, and this was one of the two missing.
   *
   * The bands filter; the hero does NOT. The hero states how much of the day is
   * outstanding, which is a fact about the account and must not move because
   * somebody narrowed a list.
   */
  const [cadence, setCadence] = useState<'ALL' | 'DAILY' | 'WEEKLY' | 'COOLDOWN'>('ALL');
  const keep = (t: Task): boolean => cadence === 'ALL' || t.cadence === cadence;
  const openTasks = allOpen.filter(keep);
  const unknownTasks = allUnknown.filter(keep);
  const doneTasks = allDone.filter(keep);
  const countOf = (c: string): number => tasks.filter((t) => t.cadence === c).length;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      {!derived && <AccountBanner running={gameRunning} gep={gep} />}

      {/* The hero counts the DAY, never the filter: `allOpen`, not `openTasks`. */}
      <Hero
        open={allOpen.length}
        unknown={allUnknown.length}
        resetsAtMs={daily.resetsAtMs}
        now={now}
        measured={derived !== null}
        /* Already sorted by what expires soonest, so the head of the list is
           the answer - it just had to be said rather than counted. */
        next={allOpen[0] ?? null}
      />

      <Capacity daily={daily} measured={derived !== null} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="eyebrow" style={{ color: 'var(--color-orokin-300)' }}>
          Gates
        </span>
        <Segmented
          label="Which clock to show"
          value={cadence}
          onChange={setCadence}
          options={[
            { id: 'ALL', label: 'All', badge: tasks.length, hint: 'Every gate on the panel' },
            { id: 'DAILY', label: 'Daily', badge: countOf('DAILY'), hint: 'Rolls at 00:00 UTC' },
            { id: 'WEEKLY', label: 'Weekly', badge: countOf('WEEKLY'), hint: 'Rolls once a week' },
            { id: 'COOLDOWN', label: 'Cooldown', badge: countOf('COOLDOWN'), hint: 'Runs from your last use, not from a reset' },
          ]}
        />
      </div>

      {/* The band that is the subject of the screen, and the only one that
          opens by itself. */}
      <Band
        title="Still open"
        note="soonest first"
        tasks={openTasks}
        offset={0}
        now={now}
        sharedReset={daily.resetsAtMs}
        defaultOpen
        accent="var(--color-orokin-400)"
      />

      {/* Only WITH an account. Without one the banner at the top of the panel
          already says the clocks are running and your usage has not been read;
          this plate said the same thing again, two hundred pixels lower. */}
      {/* `allOpen`, not `openTasks`: "nothing is open" is a claim about the day.
          Said off a filtered list it would announce that nothing is open every
          time somebody looked at only the weekly gates. */}
      {allOpen.length === 0 && derived && (
        /*
         * A NOTICE, not an empty state.
         *
         * This used `EmptyState`, which is built to fill a panel that has nothing
         * in it - a 52px crest, `py-12`, everything centred. Measured here at 285
         * x 1,159px for three lines of text, and it is not filling a void at all:
         * the unconfirmed section sits directly underneath it with rows in
         * it. A full-panel treatment used mid-flow reads as an unfinished box
         * rather than as an explanation of the section below.
         *
         * The panel already has the right shape for this - the same chamfered,
         * left-lit plate its account banner uses - so this reuses it rather than
         * introducing a third look.
         */
        <section
          className="mo-in-up"
          style={{
            clipPath: CHAMFER,
            background: 'linear-gradient(168deg, oklch(0.17 0.03 80 / 0.5), oklch(0.12 0.02 70 / 0.55))',
            boxShadow: 'inset 2px 0 0 var(--color-orokin-500)',
          }}
        >
          <Disclosure
            summary="Nothing left that can be confirmed open"
            eyebrow="today"
            answer="all spent or on cooldown"
            accent="var(--color-orokin-300)"
          >
            <div className="max-w-[92ch] text-[length:var(--text-small)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              <Clamp lines={2}>
                Every gate this panel can confirm from your account is spent or on cooldown. The unverified rows below
                are still worth a look.
              </Clamp>
            </div>
          </Disclosure>
        </section>
      )}

      {/* Two different facts, so two different titles: with no account these are
          unknown because nothing has been read; with one, the sortie and archon
          rows stay unknown because the account records every clear ever, never
          which one was today. */}
      <Band
        // "Not confirmed" in both states: some rows need the account, and some
        // the game never reports even with it, so a heading promising the
        // account would answer them contradicted its own rows.
        title="Not confirmed"
        note={derived ? 'your account does not carry these' : 'not read yet'}
        tasks={unknownTasks}
        offset={openTasks.length}
        now={now}
        sharedReset={daily.resetsAtMs}
        accent="var(--color-signal-warn)"
      />

      {/* Per-syndicate pools are pure account state — there is no catalog half
          to show — so the grid is omitted entirely rather than rendered as a
          row of dashes that would imply the syndicates themselves are missing. */}
      {syndicates !== null && (
        <SyndicateGrid rows={syndicates.syndicates} now={now} resetsAtMs={daily.resetsAtMs} />
      )}

      <Band
        title="Spent for today"
        note="reference only"
        tasks={doneTasks}
        offset={openTasks.length + unknownTasks.length}
        now={now}
        sharedReset={daily.resetsAtMs}
        accent="var(--color-signal-good)"
      />

      {/* No closing paragraph. It restated the panel's own design rule — which
          values are read and which are marked — and every row it described
          already says so on its own line. The root's `p-6` is the bottom gutter. */}
    </div>
  );
}
