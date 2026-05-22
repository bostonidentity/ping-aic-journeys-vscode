/**
 * D36 — pure query functions over a `RealmIndexEntry`. Slice 2 calls these
 * from the Search page's panel; Slice 1 keeps them isolated and tested in
 * isolation.
 *
 * No I/O, no async. The Search page renders results directly from the
 * shapes returned here.
 */

import type {
  EntityKind,
  RealmIndexEntity,
  RealmIndexEntry,
  ReverseRef,
  UsagePathNode,
  UsagePaths,
} from "../domain/realm-index";

/** Return the inbound references targeting `targetKey`. Empty array when the
 * target is unknown or simply has no incoming refs (i.e. an orphan). */
export function findUsages(entry: RealmIndexEntry, targetKey: string): ReverseRef[] {
  return entry.inboundRefs[targetKey] ?? [];
}

/** Substring match (case-insensitive, locale-aware) against entity
 * `displayName`. `kinds` defaults to all kinds. Results sorted by
 * `displayName` for stable UI. Empty `pattern` returns `[]` — Search input
 * placeholder behaves as a no-op until the user actually types. */
export function searchByName(
  entry: RealmIndexEntry,
  pattern: string,
  kinds?: readonly EntityKind[],
): RealmIndexEntity[] {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return [];
  const needle = trimmed.toLocaleLowerCase();
  const kindFilter = kinds && kinds.length > 0 ? new Set(kinds) : null;

  const out: RealmIndexEntity[] = [];
  for (const e of Object.values(entry.entities)) {
    if (kindFilter && !kindFilter.has(e.kind)) continue;
    if (!e.displayName.toLocaleLowerCase().includes(needle)) continue;
    out.push(e);
  }
  out.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
  );
  return out;
}

/** Entities with zero inbound references. `kinds` defaults to every kind
 * EXCEPT `journey` — journeys are entry points (a user starts journeys
 * directly) and treating them as "unused" would yield a degenerate result.
 * When the caller passes an explicit `kinds` list that includes `journey`,
 * we honor it (an advanced caller may want raw orphan-set output).
 *
 * Results sorted by `displayName` for stable UI. */
export function findUnused(
  entry: RealmIndexEntry,
  kinds?: readonly EntityKind[],
): RealmIndexEntity[] {
  const kindFilter =
    kinds && kinds.length > 0
      ? new Set(kinds)
      : new Set<EntityKind>(["script", "esv", "theme", "emailTemplate", "socialIdp"]);

  const out: RealmIndexEntity[] = [];
  for (const e of Object.values(entry.entities)) {
    if (!kindFilter.has(e.kind)) continue;
    const refs = entry.inboundRefs[e.key];
    if (refs && refs.length > 0) continue;
    out.push(e);
  }
  out.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
  );
  return out;
}

function cmpEntityName(a: RealmIndexEntity, b: RealmIndexEntity): number {
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
}

/**
 * Build the slice of the realm's forward dependency graph that connects a
 * journey (or orphan) root down to `targetKey` — every path that reaches
 * the searched entity, with everything else pruned away. The target is
 * the leaf of every branch.
 *
 * Pure — derived entirely from `entry.inboundRefs` (the inverted edge
 * map). No I/O.
 *
 * 1. Reverse-reachability BFS from the target → `relevant`: every entity
 *    that transitively reaches it.
 * 2. Forward adjacency restricted to `relevant` (every such edge provably
 *    leads to the target, so there are no dead branches to prune).
 * 3. Roots = relevant entities with no relevant parent. Non-journey roots
 *    are flagged `orphanRoot` (the target is kept alive only by dead
 *    code).
 * 4. Forward DFS render in display order, with a shared `rendered` set so
 *    a repeated subtree (cross-path or cycle) collapses to a `dup` marker
 *    — first DISPLAYED occurrence wins.
 */
export function findUsagePaths(entry: RealmIndexEntry, targetKey: string): UsagePaths {
  if (!entry.entities[targetKey]) return { targetKey, roots: [] };

  // 1) Reverse-reachability.
  const relevant = new Set<string>([targetKey]);
  const queue: string[] = [targetKey];
  while (queue.length > 0) {
    const k = queue.shift() as string;
    for (const ref of entry.inboundRefs[k] ?? []) {
      if (relevant.has(ref.fromKey)) continue;
      if (!entry.entities[ref.fromKey]) continue; // defensive — unrenderable
      relevant.add(ref.fromKey);
      queue.push(ref.fromKey);
    }
  }

  // 2) Forward adjacency over the relevant sub-DAG.
  const forward = new Map<string, Array<{ toKey: string; via: string }>>();
  const hasRelevantParent = new Set<string>();
  for (const toKey of relevant) {
    for (const ref of entry.inboundRefs[toKey] ?? []) {
      if (!relevant.has(ref.fromKey)) continue;
      const list = forward.get(ref.fromKey);
      if (list) list.push({ toKey, via: ref.via });
      else forward.set(ref.fromKey, [{ toKey, via: ref.via }]);
      hasRelevantParent.add(toKey);
    }
  }

  // 3) Roots — relevant entities with no relevant parent — in display order.
  const rootKeys = [...relevant]
    .filter((k) => !hasRelevantParent.has(k))
    .sort((a, b) => cmpEntityName(entry.entities[a], entry.entities[b]));

  // 4) Forward DFS. One shared `rendered` set across all roots — first
  //    displayed occurrence renders in full, repeats collapse to `dup`.
  const rendered = new Set<string>();
  function build(key: string, via: string | undefined): UsagePathNode | null {
    const entity = entry.entities[key];
    if (!entity) return null;
    if (rendered.has(key)) {
      return { key, entity, ...(via ? { via } : {}), children: [], dup: true };
    }
    rendered.add(key);
    const edges = [...(forward.get(key) ?? [])].sort((a, b) =>
      cmpEntityName(entry.entities[a.toKey], entry.entities[b.toKey]),
    );
    const children: UsagePathNode[] = [];
    for (const edge of edges) {
      const child = build(edge.toKey, edge.via);
      if (child) children.push(child);
    }
    return { key, entity, ...(via ? { via } : {}), children };
  }

  const roots: UsagePathNode[] = [];
  for (const rk of rootKeys) {
    const node = build(rk, undefined);
    if (!node) continue;
    if (node.entity.kind !== "journey") node.orphanRoot = true;
    roots.push(node);
  }
  return { targetKey, roots };
}
