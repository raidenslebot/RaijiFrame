/**
 * The frozen-timeline rule, enforced.
 *
 * WHY THIS SCRIPT EXISTS
 * ──────────────────────
 * This overlay's document timeline STOPS while the window is not being
 * presented. A CSS animation in that state reports `playState: "running"` with
 * `currentTime: 0` forever, so any fill mode that holds the FROM state holds it
 * permanently. An entrance that fades from `opacity: 0` therefore does not
 * "start slightly transparent" - it renders nothing, for as long as the player
 * is looking at the game instead of the overlay, which is most of the time.
 *
 * That has now been got wrong FOUR times, in four different properties, by
 * three different mechanisms: a JS spring, a CSS opacity fade, an animated
 * `grid-template-rows`, and most recently a staged list entrance that animated
 * opacity with `both` fill. Each time it was reasoned about correctly and each
 * time the reasoning missed that the timeline can stop at any moment, including
 * the moment after a click.
 *
 * A comment has failed to prevent this four times, so it is a check now.
 *
 * THE RULE
 * ────────
 * An entrance keyframe may animate TRANSFORM ONLY. Never opacity, never height,
 * never `grid-template-rows`, never `visibility`, never anything whose FROM
 * state makes content unreadable. A frozen timeline must leave content merely
 * offset, never absent.
 *
 * Hover, focus and press effects are exempt and deliberately so: they can only
 * fire while the pointer is over the window, which means the window is being
 * presented, which means the timeline is running.
 *
 * Run: node scripts/check-frozen.ts
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = join(import.meta.dirname, '..', 'src');

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name}`);
    console.log(`          ${err instanceof Error ? err.message : String(err)}`);
  }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (['.css', '.tsx', '.ts'].includes(extname(full))) out.push(full);
  }
  return out;
}

const files = walk(root);

/** Every `@keyframes name { ... }` block in a source string. */
function keyframes(source: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /@keyframes\s+([A-Za-z0-9_-]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    // Walk braces to find the matching close, since keyframe bodies nest.
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    out.push({ name: m[1] ?? '', body: source.slice(re.lastIndex, i - 1) });
  }
  return out;
}

/**
 * Whether a start-state declaration would leave content unreadable.
 *
 * The test is on the VALUE, not the property. `opacity: 0.35` held forever is a
 * dimmed element somebody can still read; `opacity: 0` held forever is missing
 * content. Getting this wrong in the other direction flags every looping pulse
 * in the file, which would make the check noise and then make it ignored.
 *
 * `transform` is absent entirely and on purpose: an offset element is still
 * legible, which is the whole reason the rule permits transforms.
 */
function hidesContent(body: string): string | null {
  const decl = (prop: string): string | null => {
    const m = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`, 'm').exec(body);
    return m ? (m[1] ?? '').trim() : null;
  };

  const opacity = decl('opacity');
  if (opacity !== null && Number.parseFloat(opacity) < 0.05) return `opacity: ${opacity}`;

  const visibility = decl('visibility');
  if (visibility !== null && /hidden|collapse/.test(visibility)) return `visibility: ${visibility}`;

  for (const prop of ['height', 'max-height', 'grid-template-rows', 'grid-template-columns']) {
    const value = decl(prop);
    // 0, 0px, 0fr, 0% - anything that collapses the box to nothing.
    if (value !== null && /^0(px|fr|%|r?em|vh|vw)?$/.test(value)) return `${prop}: ${value}`;
  }

  const scale = decl('scale');
  if (scale !== null && /^0(\s|$)/.test(scale)) return `scale: ${scale}`;

  return null;
}

check('no keyframe can strand content unreadable on a frozen timeline', () => {
  const offenders: string[] = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const frame of keyframes(source)) {
      /*
       * The state a frozen timeline holds is the one at time zero: `from`, or
       * `0%`. A keyframe with neither cannot strand anything at a start state.
       */
      /*
       * A GROUPED START SELECTOR IS STILL A START SELECTOR.
       * ————————————————————————————————————————————
       * This read `(?:from|0%)\s*\{`, so `0%, 20% {` — a start state that
       * HOLDS for the first fifth of the animation — never matched, and the
       * keyframe was silently skipped by the one check in this file that exists
       * to catch the bug that has shipped here four times.
       *
       * Proven rather than argued: a probe keyframe of
       * `0%, 20% { opacity: 0; height: 0; } 100% { transform: none; }` with
       * `animation: … both` passed all three checks. Two live keyframes already
       * use this shape, one of them written in this same rebuild.
       *
       * The trailing group is optional and repeatable, so `from`, `0%`,
       * `0%, 20%` and `from, 30%, 60%` all reach the body.
       */
      const start = /(?:^|\})\s*(?:from|0%)(?:\s*,\s*[\d.]+%)*\s*\{([^}]*)\}/.exec(frame.body);
      if (!start) continue;
      const hidden = hidesContent(start[1] ?? '');
      if (hidden !== null) {
        offenders.push(`${relative(root, file)} @keyframes ${frame.name} starts at ${hidden}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a keyframe starts in a state that hides content, and a frozen timeline holds it there:\n          ${offenders.join('\n          ')}`,
  );
});

/*
 * THE GATE READS ITS OWN PARSER, BECAUSE THE PARSER IS WHERE IT WENT BLIND.
 * ————————————————————————————————————————————
 * Every check in this file finds keyframes with a regex and then reasons about
 * what it found. That makes the regex the single point where the whole file can
 * be silently correct about nothing — and it was: a start state written
 * `0%, 20% {` never matched, so a keyframe opening at `opacity: 0` with a
 * `both` fill sailed through all three checks. Nothing was wrong with the
 * reasoning; the reasoning was handed an empty set.
 *
 * So the parser is exercised on the shapes CSS actually permits, with a case
 * that MUST be seen and a case that must not be confused for a start. A gate
 * whose finder is untested is a gate that reports on whatever it happened to
 * match.
 */
check('the start-state finder sees every spelling of a start', () => {
  const START = /(?:^|\})\s*(?:from|0%)(?:\s*,\s*[\d.]+%)*\s*\{([^}]*)\}/;
  const seen = (body: string): string | null => START.exec(body)?.[1]?.trim() ?? null;

  assert.equal(seen('from { opacity: 0; }'), 'opacity: 0;', 'from');
  assert.equal(seen('0% { opacity: 0; }'), 'opacity: 0;', '0%');
  assert.equal(seen('0%, 20% { opacity: 0; }'), 'opacity: 0;', 'a grouped start - the shape that was invisible');
  assert.equal(seen('from, 30%, 60% { opacity: 0; }'), 'opacity: 0;', 'several grouped stops');
  assert.equal(seen('0% ,  20%  { opacity: 0; }'), 'opacity: 0;', 'and whitespace around the comma');

  // A keyframe with no start at all is not a start of nothing.
  assert.equal(seen('50% { opacity: 0; } to { transform: none; }'), null, 'a midpoint is not a start');
  assert.equal(seen('to { transform: none; }'), null, 'and neither is an end');
});

check('no entrance animation uses a fill mode that holds the start state', () => {
  /*
   * `both` and `backwards` both hold the FROM state before the animation runs.
   * `backwards` is permitted ONLY because the rule above guarantees the FROM
   * state is transform-only and therefore still readable. This check exists to
   * catch the pairing that is never safe: a fill that holds a start state on a
   * keyframe this script cannot see into, i.e. one named in another file.
   */
  const offenders: string[] = [];
  const known = new Set<string>();
  for (const file of files) for (const frame of keyframes(readFileSync(file, 'utf8'))) known.add(frame.name);

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const re = /animation:\s*([A-Za-z0-9_-]+)[^;]*?\b(both|backwards)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const name = m[1] ?? '';
      if (!known.has(name)) offenders.push(`${relative(root, file)} fills backwards from unknown keyframes "${name}"`);
    }
  }

  assert.deepEqual(offenders, [], `a backwards fill on a keyframe this check cannot verify:\n          ${offenders.join('\n          ')}`);
});

check('a time-based entrance ends where the element already sits', () => {
  /*
   * THE CLAIM THE REDUCED-MOTION BLOCK RESTS ON.
   * ────────────────────────
   * `theme.css` turns motion off with `animation: none` rather than the usual
   * "shorten everything to 0.01ms" recipe - measured, because the shortening
   * version left EIGHTEEN animations running on the desktop overlay. Removing
   * an animation outright is only safe because of one property it states in
   * prose: every entrance ends at `transform: none`, which is also the
   * element's base style, so an element with its animation removed sits at the
   * FINAL state rather than the first frame.
   *
   * Nothing checked that. An entrance ending at a real transform would leave
   * every element permanently displaced for anyone who asked for no motion -
   * and silently, since the people affected are the least likely to be the
   * ones testing. It would also be a fresh instance of the exact bug this file
   * exists to prevent, arriving through the door marked accessibility.
   *
   * SCROLL-DRIVEN KEYFRAMES ARE EXEMPT, and the exemption is asserted rather
   * than assumed: their progress comes from scroll position, so there is no
   * clock to freeze and no final frame to strand at. `mo-parallax` really does
   * end at `translate3d(0, -14px, 0)` and that is correct - it is where the
   * page has scrolled to.
   */
  /**
   * Keyframes allowed to end somewhere other than the identity, each with the
   * reason, and each re-checked below so a dead exemption cannot linger.
   *
   * THE PRINCIPLE, WHICH IS NARROWER THAN IT LOOKS
   * ————————————————————————————
   * The rule above exists because an ENTRANCE that ends displaced leaves real
   * content displaced forever, for the readers least likely to be testing. That
   * argument needs the element to be carrying something.
   *
   * A pseudo-element that MARKS a figure carries nothing: the figure prints at
   * its true value on the first paint with or without a clock, and the mark is
   * a rule drawn underneath it. Freeze the timeline, or switch motion off, and
   * the reader is left looking at a number with a line under it - which is
   * exactly what the mark is for. There is no state it can strand in that hides
   * anything or says anything false.
   *
   * An entry here must name a `::before`/`::after` decoration. If it ever names
   * something that renders content, the reasoning above does not apply to it.
   */
  const MAY_STRAND: ReadonlyMap<string, string> = new Map([
    [
      'rf-delta-wipe',
      'a ::after rule under a figure that is fully legible without it - stranded, or with motion off, it simply stays visible and keeps saying "this changed"',
    ],
  ]);

  /* `none`, and the spellings that mean the same thing. */
  const identity = /^(none|scale[XYZ]?3?d?\((?:1(?:\.0+)?[,\s]*)+\)|translate3d\(0(?:px)?,\s*0(?:px)?,\s*0(?:px)?\))$/;

  const offenders: string[] = [];
  let checked = 0;
  let exempt = 0;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    /*
     * A keyframe is scroll-driven when it sits inside the
     * `@supports (animation-timeline: ...)` block. Located by brace depth
     * rather than by name, so a new one is covered without being listed.
     */
    const scrollRegions: Array<[number, number]> = [];
    /*
     * The condition is `(animation-timeline: view())`, whose own parentheses
     * defeat a `[^)]*` scan - the first version stopped inside `view()` and
     * matched nothing, so BOTH scroll-driven keyframes were reported as
     * stranding entrances. Anchor on the property and find the block's `{`.
     */
    const supports = /@supports\s*\(\s*animation-timeline[\s\S]*?\{/g;
    for (let m = supports.exec(source); m !== null; m = supports.exec(source)) {
      let depth = 1;
      let i = m.index + m[0].length;
      for (; i < source.length && depth > 0; i += 1) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') depth -= 1;
      }
      scrollRegions.push([m.index, i]);
    }

    for (const frame of keyframes(source)) {
      const at = source.indexOf(`@keyframes ${frame.name}`);
      if (scrollRegions.some(([a, b]) => at > a && at < b)) {
        exempt += 1;
        continue;
      }
      checked += 1;

      const last = /(?:100%|to)\s*\{([^}]*)\}/.exec(frame.body);
      if (last === null) continue;
      const decl = /transform:\s*([^;]+)/.exec(last[1] ?? '');
      if (decl === null) continue;
      const value = (decl[1] ?? '').trim().replace(/\s+/g, ' ');
      if (!identity.test(value) && !MAY_STRAND.has(frame.name)) {
        offenders.push(
          `${relative(root, file)} @keyframes ${frame.name} ends at "${value}" - ` +
            'with motion off, every element carrying it stays there',
        );
      }
    }
  }

  /*
   * An exemption for a keyframe nobody writes any more is a hole waiting for
   * somebody to reuse the name. Each one has to still be there.
   */
  const named = new Set(files.flatMap((f) => [...keyframes(readFileSync(f, 'utf8'))].map((k) => k.name)));
  for (const [name, why] of MAY_STRAND) {
    assert.ok(named.has(name), `@keyframes ${name} is exempted as "${why}" but no longer exists - drop the exemption`);
  }

  assert.ok(checked > 5, `only ${String(checked)} time-based keyframes were examined, which is too few to trust`);
  assert.deepEqual(offenders, [], `an entrance strands its element when motion is off:\n          ${offenders.join('\n          ')}`);
  assert.ok(exempt > 0, 'no scroll-driven keyframe was found, so that exemption is no longer needed here');
});

console.log(failures === 0 ? '\nthe frozen timeline cannot strand content' : `\n${String(failures)} frozen-timeline rule(s) broken`);
process.exit(failures === 0 ? 0 : 1);
