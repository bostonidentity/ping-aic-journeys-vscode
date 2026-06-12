/**
 * Builds the provenance `meta` block stamped on export bundles (D42 / TD-2).
 * Pure TypeScript — the timestamp is injected so callers stay deterministic
 * and testable.
 */

import type { Connection } from "../domain/types";
import type { ExportMeta } from "./serialize";

const BUNDLE_SCHEMA_VERSION = "1.0";
const EXPORT_TOOL = "paic-journeys-vscode";

/** Assemble the `meta` block for an export from a connection + realm context. */
export function buildExportMeta(
  conn: Connection,
  realm: string,
  extensionVersion: string,
  nowIso: string,
): ExportMeta {
  return {
    bundleSchemaVersion: BUNDLE_SCHEMA_VERSION,
    origin: conn.host,
    // The domain discriminant is `paic` | `onprem`; the bundle records the
    // D42 wire value `am-onprem` for the classic-AM case.
    connectionType: conn.kind === "paic" ? "paic" : "am-onprem",
    realm,
    exportedBy: conn.kind === "paic" ? conn.saId : conn.username,
    exportDate: nowIso,
    exportTool: EXPORT_TOOL,
    exportToolVersion: extensionVersion,
  };
}
