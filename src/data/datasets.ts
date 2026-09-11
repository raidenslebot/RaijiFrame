/**
 * Dataset loading.
 *
 * Uses `import.meta.glob` rather than static imports so a dataset that has not
 * been vendored yet is simply absent instead of a build error. Each file is its
 * own async chunk, so the star chart is only fetched when a panel actually asks
 * for the catalog.
 *
 * Missing datasets degrade rather than fail: the engine works with whichever
 * ones are present, and `DatasetStatus` tells the UI what it is missing so the
 * panel can say so out loud instead of silently under-reporting.
 */

import { buildCatalog, type Catalog } from './catalog';
import type { JunctionsFile, NodesFile, QuestsFile } from './vendor/types';

const modules = import.meta.glob<{ default: unknown }>('./vendor/*.json');

export interface DatasetStatus {
  nodes: boolean;
  quests: boolean;
  junctions: boolean;
  /** Provenance line per loaded dataset, for the UI's data-source disclosure. */
  sources: string[];
  /** Quests present in the data whose completion cannot be verified. */
  untrackableQuests: string[];
}

export interface LoadedCatalog {
  catalog: Catalog;
  status: DatasetStatus;
}

async function grab<T>(name: string): Promise<T | null> {
  const loader = modules[`./vendor/${name}.json`];
  if (!loader) return null;
  try {
    return ((await loader()).default ?? null) as T | null;
  } catch (err) {
    console.warn(`[codex] failed to load dataset ${name}`, err);
    return null;
  }
}

let cached: Promise<LoadedCatalog> | null = null;

/** Load and index every available dataset. Cached: the parse happens once. */
export function loadCatalog(): Promise<LoadedCatalog> {
  cached ??= (async () => {
    const [nodesFile, questsFile, junctionsFile] = await Promise.all([
      grab<NodesFile>('nodes'),
      grab<QuestsFile>('quests'),
      grab<JunctionsFile>('junctions'),
    ]);

    const catalog = buildCatalog(
      nodesFile?.nodes ?? [],
      questsFile?.quests ?? [],
      junctionsFile?.junctions ?? [],
    );

    const sources: string[] = [];
    if (nodesFile) sources.push(`${nodesFile.nodes.length} nodes · ${nodesFile.version}`);
    if (questsFile) sources.push(`${questsFile.quests.length} quests · ${questsFile.version}`);
    if (junctionsFile) sources.push(`${junctionsFile.junctions.length} junctions · ${junctionsFile.version}`);

    return {
      catalog,
      status: {
        nodes: !!nodesFile,
        quests: !!questsFile,
        junctions: !!junctionsFile,
        sources,
        untrackableQuests: catalog.untrackableQuests,
      },
    };
  })();
  return cached;
}

/** Canonical totals for the progression bars, from whatever data is loaded. */
export function canonFrom(status: DatasetStatus, catalog: Catalog) {
  return {
    // Only claim a denominator for datasets we actually have.
    questCount: status.quests ? catalog.questByKey.size : undefined,
    nodeCount: status.nodes ? catalog.nodeById.size : undefined,
    // The ids behind that denominator, so the numerator can be restricted to the
    // same population. See `Canon.nodeIds`.
    nodeIds: status.nodes ? new Set(catalog.nodeById.keys()) : undefined,
  };
}
