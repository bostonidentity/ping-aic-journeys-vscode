/**
 * Script-UUID remap for journey import (TD-13 §6 / PD-8 / PD-12). Scripts are
 * name-unique per realm but UUID-identified, so a script reconciles to the
 * TARGET's UUID (its name-match, `ComponentVerdict.resolvedTargetId`) — and every
 * node that referenced the BUNDLE's script UUID must be rewritten to that target
 * UUID before the node is written, or AM rejects it (`400 "…attribute, Script"`).
 *
 * Pure: no client, no vscode. The S6 executor builds the entries from the script
 * verdicts, remaps each node, asserts (PD-12), then writes. Scope is ONLY the
 * `node.script` UUID attribute — inner-tree refs (a journey NAME) and
 * `require('lib')` (text in a script body) are name-based and never remapped.
 */

/**
 * Build the **differing-only** bundle→target script-UUID map. For each script,
 * `id → resolvedTargetId` iff `resolvedTargetId` is set and differs from `id`
 * (the create path keeps the bundle UUID, and a same-UUID name-match needs no
 * rewrite → no entry). Structural input matches `ComponentVerdict`, so callers
 * pass the script verdicts directly.
 */
export function buildScriptRemap(
  scripts: ReadonlyArray<{ id: string; resolvedTargetId?: string }>,
): Map<string, string> {
  const remap = new Map<string, string>();
  for (const s of scripts) {
    if (s.resolvedTargetId && s.resolvedTargetId !== s.id) {
      remap.set(s.id, s.resolvedTargetId);
    }
  }
  return remap;
}

/**
 * Rewrite a node's `script` reference through the remap. Returns a shallow copy
 * with the rewritten ref when it maps; otherwise the node unchanged (no `script`
 * ref, or a ref that isn't a remap key — e.g. a create-path script kept at its
 * bundle UUID). Works for any node carrying a `script` attribute (top-level
 * ScriptedDecisionNode or a page-child node).
 */
export function remapNodeScript(
  node: Record<string, unknown>,
  remap: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const ref = node.script;
  if (typeof ref === "string" && remap.has(ref)) {
    return { ...node, script: remap.get(ref) };
  }
  return node;
}

/**
 * PD-12 guard, run after `remapNodeScript` and before the node write: if a node's
 * `script` ref is still a remap KEY (a source/bundle UUID that should have been
 * rewritten to its target), the remap was skipped — throw rather than write a
 * dangling reference AM would reject. A correctly-remapped ref is a target VALUE
 * (not a key) → no throw; a create-path ref (not in the map) → no throw.
 */
export function assertScriptRefsResolved(
  node: Record<string, unknown>,
  remap: ReadonlyMap<string, string>,
): void {
  const ref = node.script;
  if (typeof ref === "string" && remap.has(ref)) {
    throw new Error(
      `unremapped source script UUID "${ref}" survived in node ${String(node._id)} — internal remap error`,
    );
  }
}
