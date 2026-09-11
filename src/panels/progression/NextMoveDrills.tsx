/**
 * The second and third "how?" under "Do this next", as their own component.
 *
 * Cut from `NextMove` verbatim the day react-doctor called it a giant: the
 * drills doubled its length, and a component that holds the verdict, the
 * sentence, two drills and the plan is four things wearing one name. Nothing
 * here decides anything - every figure is read off `Solved`, which is why it
 * can be moved without a test changing.
 *
 * `titleOf` comes in as a prop rather than being re-derived from the graph,
 * so the two components cannot drift on how a vertex is named.
 */
import type { Solved } from '../../data/leverage';
import { Disclosure } from '../../ui/Disclosure';
import { PROVENANCE } from '../../ui/provenance';

/** "How long, and how that is known": each path member, its minutes, and the claim it makes. */
function CostDrill({ solved, head, atLeast }: { solved: Solved; head: string; atLeast: boolean }) {
  return (
    <>
  {/*
    THE SECOND AND THIRD "HOW?", AND WHY THEY ARRIVED LATE.
    ────────────────────────────────────────────────────────
    The fifth quality measurement opened every control on every tab and
    reported what was REACHABLE. On NOW - the tab every session opens on -
    "how?" ended after one click; the Vault reached three levels and the
    Star Chart two. Yet the sentence above prints two figures the engine had
    already worked out in full and then thrown away: "369 objectives sit
    behind it" is a sum over a set it never named, and "about 21 minutes" is
    a sum over path members whose minutes and provenance it summed and
    dropped. Both drills below are those two sums, un-summed.

    They use the platinum chain's own `Link` shape and provenance words, so
    a reader who has learned what "measured" and "from the game" mean on one
    panel is not taught a second vocabulary on this one.
  */}
  {solved.costLinks.get(head) !== undefined && (solved.costLinks.get(head)?.length ?? 0) > 0 && (
    <Disclosure
      className="mt-3"
      accent="var(--color-tenno-300)"
      eyebrow="how long, and how that is known"
      summary={solved.costUnit === 'minutes' ? 'What the minutes are made of' : 'What the count is made of'}
      answer={
        <span>
          {String(solved.costLinks.get(head)?.length ?? 0)} {(solved.costLinks.get(head)?.length ?? 0) === 1 ? 'step' : 'steps'}
          {atLeast ? ' · one or more not timed' : ''}
        </span>
      }
    >
      <div className="flex flex-col gap-1">
        {(solved.costLinks.get(head) ?? []).map((l) => (
          /*
           * Each member opens to the sentence it claims - the level a
           * score could never have, because "-1.5" has nothing under it
           * and "your median for Capture across 4 runs" does.
           */
          <Disclosure
            key={l.id}
            depth={1}
            eyebrow={PROVENANCE[l.from].word}
            accent={PROVENANCE[l.from].ink}
            summary={l.label}
            answer={
              <span className="numeric">
                {l.value === null ? 'not timed' : `${String(Math.round(l.value * 10) / 10)} ${l.unit === 'minutes' ? 'min' : ''}`.trim()}
              </span>
            }
          >
            <p className="wf-prose">
              {l.note}
            </p>
          </Disclosure>
        ))}
      </div>
    </Disclosure>
  )}
    </>
  );
}

/** "What stands behind it": the dominated set by planet, each node with its own gate and cost. */
function BehindDrill({ solved, head, unit, titleOf }: { solved: Solved; head: string; unit: string; titleOf: (id: string) => string }) {
  return (
    <>
  {(solved.behind.get(head)?.length ?? 0) > 0 && (
    <Disclosure
      className="mt-3"
      accent="var(--color-tenno-300)"
      eyebrow="what stands behind it"
      summary="Which objectives this one opens"
      answer={
        <span>
          {String(solved.behind.get(head)?.reduce((n, g) => n + g.ids.length, 0) ?? 0)} across{' '}
          {String(solved.behind.get(head)?.length ?? 0)} {(solved.behind.get(head)?.length ?? 0) === 1 ? 'place' : 'places'}
        </span>
      }
    >
      <div className="flex flex-col gap-1">
        {(solved.behind.get(head) ?? []).map((grp) => (
          <Disclosure
            key={grp.planet}
            depth={1}
            eyebrow={`${String(grp.ids.length)} ${grp.ids.length === 1 ? 'objective' : 'objectives'}`}
            summary={grp.planet}
            answer={<span className="numeric">{String(grp.ids.length)}</span>}
          >
            <div className="flex flex-col gap-1">
              {grp.ids.map((id) => {
                /*
                 * THE THIRD LEVEL IS REAL, NOT PADDING. Every vertex already
                 * carries its own gate, cost and reason from the same solve,
                 * so a node behind E Prime can say what stands behind IT, and
                 * how long it is - the same two answers, one step down.
                 */
                const g2 = solved.gate.get(id) ?? null;
                const c2 = solved.cost.get(id) ?? null;
                const own = g2 == null ? null : g2 - (solved.value.get(id) ?? 0);
                /*
                 * COUNT WITH domCount, VALUE WITH own. A review caught the
                 * first draft printing "nothing behind it" under Mastery for
                 * nodes that dominate one or two nodes whose payout the
                 * dataset never recorded: `own` sums only recorded values,
                 * so absent was rendered as zero - the mistake this whole app
                 * exists to refuse. `domCount` counts vertices and is in
                 * objectives whatever the goal; `own` is in the goal's unit
                 * and was also being printed as "objectives".
                 */
                const dc = solved.domCount.get(id) ?? 0;
                const why = solved.reason.get(id) ?? null;
                return (
                  <Disclosure
                    key={id}
                    depth={2}
                    /*
                     * WORDED FROM THE PICTURE. The first render read
                     * "0 BEHIND IT · Armatus · about 813 min", and 813 is
                     * true - it is the whole path from a fresh account to
                     * Armatus at the slowest measured pace - but beside a
                     * zero it read as the node's own length. The cost is
                     * TO REACH, and a leaf is a leaf, not a zero.
                     */
                    eyebrow={dc === 0 ? 'nothing behind it' : `${String(dc)} behind it`}
                    summary={titleOf(id)}
                    answer={
                      <span className="numeric">
                        {solved.costUnit === 'minutes' && c2 != null && c2 > 0
                          ? `${solved.costAtLeast.get(id) ? 'about ' : ''}${String(Math.round(c2))} min to reach`
                          : c2 != null
                            ? `${String(c2)} ${c2 === 1 ? 'objective' : 'objectives'} to reach`
                            : 'not rated'}
                      </span>
                    }
                  >
                    <p className="wf-prose">
                      {`${String(dc)} ${dc === 1 ? 'objective sits' : 'objectives sit'} behind this one in turn.`}
                      {/*
                        `own` is null exactly when the row's OWN value is
                        unrecorded under this goal (gate is null only then),
                        so the sentence is about the row, not about what is
                        behind it - the first draft said "cannot value what
                        is behind it" under a row with nothing behind it.
                      */}
                      {unit !== 'objectives'
                        ? own == null
                          ? ` Its own ${unit} are not recorded, so this goal cannot value it.`
                          : ` Worth ${String(own)} ${unit} to this goal.`
                        : ''}
                      {why ? ` ${why.charAt(0).toUpperCase()}${why.slice(1)}.` : ''}
                    </p>
                  </Disclosure>
                );
              })}
            </div>
          </Disclosure>
        ))}
      </div>
    </Disclosure>
  )}
    </>
  );
}

export function NextMoveDrills({
  solved,
  head,
  atLeast,
  unit,
  titleOf,
}: {
  solved: Solved;
  head: string;
  /** True when the head's cost carries a stand-in or a null member. */
  atLeast: boolean;
  /** The goal's unit, for the third level's "worth N ..." sentence. */
  unit: string;
  titleOf: (id: string) => string;
}) {
  return (
    <>
      <CostDrill solved={solved} head={head} atLeast={atLeast} />
      <BehindDrill solved={solved} head={head} unit={unit} titleOf={titleOf} />
    </>
  );
}
