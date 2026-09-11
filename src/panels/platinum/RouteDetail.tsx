/**
 * What opens when you click a route.
 *
 * WHAT WAS THERE BEFORE
 * ─────────────────────
 * A wall. Description, then a facts grid, then a numbered guide, then the
 * arithmetic, then an audit trail - every one of them the same small grey type
 * at the same weight, stacked. It contained a great deal of information and
 * presented none of it, because nothing in it was bigger, brighter or nearer
 * than anything else. Clicking a row gave you homework.
 *
 * THE SHAPE INSTEAD
 * ─────────────────
 * Three tiers, and the eye lands on them in order:
 *
 *   THE NUMBER   what this pays, at display size, with the chain that produced
 *                it drawn as a flow rather than listed as steps
 *   THE VERDICT  can you actually do it - gear, mods, frame - as a row of pills
 *                that are green or amber at a glance, not a paragraph to read
 *   THE METHOD   how to run it, numbered, on a spine
 *
 * MOTION HAS A JOB HERE
 * ─────────────────────
 * The chain stages draw in left to right, in sequence, because the arithmetic
 * READS left to right - runs, times drops, times price. The stagger is the
 * explanation, not decoration.
 *
 * It is TRANSFORM ONLY on a `backwards` fill. This comment used to say
 * "transform-and-opacity", which the code beneath it has never done and must
 * never do: a frozen document timeline holds the FROM state for ever, so an
 * opacity of zero there is not a fade that has not started, it is a stage that
 * does not exist. The gate below the file catches the code; nothing caught the
 * comment, and a comment describing a rule violation as normal practice is how
 * the violation gets written next time.
 *
 * Two things beyond the stagger now respond rather than sit there. Each stage
 * takes the shared pointer light, because a stage is a small readout and this
 * app lights readouts; and the spine down the method list draws itself from the
 * SCROLL that reveals it, using the motion layer's own rail rather than a
 * second copy of it.
 */

import type { Ranked } from '../../data/plat-rank';
import type { Expectation } from '../../data/plat-expect';
import { MODEL_GAPS, type Rate } from '../../data/plat-throughput';
import { stepBind, stepText, type RouteGuide, type Step } from '../../data/plat-guide';
import { answers, resolveStep, type StepContext } from '../../data/plat-steps';
import { CAPABILITY_LABEL } from '../../data/plat-capability';
import { Disclosure } from '../../ui/Disclosure';
import { PROVENANCE } from '../../ui/provenance';
import { CHAMFER_SM as CHAMFER } from '../../ui/geometry';


type PillTone = 'good' | 'warn' | 'muted';

const TONE: Record<PillTone, { fg: string; bg: string }> = {
  good: { fg: 'var(--color-signal-good)', bg: 'color-mix(in oklch, var(--color-signal-good) 12%, transparent)' },
  warn: { fg: 'var(--color-signal-warn)', bg: 'color-mix(in oklch, var(--color-signal-warn) 12%, transparent)' },
  muted: { fg: 'var(--text-faint)', bg: 'oklch(1 0 0 / 0.04)' },
};


/* ═══════════════════════════════════════════════════════════════════════════
   THE ESTIMATE

   The ranking is in platinum now, so the panel has to be able to say the
   number and then survive being asked how, and how, and how again. Three
   levels answer three different questions and none of them is a wall:

     THE NUMBER    what you would actually hold, at display size
     THE FACTORS   what was taken off the measured rate, and by how much
     EACH FACTOR   the sentence it claims, which you can disagree with

   The third level is the one that matters and the one a score could never
   have. "-1.5 slow to sell" ends the conversation because there is nothing
   under it. "About a third of a slow-selling haul finds a buyer within one
   session" is a claim about the market, and a player who sells faster than
   that knows something the app does not.
   ═══════════════════════════════════════════════════════════════════════════ */

/** A factor's share, as the percentage a reader can actually hold in mind. */
function share(value: number | null): string {
  if (value === null) return 'unknown';
  if (value === 0) return 'nothing';
  return `${String(Math.round(value * 100))}%`;
}

function EstimateBlock({ e }: { e: Expectation }): React.JSX.Element | null {
  /*
   * Nothing to say at all: no rate, no factors, no gate. Rendering a heading
   * over an empty box is how a panel ends up looking busy and saying nothing,
   * which is the failure this whole redesign is against.
   */
  if (e.perHour === null && e.gatedBy === null && e.blockedBy === null && e.links.length === 0) return null;

  const gated = e.gatedBy !== null;
  const blocked = e.blockedBy !== null;
  const ink = gated ? 'var(--color-signal-warn)' : e.atMost ? 'var(--text-muted)' : 'var(--color-signal-good)';

  /*
   * ONE HEADLINE, AND IT SAYS WHICH OF THE FOUR STATES THIS IS. They are
   * genuinely different answers and the old panel had one shape for all of
   * them, which is how "we have not measured this" and "this pays nothing"
   * ended up looking identical.
   */
  /*
   * "up to" IS NOT PART OF THE NUMBER, and a screenshot is what proved it.
   * Set inside the display-size span, `up to 60` wrapped after "up to" in a
   * narrow column and broke the figure across two lines - the one element on
   * the pane that must never wrap. It is a qualifier on the number, so it is
   * typeset as one: small, ahead of it, and the figure itself never breaks.
   */
  const headline = gated ? 'nothing' : e.perHour === null ? '—' : String(Math.round(e.perHour));
  const caption = gated
    ? (e.gatedBy?.label ?? 'Not available right now')
    : e.perHour === null
      ? 'Never run, so there is no rate to reduce'
      : e.atMost
        ? 'platinum an hour at most, in hand'
        : 'platinum an hour, in hand';

  return (
    <div className="mt-4">
      <div className="flex items-baseline gap-3">
        {e.atMost && !gated && e.perHour !== null && (
          <span className="eyebrow shrink-0" style={{ color: 'var(--text-faint)' }}>
            up to
          </span>
        )}
        <span
          className="numeric"
          style={{
            /*
             * The display size, because this is the answer. See the note above
             * the chain: the two swapped, and a screenshot is what caught it.
             */
            fontSize: 'var(--text-hero)',
            lineHeight: 1,
            letterSpacing: '-0.02em',
            whiteSpace: 'nowrap',
            color: ink,
          }}
        >
          {headline}
        </span>
        <span className="text-[length:var(--text-micro)]" style={{ color: 'var(--text-muted)' }}>
          {caption}
          {/*
            "of 42 measured" is the whole point of showing a reduced number: a
            player who sees 18 and knows their runs pay 42 should be able to
            find out where the other 24 went WITHOUT opening anything, or the
            reduction reads as the app being wrong rather than being careful.
          */}
          {e.fromRate !== null && e.perHour !== null && e.perHour < e.fromRate ? (
            <span style={{ color: 'var(--text-faint)' }}>{` · of ${String(Math.round(e.fromRate))} your runs measured`}</span>
          ) : null}
        </span>
      </div>

      {e.links.length > 0 && (
        <div className="mt-2">
          <Disclosure
            eyebrow="the estimate"
            summary={gated ? 'Why it pays nothing right now' : 'What comes off the measured rate'}
            answer={
              gated
                ? (e.gatedBy?.note ?? '')
                : blocked
                  ? `${e.blockedBy?.label ?? 'One factor'} could not be read, so this is a ceiling rather than a reading`
                  : `${String(e.links.length)} ${e.links.length === 1 ? 'thing' : 'things'} reduce it${
                      e.realised === null ? '' : `, leaving ${share(e.realised)}`
                    }`
            }
            accent={ink}
            depth={1}
          >
            <div className="flex flex-col gap-1">
              {e.links.map((l) => (
                /*
                 * EACH FACTOR OPENS. This is the level the goal keeps asking
                 * for - the reader clicks "how?" and finds a sentence rather
                 * than another number - and it is only possible because every
                 * factor carries a claim it could be wrong about.
                 */
                <Disclosure
                  key={l.label}
                  eyebrow={PROVENANCE[l.from].word}
                  summary={l.label}
                  answer={l.value === null ? 'could not be read' : `${share(l.value)} of the rate`}
                  accent={l.value === null ? 'var(--text-faint)' : l.value === 0 ? 'var(--color-signal-warn)' : 'var(--text-ghost)'}
                  depth={2}
                >
                  <p className="wf-note">
                    {l.note}
                  </p>
                </Disclosure>
              ))}
            </div>
          </Disclosure>
        </div>
      )}
    </div>
  );
}

/**
 * The term that moved this route furthest, for the shut scoring row.
 *
 * Signed, because the largest mover is as often the thing holding a route
 * DOWN as the thing carrying it up, and saying "low setup" when the real story
 * is "needs gear you do not own" would be the ranking flattering itself.
 */
function topReason(reasons: Ranked['reasons']): string {
  let best: Ranked['reasons'][number] | null = null;
  for (const w of reasons) {
    if (best === null || Math.abs(w.delta) > Math.abs(best.delta)) best = w;
  }
  if (best === null) return 'nothing moved it';
  return `${best.delta > 0 ? 'mostly' : 'held back by'} ${best.label.toLowerCase()}`;
}

function Pill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return (
    <span
      className="eyebrow shrink-0 px-2 py-1"
      style={{ clipPath: CHAMFER, color: TONE[tone].fg, background: TONE[tone].bg }}
    >
      {children}
    </span>
  );
}

/**
 * ONE STEP, AND THE ANSWER IT CAN GIVE.
 * ————————————————————————————————————————————
 * The 203 steps in `ROUTE_GUIDE` are the most specific writing in this app and
 * every one of them rendered as a dead string. So the deepest layer of the
 * panel was the only layer with nothing to open, and "pick a fissure whose tier
 * matches your relic" sat two modules from `fissure-match`, which knows both
 * halves of that sentence exactly.
 *
 * A step with a binding the app can answer becomes a disclosure: the sentence
 * stays the summary, the live answer rides on the closed row, and the rows are
 * one press away. It inherits the depth-scaled entrance from the motion layer
 * rather than declaring any of its own, so a step opens the same way as every
 * other nested thing in this app - which is the point of having one.
 *
 * A step with no binding, or a binding that currently resolves to nothing,
 * stays a plain string. An affordance that opens onto "unknown" costs a press
 * to learn the app has nothing, and is worse than the string it replaced. When
 * the reason is knowable it is printed inline instead, muted, so a reader
 * learns the app WOULD answer this once the feed lands.
 */
function StepLine({ step, n, ctx }: { step: Step; n: number; ctx: StepContext | null }) {
  const text = stepText(step);
  const bind = stepBind(step);
  const answer = bind !== null && ctx !== null ? resolveStep(bind, ctx) : null;
  const open = answer !== null && answers(answer);

  return (
    <li className="flex gap-3">
      <span
        className="numeric z-10 mt-[1px] flex h-[15px] w-[15px] shrink-0 items-center justify-center text-[length:var(--text-nano)]"
        style={{
          background: 'oklch(0.11 0.02 265)',
          // A step that can answer is marked at the number, before it is read.
          color: open ? 'var(--color-tenno-300)' : 'var(--color-orokin-300)',
        }}
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        {open && answer !== null ? (
          <Disclosure
            depth={1}
            accent="var(--color-tenno-300)"
            summary={<span className="text-[length:var(--text-micro)] leading-relaxed">{text}</span>}
            answer={
              answer.headline === null ? undefined : (
                <span className="numeric" style={{ color: 'var(--color-tenno-300)' }}>
                  {answer.headline}
                </span>
              )
            }
          >
            {answer.rows.length === 0 ? null : (
              <ul className="flex flex-col gap-0.5">
                {answer.rows.map((row) => (
                  <li key={`${row.lead}:${row.text}`} className="flex min-w-0 items-baseline gap-2">
                    <span
                      className="numeric w-14 shrink-0 text-[length:var(--text-nano)]"
                      style={{
                        color:
                          row.tone === 'good'
                            ? 'var(--color-signal-good)'
                            : row.tone === 'warn'
                              ? 'var(--color-signal-warn)'
                              : 'var(--text-faint)',
                      }}
                    >
                      {row.lead}
                    </span>
                    <span className="min-w-0 text-[length:var(--text-nano)]" style={{ color: 'var(--text-muted)' }}>
                      {row.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Disclosure>
        ) : (
          <>
            <span className="text-[length:var(--text-micro)] leading-relaxed" style={{ color: 'var(--text)' }}>
              {text}
            </span>
            {answer?.unknown != null && (
              <span className="text-[length:var(--text-nano)]" style={{ color: 'var(--text-ghost)' }}>
                {answer.unknown}
              </span>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function RouteDetail({
  r,
  chain,
  guide,
  ctx,
}: {
  r: Ranked;
  chain: Rate | null;
  guide: RouteGuide | null;
  ctx: StepContext | null;
}) {
  const { route } = r.state;

  /*
   * Every readiness fact as one row of pills. A paragraph saying "you do not
   * own a Necramech" and a paragraph saying "you own the mods for this" read
   * identically at a glance; a green pill and an amber one do not.
   */
  const pills: Array<{ tone: PillTone; text: string }> = [];
  for (const g of r.gear) {
    if (g.met === false) pills.push({ tone: 'warn', text: `no ${CAPABILITY_LABEL[g.capability].replace(/^an? /, '')}` });
    else if (g.met === true) pills.push({ tone: 'good', text: CAPABILITY_LABEL[g.capability].replace(/^an? /, '') });
  }
  if (r.shortOf !== null) pills.push({ tone: 'warn', text: r.shortOf });
  if (r.buildShort) pills.push({ tone: 'warn', text: 'missing mods' });
  else if (r.build !== null) pills.push({ tone: 'muted', text: 'mods thin' });
  if (r.loadout) pills.push({ tone: r.loadout.owned ? 'good' : 'muted', text: r.loadout.text.replace(/ —.*$/, '') });

  return (
    <div className="rf-detail px-4 pt-1 pb-4 pl-9">
      <style>{`
        /*
          TRANSFORM ONLY, and the reasoning that nearly put opacity here is
          exactly the fallacy theme.css records: "a disclosure only opens
          because somebody clicked, so the timeline must be running". It is not.
          The click lands, React commits, and the host can stop presenting the
          window in the same breath - leaving every stage at opacity 0 forever.
          The gate caught this, which is the fourth time that argument has been
          made here and the fourth time it has been wrong.
        */
        @keyframes rf-stage-slide { from { transform: translate3d(-10px,0,0); } to { transform: none; } }
        .rf-stage-in { animation: rf-stage-slide 340ms cubic-bezier(0.16, 1, 0.3, 1) backwards; }
        /*
          THE SPINE IS A REAL ELEMENT NOW, AND THAT IS WHAT BOUGHT THE EFFECT.

          It was a ::before on the list, which cannot carry the motion layer's
          mo-rail: a class applies to the element, and scaling the list itself
          would have scaled every step in it. Promoting the line to a span the
          list is positioned around costs one node and lets the shared rail draw
          it from scroll position, with no second copy of the rule here.
        */
        .rf-spine { position: relative; }
        @media (prefers-reduced-motion: reduce) { .rf-stage-in { animation: none; } }
      `}</style>

      {/* ---------------------------------------------------- TIER 1: the number */}
      {/*
        * WHY THERE IS NO NUMBER, when there is no number.
        * ————————————————————————————————————————————
        * Fifteen routes have no throughput model at all, and each one's reason
        * is written down in `MODEL_GAPS` - a Kuva weapon is not a market item
        * so no feed prices it; Varzia appears in no syndicate export; buying
        * low and selling high has no rate because it is bounded by capital
        * rather than by time.
        *
        * Every one of those was a real finding, and not one of them was ever
        * shown: the block below is `chain && (...)`, so a route with no model
        * rendered nothing at all - no figure, no absence, no reason. The
        * player asking "what does this pay?" got silence, which reads as an
        * oversight rather than as an answer.
        */}
      {chain === null && MODEL_GAPS[route.id] !== undefined && (
        <p
          className="mb-4 text-[length:var(--text-body)]"
          style={{ color: 'var(--text-muted)', maxWidth: '60ch' }}
        >
          <span className="eyebrow" style={{ color: 'var(--color-signal-warn)' }}>
            No rate for this one
          </span>{' '}
          {MODEL_GAPS[route.id]}
        </p>
      )}
      {/*
        WHICHEVER NUMBER IS THE ANSWER GETS THE DISPLAY SIZE, AND IT WAS THE
        WRONG ONE.
        ────────────────────────────────────────────────────────────────────
        A screenshot is what showed this. The chain's rate was set at
        `--text-hero` and the estimate below it at `--text-title`, so on a route
        measured at 172 an hour that returns about 60 to the player, the eye
        landed on 172 - an intermediate quantity, the rate for a run - and had
        to be led down to the figure that actually answers the question. The
        hierarchy said the working mattered more than the result.

        So the chain yields when there is a result under it: `172` drops to the
        supporting size and becomes what it is, the provenance of the number
        below. On the many routes with no estimate the chain's rate IS the
        answer and keeps the display size, which is why this is conditional
        rather than a flat reduction.

        One bold move per pane, per the creed. This decides which one it is.
      */}
      {chain && (
        /* The figure on this pane takes a pointer light: rf-lit is fed by the
           one document-level tracker, needs no handler of its own, and lights
           the plate rather than the type sitting on it. */
        <div className="rf-lit relative mb-4">
          <div className="flex flex-wrap items-baseline gap-x-3">
            {chain.perHour === null ? (
              <span className="text-[length:var(--text-lead)]" style={{ color: 'var(--color-signal-warn)' }}>
                No rate — {chain.blockedBy?.label.toLowerCase()}
              </span>
            ) : (
              <>
                <span
                  className="numeric leading-none"
                  style={{
                    fontSize: r.expected.perHour === null ? 'var(--text-hero)' : 'var(--text-lead)',
                    color: r.expected.perHour === null ? 'var(--color-orokin-200)' : 'var(--text-muted)',
                  }}
                >
                  {Math.round(chain.perHour).toLocaleString()}
                </span>
                <span className="eyebrow" style={{ color: 'var(--text-faint)' }}>
                  platinum an hour
                </span>
              </>
            )}
            {chain.fromRuns !== null && (
              <span className="eyebrow" style={{ color: 'var(--color-signal-good)' }}>
                from {String(chain.fromRuns)} of your {chain.fromRuns === 1 ? 'run' : 'runs'}
              </span>
            )}
          </div>

          {/* The chain, drawn as a flow. It reads left to right because the
              arithmetic does, and the stagger is what makes that legible. */}
          <div className="mt-3 flex flex-wrap items-stretch gap-2">
            {chain.links.map((l, i) => (
              <div key={l.label} className="flex items-stretch gap-2">
                {i > 0 && (
                  <span className="self-center text-[length:var(--text-small)]" style={{ color: 'var(--text-ghost)' }}>
                    ×
                  </span>
                )}
                <div
                  className="rf-stage-in rf-lit relative min-w-[9rem] px-3 py-2"
                  style={{
                    clipPath: CHAMFER,
                    background: 'oklch(0 0 0 / 0.26)',
                    animationDelay: `${String(i * 90)}ms`,
                    borderLeft: `2px solid ${PROVENANCE[l.from].ink}`,
                  }}
                >
                  <div className="numeric text-[length:var(--text-small)]" style={{ color: 'var(--text)' }}>
                    {l.value === null ? '—' : l.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                  <div className="eyebrow mt-0.5" style={{ color: 'var(--text-faint)' }}>
                    {l.label}
                  </div>
                  <div className="eyebrow mt-1" style={{ color: PROVENANCE[l.from].ink, opacity: 0.75 }}>
                    {PROVENANCE[l.from].word}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* The note for whichever link is doing the interesting work. */}
          {chain.blockedBy && (
            <p className="wf-prose mt-2">
              {chain.blockedBy.note}
            </p>
          )}
          {chain.cap !== null && (
            <p className="wf-note mt-1" style={{ color: 'var(--color-signal-warn)' }}>
              {chain.cap}
            </p>
          )}
        </div>
      )}

      {/*
        DIRECTLY UNDER THE CHAIN, BECAUSE IT IS THE SAME SENTENCE FINISHED.
        ─────────────────────────────────────────────────────────────────
        This block was first placed at the foot of the panel, beside the
        scoring, and looking at the running app is what showed that to be
        wrong: the number a player came for - what this route pays THEM - sat
        below a description, a facts grid, a verdict row, a four-step guide and
        a paragraph on what people get wrong. Three thousand pixels down.
        Whereas the chain above it ends on "172 platinum an hour", which is a
        rate for a run, and this says how much of that reaches the player. The
        two are one thought and were separated by the entire body of the panel.

        The file's own doctrine at the top says THE NUMBER, then the verdict,
        then the method. The number is this.
      */}
      <EstimateBlock e={r.expected} />

      {/* --------------------------------------------------- TIER 2: the verdict */}
      {pills.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {pills.map((p) => (
            <Pill key={p.text} tone={p.tone}>
              {p.text}
            </Pill>
          ))}
        </div>
      )}

      {/* ---------------------------------------------------- TIER 3: the method */}
      <p className="wf-prose">
        {route.how}
      </p>

      {/*
        THE HALF THE ACCOUNT CANNOT CHECK, WHICH WAS WRITTEN AND NEVER SHOWN.
        ————————————————————————————————————————————
        `alsoNeeds` describes itself as "a requirement the account cannot
        confirm. Stated, never assumed satisfied" - and it was stated nowhere.
        Twenty-seven of the fifty routes carry one, all of it specific and none
        of it derivable from anything else on this screen: Baro's two-week
        cadence, the Dragon Key you have to build first, the night window an
        Eidolon hunt lives inside, the spear and bait a fishing route needs.

        It sits under the method rather than beside the pills on purpose. The
        pills above are CHECKED - green means the account was read and the thing
        was in it. This is prose nobody verified, and putting an unverified
        requirement in the same row as verified ones would make both of them
        mean less. "You will also need" is the whole disclosure: it is a
        requirement, and this app is not claiming to know whether you meet it.

        Routes where the answer IS checkable do not repeat themselves here -
        those became `needsGear` entries and appear as pills.
      */}
      {route.alsoNeeds !== null && (
        <p
          className="wf-prose mt-2"
        >
          <span className="uppercase tracking-[0.14em]" style={{ color: 'var(--color-orokin-300)' }}>
            You will also need
          </span>{' '}
          {route.alsoNeeds}
        </p>
      )}

      {guide && (
        <div className="rf-spine mt-3">
          {/* Decorative, and deliberately so: mo-rail leaves an unreached rail
              at zero height, which is a rail nobody has drawn yet rather than a
              piece of missing content. Every step beside it is already at rest
              whether the rail draws or not. */}
          <span
            aria-hidden
            className="mo-rail absolute top-1 bottom-1 left-[7px] w-px"
            style={{ background: 'linear-gradient(to bottom, var(--color-orokin-400), transparent)' }}
          />
          <ol className="flex flex-col gap-2 pl-0">
            {/*
              The route id is attached HERE and not at the panel, because it is
              the one thing in the context that differs per card - "what does
              this sell" has a different answer for every row on screen, and a
              single shared context could only ever carry one of them.
            */}
            {guide.steps.map((step, i) => (
              <StepLine
                key={stepText(step)}
                step={step}
                n={i + 1}
                ctx={ctx === null ? null : { ...ctx, routeId: route.id }}
              />
            ))}
          </ol>
        </div>
      )}

      {/*
        THE TRAPS, FOLDED, BECAUSE THEY ARE READ AT A DIFFERENT MOMENT.
        ————————————————————————————————————————————
        These were a flat list of amber text at the smallest size in the file,
        sitting under the steps - which is the exact shape this file's own
        header calls a wall: same weight, same size, nothing nearer than
        anything else, and the reader has already spent their attention on the
        numbered method above it.

        A tip is not part of the procedure. It is what you wish you had known
        AFTER a run went wrong, so it earns a row of its own that says how many
        there are and gets out of the way. Amber stays on the summary, because
        the one thing worth carrying at a glance is that these are warnings
        rather than more instructions.
      */}
      {guide?.tips && guide.tips.length > 0 && (
        <div className="mt-2.5 pl-[27px]">
          <Disclosure
            depth={1}
            accent="var(--color-signal-warn)"
            eyebrow="what people get wrong"
            summary={
              <span className="text-[length:var(--text-micro)]" style={{ color: 'var(--color-signal-warn)' }}>
                {guide.tips.length === 1 ? 'The detail that decides this one' : 'The details that decide this one'}
              </span>
            }
            answer={<span className="numeric">{guide.tips.length}</span>}
          >
            <ul className="flex flex-col gap-1.5">
              {guide.tips.map((tip) => (
                <li key={tip} className="text-[length:var(--text-nano)] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {tip}
                </li>
              ))}
            </ul>
          </Disclosure>
        </div>
      )}

      {/* The scoring, folded: it explains the ORDER, which is a question you
          only ask when the order surprises you. */}
      {r.reasons.length > 0 && (
        <div className="mt-3">
          {/*
            A <details> answered nothing when shut - "Why it ranked here" is a
            question, and a closed row that only asks one is a row nobody
            opens. The disclosure carries the term that actually moved this
            route furthest, so the shut state already names the reason.
          */}
          <Disclosure
            eyebrow="the scoring"
            summary="Why it ranked here"
            answer={topReason(r.reasons)}
            accent="var(--text-ghost)"
          >
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {r.reasons.map((w) => (
                <span
                  key={w.label}
                  className="text-[length:var(--text-nano)]"
                  style={{ color: w.delta > 0 ? 'var(--color-signal-good)' : 'var(--color-signal-warn)' }}
                >
                  {w.delta > 0 ? '+' : ''}
                  {Math.round(w.delta * 10) / 10} {w.label}
                </span>
              ))}
            </div>
          </Disclosure>
        </div>
      )}
    </div>
  );
}
