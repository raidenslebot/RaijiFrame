/**
 * Panel manifest.
 *
 * Every panel in the app is registered here and nowhere else. Adding one is a
 * single `registerPanel` call plus the module it points at - the shell, the tab
 * rail, routing and lazy-loading all follow automatically.
 *
 * The rail's icon is NOT declared here: it is drawn per panel id in
 * src/ui/PanelIcon.tsx. Presentation stays out of the manifest, and it keeps
 * Unicode dingbats (several of which render as colour emoji) out of the source.
 *
 * WHY THE RAIL SHOWS SIX THINGS AND NOT THIRTEEN
 * ─────────────────────────────────────────────
 * Thirteen entries in a vertical rail is a list, not a structure. The player has
 * to read the whole thing to find anything, and several entries answer the same
 * question as each other - Daily, Worldstate and Progression are all "what
 * should I do now"; Arsenal, Mastery and Collection are all "what do I have".
 * Splaying them out made the app look thorough and made it feel scattered.
 *
 * So they are grouped by the QUESTION being asked, which is the only ordering a
 * player can navigate without first learning it. Each panel keeps its own id and
 * its own routing: every `navigate('mastery')` and every deep link still lands
 * exactly where it did, and the shell selects the group that owns it. Grouping
 * is presentation. Making it anything more would have meant touching every call
 * site in the app to gain nothing.
 *
 * Order inside a group matters: the first panel is the one the group opens on.
 */

import { registerGroup, registerPanel } from './registry';

registerGroup({
  id: 'now',
  title: 'Now',
  order: 0,
  hint: 'What to do next, what expires today, and what is live in the world',
});
registerGroup({
  id: 'chart',
  title: 'Star Chart',
  order: 1,
  hint: 'The whole solar system, with your route to the next objective',
});
registerGroup({
  id: 'arsenal',
  title: 'Arsenal',
  order: 2,
  hint: 'Your gear, your rank, and everything you have not collected yet',
});
registerGroup({
  id: 'standing',
  title: 'Standing',
  order: 3,
  hint: 'Every rank track that is not mastery: syndicates, focus, intrinsics, your nemesis',
});
registerGroup({
  id: 'platinum',
  title: 'Platinum',
  order: 5,
  hint: 'What you can trade, what you hold that sells, and how much of your platinum can actually move',
});
registerGroup({
  id: 'vault',
  title: 'Vault',
  order: 4,
  hint: 'What you hold, and what the foundry is building with it',
});

/* ------------------------------------------------------------------- now */

registerPanel({
  id: 'progression',
  group: 'now',
  title: 'Next',
  order: 0,
  hint: 'What to do next for completion, without repeating content',
  status: 'ready',
  load: () => import('./progression/ProgressionPanel'),
});

registerPanel({
  id: 'daily',
  group: 'now',
  title: 'Resets',
  order: 1,
  hint: 'Everything that resets, and what is still open before it does',
  status: 'ready',
  load: () => import('./daily/DailyPanel'),
});

registerPanel({
  id: 'worldstate',
  group: 'now',
  title: 'World',
  order: 2,
  hint: 'Open-world cycles, void fissures and Baro',
  status: 'ready',
  load: () => import('./worldstate/WorldstatePanel'),
});

registerPanel({
  id: 'chronicle',
  group: 'now',
  title: 'Chronicle',
  order: 3,
  hint: 'Everything this account did, in the order it did it, with the gaps drawn as gaps',
  status: 'ready',
  load: () => import('./chronicle/ChroniclePanel'),
});

/* ----------------------------------------------------------------- chart */

registerPanel({
  id: 'starchart',
  group: 'chart',
  title: 'Star Chart',
  order: 10,
  hint: 'The whole solar system, with your route to the next objective',
  status: 'ready',
  load: () => import('./starchart/StarChartPanel'),
});

/* --------------------------------------------------------------- arsenal */

registerPanel({
  id: 'arsenal',
  group: 'arsenal',
  title: 'Gear',
  order: 20,
  hint: 'Every owned item, its rank, forma and fittings',
  status: 'ready',
  load: () => import('./arsenal/ArsenalPanel'),
});

registerPanel({
  id: 'mastery',
  group: 'arsenal',
  title: 'Mastery',
  order: 21,
  hint: 'Rank progress, honest completion and the cheapest mastery left',
  status: 'ready',
  load: () => import('./mastery/MasteryPanel'),
});

registerPanel({
  id: 'collection',
  group: 'arsenal',
  title: 'Collection',
  order: 22,
  hint: 'Owned against obtainable, by category, with what is still missing',
  status: 'ready',
  load: () => import('./collection/CollectionPanel'),
});

/* -------------------------------------------------------------- standing */

registerPanel({
  id: 'syndicates',
  group: 'standing',
  title: 'Syndicates',
  order: 30,
  hint: 'Standing ladders, wasted standing and what today can still buy',
  status: 'ready',
  load: () => import('./syndicates/SyndicatesPanel'),
});

registerPanel({
  id: 'focus',
  group: 'standing',
  title: 'Focus',
  order: 31,
  hint: 'Daily focus remaining, what each school holds, and the five schools',
  status: 'ready',
  load: () => import('./focus/FocusPanel'),
});

registerPanel({
  id: 'intrinsics',
  group: 'standing',
  title: 'Intrinsics',
  order: 32,
  hint: 'Railjack and Drifter ranks, and the mastery still unearned',
  status: 'ready',
  load: () => import('./intrinsics/IntrinsicsPanel'),
});

registerPanel({
  id: 'nemesis',
  group: 'standing',
  title: 'Nemesis',
  order: 33,
  hint: 'The Lich or Sister hunting you, and the weapons in its lineage',
  status: 'ready',
  load: () => import('./nemesis/NemesisPanel'),
});

/* ----------------------------------------------------------------- vault */

registerPanel({
  id: 'resources',
  group: 'vault',
  title: 'Stock',
  order: 40,
  hint: 'Currencies, tokens and every resource stack you hold',
  status: 'ready',
  load: () => import('./resources/ResourcesPanel'),
});

registerPanel({
  id: 'foundry',
  group: 'vault',
  title: 'Foundry',
  order: 41,
  hint: 'What is ready to claim, what is building and what you hold blueprints for',
  status: 'ready',
  load: () => import('./foundry/FoundryPanel'),
});

/* -------------------------------------------------------------- platinum */

registerPanel({
  id: 'platinum',
  group: 'platinum',
  title: 'Platinum',
  order: 50,
  hint: 'Your trading position, and everything you own that another player would buy',
  status: 'ready',
  load: () => import('./platinum/PlatinumPanel'),
});
