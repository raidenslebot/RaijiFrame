/**
 * THE PERFECT BUILD, ON THE GAME'S OWN EIGHT SLOTS.
 *
 * THE CONCEPT, AND WHAT IT REPLACED
 * ---------------------------------
 * The overlay's first shape was a 300 px strip in the one empty column of the
 * Upgrades screen, showing a single recommended card and three lines of text.
 * It was unobtrusive and it was not the thing that was asked for: a "full
 * comprehensive and complete" overlay, "extremely elaborate", "seamlessly
 * integrated". A gutter strip is a different, smaller idea.
 *
 * This is the shape now. The Upgrades screen lays a build out as four columns
 * by two rows of mod cards; `data/automod-place.ts` has those eight rectangles
 * measured off the player's own capture. The overlay marks those rectangles.
 *
 * IT NEVER COVERS A GAME CARD. THIS IS THE WHOLE RULE.
 * ---------------------------------------------------
 * It used to. A slot that needed a different mod got a full hand-drawn card
 * painted over the game's own, and on the player's live screen that was garbage
 * on sight: two card renderings fighting inside one rectangle, mine flat and
 * approximate against DE's illustrated art, one of them landing on top of the
 * game's own hover animation. "It should feel like it IS the game" and "here is
 * my drawing of a card, over your card" cannot both be true.
 *
 * So the overlay now draws only what the screen itself draws: an edge on the
 * slot, and a name plate along its bottom lip where a game card carries its
 * rank pips and nothing else. The art, the frame, the drain tab, the polarity -
 * all of it stays the game's. The overlay says WHICH mod and WHAT to do to it,
 * in about twenty pixels of the seventy the slot has, and gets out of the way.
 *
 * The full card still exists and is still drawn - in the empty column beside the
 * grid, on hover, which is where the game itself shows a card up close.
 *
 * WHAT IT DOES NOT CLAIM
 * ----------------------
 * It does NOT say "put this mod in that physical slot". The index order of the
 * game's eleven slots is a named unknown - nothing in the log states which grid
 * position an installed mod occupies - so a per-slot instruction would be a
 * guess dressed as a fact. The grid here is a LAYOUT, in the game's own
 * arrangement, not an assignment.
 */

import type { CSSProperties } from 'react';
import type { Placed } from '../data/optimise';
import type { Box } from '../data/automod-place';
import { routeShort } from '../data/acquire';

/** What has to happen to a mod before the build is the ideal one. */
export type SlotState =
  /** Installed, at the rank the ideal wants. Nothing to do; no card is drawn. */
  | 'done'
  /** Owned, but the ideal wants it higher. */
  | 'rank'
  /** Not owned at all. */
  | 'get';

export function slotState(p: Placed): SlotState {
  if (p.ownedRank === null) return 'get';
  return p.ownedRank >= p.rank ? 'done' : 'rank';
}

export interface ModGridProps {
  placed: readonly Placed[];
  /** The eight rectangles, already in this screen's pixels. */
  boxes: readonly Box[];
  /** Screen height over the height the grid was measured at. The plate's type scales with the game. */
  scale: number;
  /** The mod the pointer is on, so the aside can explain it. */
  onHover?: (p: Placed | null) => void;
}

export function ModGrid({ placed, boxes, onHover }: ModGridProps) {
  return (
    <>
      {boxes.map((box, i) => {
        const p = placed[i];
        if (!p) return null;
        const state = slotState(p);
        /*
         * `--i` is the slot's place in the deal. The grid arrives one card at a
         * time across the row and then down, which is how the game's own
         * arsenal populates a grid - and, watched as frames, is the difference
         * between an animation and a state change. The previous entrance was a
         * 5 px drop on every card at once: `cgc motion` reported one frame
         * carrying 100 % of the change, because on a 1680 px screen five pixels
         * simultaneously is not a movement anybody can see.
         */
        const style = { left: box.left, top: box.top, width: box.width, height: box.height, '--i': i } as CSSProperties;
        if (state === 'done') {
          /*
           * A slot that is already right. The game's own card is underneath and
           * is not covered; all this adds is the mark the screen uses for a
           * finished thing - a small gold chevron at the corner - so the eye can
           * count what is done without reading a word.
           */
          return (
            <div key={p.path} className="am-slot am-slot--done" style={style} aria-label={`${p.name}, already at rank ${String(p.rank)}`}>
              <svg viewBox="0 0 14 14" aria-hidden="true">
                <path d="M1 7.5 L5 11.5 L13 2" />
              </svg>
            </div>
          );
        }
        /*
         * A slot that has to change: an edge and a plate, and nothing over the
         * art. The plate sits on the card's bottom lip - the pip strip - which
         * is the one band of a game card that carries no information the player
         * needs while deciding what to change.
         *
         * The figure is the instruction, not a statistic. `rank` says what the
         * mod is at and what it must reach; `get` says what it will cost the
         * capacity bar, which is the number that decides whether it can go in
         * at all.
         */
        const figure = state === 'rank' ? `${String(p.ownedRank ?? 0)} → ${String(p.rank)}` : `${String(p.drain)}`;
        return (
          <div
            key={p.path}
            className="am-slot"
            data-state={state}
            style={style}
            onMouseEnter={() => onHover?.(p)}
            onMouseLeave={() => onHover?.(null)}
            aria-label={state === 'rank' ? `${p.name}, rank it to ${String(p.rank)}` : `${p.name}, not owned`}
          >
            <span className="am-slot-edge" aria-hidden="true" />
            <span className="am-slot-plate">
              <span className="am-slot-line">
                <span className="am-slot-name">{p.name}</span>
                <span className="am-slot-figure numeric">{figure}</span>
              </span>
              {/*
               * WHERE TO GET IT, ON THE SLOT IT BELONGS IN.
               *
               * This is what makes the column's size stop mattering. The aside
               * is 292 px wide by 263 px tall at 1680 x 1050 - and only 180 px
               * tall at 1280 x 720 - which is the screen's own empty space and
               * cannot grow without covering the game. At the worst case a
               * build can produce, eight missing mods with a price line and a
               * four-polarity Forma line above them, four of the eight fell off
               * the bottom of that column at 720p.
               *
               * A list cannot be made to fit a box that small. But the answer
               * was never confined to the box: each of those mods belongs to
               * one of the eight slots, the slot is right there, and the plate
               * on it was already carrying the name. So the route goes on the
               * plate, and every missing mod is named AND routed on screen at
               * once, at every resolution, with no list to truncate.
               *
               * Only `get` slots get it. A mod already owned needs no route.
               */}
              {state === 'get' && p.route && <span className="am-slot-route">{routeShort(p.route)}</span>}
            </span>
          </div>
        );
      })}
    </>
  );
}
