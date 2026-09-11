/**
 * A node's access requirement, with the quest in it made navigable.
 *
 * 89 of the 355 star-chart nodes carry a free-text gate - "Must have The New
 * Strange completed to access", "Must have Whispers in the Walls completed to
 * access" - and every one of those quest names was dead text. Standing on a
 * locked node, the single next thing anyone wants is the quest that unlocks it,
 * and the app knew exactly which quest that was and offered no way to get there.
 *
 * WHY MATCH BY NAME AND NOT BY A FIELD
 * ────────────────────────────────────
 * The gate is prose, transcribed from the wiki's requirement field; there is no
 * structured quest reference on the node. Rather than invent one, this finds the
 * longest known quest name contained in the sentence. Longest wins because quest
 * names nest - "The Hex" is inside "The Hex Finale", and linking the wrong one
 * would send the player to a quest that is not the gate.
 *
 * A gate that names no known quest - "Must be Mastery Rank 5 or higher" - renders
 * exactly as before. Nothing is fabricated and nothing is hidden: this only ever
 * upgrades a name that IS a quest into a link to that quest.
 */

import type { ReactNode } from 'react';
import { GoLink } from '../../ui/interact';

export interface QuestNameIndex {
  /** Lower-cased quest name -> the id the progression panel addresses it by. */
  readonly byName: ReadonlyMap<string, string>;
  /** Names longest-first, so nested names resolve to the more specific one. */
  readonly names: readonly string[];
}

/** Built once from the catalog; see the note on longest-match above. */
export function buildQuestNameIndex(
  quests: Iterable<{ id?: string | null; name: string }>,
): QuestNameIndex {
  const byName = new Map<string, string>();
  for (const q of quests) byName.set(q.name.toLowerCase(), q.id ?? `quest:${q.name}`);
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  return { byName, names };
}

export function RequirementText({ text, index }: { text: string; index: QuestNameIndex | null }) {
  if (index === null) return <>{text}</>;

  const haystack = text.toLowerCase();
  let hit: { at: number; name: string; id: string } | null = null;
  for (const name of index.names) {
    const at = haystack.indexOf(name);
    if (at === -1) continue;
    const id = index.byName.get(name);
    if (id === undefined) continue;
    hit = { at, name, id };
    break;
  }
  if (hit === null) return <>{text}</>;

  // Slice from the ORIGINAL string so the quest keeps its real capitalisation.
  const before = text.slice(0, hit.at);
  const label = text.slice(hit.at, hit.at + hit.name.length);
  const after = text.slice(hit.at + hit.name.length);

  const parts: ReactNode[] = [
    before,
    <GoLink key="q" kind="quest" id={hit.id} title={`Open ${label} in Progression`}>
      {label}
    </GoLink>,
    after,
  ];
  return <>{parts}</>;
}
