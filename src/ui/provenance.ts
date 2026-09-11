import type { Provenance } from '../data/plat-throughput';

/**
 * How each provenance reads, wherever a link is drawn.
 *
 * Moved out of `RouteDetail.tsx` the day the guidance engine started drawing
 * links too: two panels each with their own table is how the chain stages and
 * the estimate rows had already drifted into saying "measured / unpublished"
 * and "measured / not measured" for the same link on one screen. One table,
 * both panels, and react-doctor stops seeing a non-component export in a
 * component file.
 */
export const PROVENANCE: Record<Provenance, { word: string; ink: string }> = {
  measured: { word: 'measured', ink: 'var(--color-signal-good)' },
  published: { word: 'from the game', ink: 'var(--color-orokin-300)' },
  yours: { word: 'your call', ink: 'var(--color-tenno-300)' },
  /* Your own log, but a different mission's number standing in. Quieter ink:
     it is an estimate, and the row should read as one before the note says so. */
  assumed: { word: 'assumed from your log', ink: 'var(--text-muted)' },
  /*
   * "not known", NOT "nobody has this". `unknown` covers two situations the
   * type deliberately folds together - a figure nobody has published, and a
   * field on this account that has not been read yet - and the rendered panel
   * showed the second wearing the words of the first: "NOBODY HAS THIS" over a
   * trade count that DE knows perfectly well and this app simply had not
   * captured. The neutral wording is true of both; the note under the link says
   * which one it is.
   */
  unknown: { word: 'not known', ink: 'var(--color-signal-warn)' },
};
