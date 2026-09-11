/**
 * Panel registry.
 *
 * The app is a shell plus a list of panels. Adding a feature means writing a
 * panel module and calling `registerPanel` - the shell, the tab rail and the
 * routing all pick it up with no edits anywhere else.
 *
 * Panels are lazy by construction: `load` is only invoked the first time a panel
 * is opened, so a large panel costs nothing until someone looks at it.
 */

import type { ComponentType, LazyExoticComponent } from 'react';
import { lazy } from 'react';

/**
 * THE RAIL SHOWS GROUPS, NOT PANELS.
 *
 * Thirteen items in a vertical rail is a list, not a structure: the player has
 * to read all of it to find anything, and four of the thirteen answer the same
 * question. They are grouped by the QUESTION the player is asking, which is the
 * only ordering they can navigate without learning it:
 *
 *   Now        what should I do, what expires, what is live in the world
 *   Star Chart where do I go
 *   Arsenal    what do I have, and what is it worth in mastery
 *   Standing   the rank tracks that are not mastery
 *   Vault      what I hold and what I am building
 *   Platinum   how I make and spend the currency
 *
 * Panels keep their own ids and their own routing. Every `navigate('mastery')`
 * and every deep link in the app still lands exactly where it did; the shell
 * simply selects the group that owns the panel. Grouping is presentation, and
 * making it anything more would have meant touching every call site.
 */
export interface PanelGroup {
  id: string;
  /** Label in the rail. */
  title: string;
  /** Lower sorts first. */
  order: number;
  hint: string;
}

const groups = new Map<string, PanelGroup>();

export function registerGroup(g: PanelGroup): void {
  if (groups.has(g.id)) throw new Error(`duplicate group id: ${g.id}`);
  groups.set(g.id, g);
}

export interface PanelDef {
  /** Stable id. Used for routing and for remembering the last open tab. */
  id: string;
  /** Which rail group owns it. Panels in a group share one rail entry. */
  group: string;
  /** Label in the tab rail. */
  title: string;
  /** Lower sorts first. Progression owns 0 and stays leftmost. */
  order: number;
  /** One line under the title, shown on hover. */
  hint?: string;
  component: LazyExoticComponent<ComponentType>;
  /** Marks a panel that is present but not yet carrying real data. */
  status?: 'ready' | 'stub';
}

export interface PanelSpec extends Omit<PanelDef, 'component'> {
  load: () => Promise<{ default: ComponentType }>;
}

const panels = new Map<string, PanelDef>();

export function registerPanel(spec: PanelSpec): void {
  if (panels.has(spec.id)) throw new Error(`duplicate panel id: ${spec.id}`);
  const { load, ...rest } = spec;
  panels.set(spec.id, { ...rest, component: lazy(load) });
}

/** Every group, in rail order. */
export function allGroups(): PanelGroup[] {
  return [...groups.values()].sort((a, b) => a.order - b.order);
}

/** The panels inside a group, in their own order. The first one leads it. */
export function panelsInGroup(groupId: string): PanelDef[] {
  return allPanels().filter((p) => p.group === groupId);
}

/** Which group owns this panel. */
export function groupOf(panelId: string): string | undefined {
  return panels.get(panelId)?.group;
}

/** All registered panels, in rail order. */
export function allPanels(): PanelDef[] {
  return [...panels.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function getPanel(id: string): PanelDef | undefined {
  return panels.get(id);
}

/** The panel the shell opens on first launch. */
export function defaultPanelId(): string {
  return allPanels()[0]?.id ?? '';
}

/** The panel a group opens on. */
export function leadPanelId(groupId: string): string {
  return panelsInGroup(groupId)[0]?.id ?? '';
}
