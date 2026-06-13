/**
 * Typed message protocol between the extension host and the Transfer webview
 * (D42 / TD-6, M9 Phase 4). Direction encoded in the union name:
 *   - `W2E` — webview → extension
 *   - `E2W` — extension → webview
 *
 * Slice A is file-first + **read-only**: the webview asks the extension to
 * open a bundle file (`pickBundle`); the extension reads + parses it and posts
 * back the summarized `ParsedBundle` (`bundleLoaded`) or a friendly error
 * (`bundleError`). The Transfer page is a singleton (TD-6).
 *
 * The parse types are re-exported here so the React sandbox (`ui/*`) imports
 * only from this module — mirroring how the Search UI imports its shared
 * types from `../messages` / `../../domain`.
 */

import type { EntityKind } from "../../domain/realm-index";
import type { ComponentVerdict } from "../../import/compare";
import type { WriteResult } from "../../import/execute";
import type { ParsedBundle } from "../../import/parse";
import type { RequiredDepVerdict } from "../../import/preflight";

// Pure import-layer types re-exported so the React sandbox (`ui/*`) imports
// only from this module (mirrors how the Search UI imports its shared types).
export type { EntityKind } from "../../domain/realm-index";
export type { ComponentStatus, ComponentVerdict } from "../../import/compare";
export type { WriteResult, WriteStatus } from "../../import/execute";
// The writable-kinds set is the single source of truth for both the panel's
// write gate and the UI's Import button (re-exported here for the sandbox).
export { WRITABLE_KINDS } from "../../import/kinds";
export type { BundleKind, ComponentSummary, ParsedBundle } from "../../import/parse";
export type { RequiredDepVerdict } from "../../import/preflight";

/** A connection the user can target — carried in the embedded payload for the
 * Slice-B target dropdown. Unused in Slice A (read-only preview). */
export interface ConnectionInfo {
  host: string;
  name?: string;
  kind?: "paic" | "onprem";
}

/** Initial state injected into the page on render. */
export interface TransferPayload {
  connections: readonly ConnectionInfo[];
}

export type W2E =
  | { type: "ready" }
  | { type: "pickBundle" }
  | { type: "listRealms"; host: string }
  | { type: "runPreflight"; host: string; realm: string }
  | { type: "execute"; host: string; realm: string; selected: string[] }
  // ESV apply is tenant-wide → host-scoped, not realm-scoped.
  | { type: "applyEsv"; host: string }
  // Review affordances (TD-11) — read-only inspection of an overwrite row.
  | {
      type: "openDiff";
      host: string;
      realm: string;
      bundleKey: string;
      /** The target entity's `_id` we'd overwrite (verdict.resolvedTargetId, TD-9). */
      targetScriptId: string;
      language?: string;
    }
  | {
      type: "openFindUsages";
      host: string;
      realm: string;
      targetKey: string;
      targetKind: EntityKind;
    };

export type E2W =
  | { type: "bundleLoaded"; fileName: string; bundle: ParsedBundle }
  | { type: "bundleError"; message: string }
  | { type: "realmsResult"; host: string; realms: readonly string[] }
  | { type: "realmsError"; host: string; message: string }
  | {
      type: "preflightResult";
      host: string;
      realm: string;
      verdicts: ComponentVerdict[];
      /** Discovered info-only dependency refs (libs + ESVs) — TD-9. */
      requires: RequiredDepVerdict[];
    }
  | { type: "preflightError"; host: string; realm: string; message: string }
  | {
      type: "executeResult";
      host: string;
      realm: string;
      results: WriteResult[];
      summary?: string;
    }
  | { type: "applyProgress"; host: string; status: string; elapsedS: number }
  | { type: "applyResult"; host: string; ok: boolean; elapsedS: number; message?: string };

export function isW2E(m: unknown): m is W2E {
  if (!m || typeof m !== "object") return false;
  const t = (m as { type?: unknown }).type;
  return (
    t === "ready" ||
    t === "pickBundle" ||
    t === "listRealms" ||
    t === "runPreflight" ||
    t === "execute" ||
    t === "applyEsv" ||
    t === "openDiff" ||
    t === "openFindUsages"
  );
}

export function isE2W(m: unknown): m is E2W {
  if (!m || typeof m !== "object") return false;
  const t = (m as { type?: unknown }).type;
  return (
    t === "bundleLoaded" ||
    t === "bundleError" ||
    t === "realmsResult" ||
    t === "realmsError" ||
    t === "preflightResult" ||
    t === "preflightError" ||
    t === "executeResult" ||
    t === "applyProgress" ||
    t === "applyResult"
  );
}
