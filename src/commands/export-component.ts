/**
 * `paicJourneys.exportComponent` — export a single leaf component to a
 * frodo / PAIC-UI-compatible JSON file (D42 / M9 Phase 1). Read-only: fetches
 * the raw entity, serializes it, and writes to a user-chosen file. Slice 1
 * handles scripts; later slices add the other leaf kinds.
 */

import * as vscode from "vscode";
import { buildExportMeta } from "../export/meta";
import { type ExportMeta, type LeafExport, serializeLeaf } from "../export/serialize";
import type { PaicClient } from "../paic/client";
import type { ClientCache } from "../tenants/client-cache";
import type { TenantsRegistry } from "../tenants/registry";
import type { Logger } from "../util/logger";

export interface ExportComponentDeps {
  clientCache: ClientCache;
  registry: TenantsRegistry;
  log: Logger;
  extensionVersion: string;
}

/** Message kinds the command accepts — one per leaf card. */
const MESSAGE_KINDS = [
  "script",
  "libraryScript",
  "theme",
  "emailTemplate",
  "socialIdp",
  "esv",
] as const;
type MessageKind = (typeof MESSAGE_KINDS)[number];

interface ExportArgs {
  host: string;
  realm: string;
  kind: MessageKind;
  id: string;
  /** Optional display name → default filename. Falls back to the id. */
  name?: string;
}

function parseExportArg(arg: unknown): ExportArgs | null {
  if (!arg || typeof arg !== "object") return null;
  const a = arg as Record<string, unknown>;
  if (
    typeof a.host !== "string" ||
    typeof a.realm !== "string" ||
    typeof a.id !== "string" ||
    typeof a.kind !== "string" ||
    !MESSAGE_KINDS.includes(a.kind as MessageKind)
  ) {
    return null;
  }
  return {
    host: a.host,
    realm: a.realm,
    kind: a.kind as MessageKind,
    id: a.id,
    name: typeof a.name === "string" ? a.name : undefined,
  };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_") || "export";
}

const asRecord = (o: unknown): Record<string, unknown> => o as Record<string, unknown>;

/** Fetch the raw entity for the requested kind and serialize it into a
 * single-leaf bundle. Returns null when the entity isn't found / not available
 * (e.g. an IDM resource on an on-prem backend). `typeLabel` drives the filename. */
async function fetchAndSerialize(
  client: PaicClient,
  parsed: ExportArgs,
  meta: ExportMeta,
): Promise<{ bundle: LeafExport; typeLabel: string } | null> {
  switch (parsed.kind) {
    case "script":
    case "libraryScript": {
      const raw = await client.getRawScript(parsed.realm, parsed.id);
      return {
        bundle: serializeLeaf(parsed.kind, asRecord(raw), meta, parsed.id),
        typeLabel: "script",
      };
    }
    case "theme": {
      const raw = await client.getRawTheme(parsed.realm, parsed.id);
      return raw
        ? { bundle: serializeLeaf("theme", asRecord(raw), meta, parsed.id), typeLabel: "theme" }
        : null;
    }
    case "emailTemplate": {
      const raw = await client.getRawEmailTemplate(parsed.id);
      return raw
        ? {
            bundle: serializeLeaf("emailTemplate", asRecord(raw), meta, parsed.id),
            typeLabel: "emailTemplate",
          }
        : null;
    }
    case "socialIdp": {
      const raw = await client.getRawSocialIdp(parsed.realm, parsed.id);
      return raw
        ? { bundle: serializeLeaf("socialIdp", asRecord(raw), meta, parsed.id), typeLabel: "idp" }
        : null;
    }
    case "esv": {
      const r = await client.getRawEsv(parsed.id);
      return r
        ? { bundle: serializeLeaf(r.kind, asRecord(r.raw), meta, parsed.id), typeLabel: r.kind }
        : null;
    }
  }
}

export async function exportComponent(deps: ExportComponentDeps, arg: unknown): Promise<void> {
  const { clientCache, registry, log, extensionVersion } = deps;
  const parsed = parseExportArg(arg);
  if (!parsed) {
    log.warn(
      { event: "exportComponent.badArg" },
      "exportComponent invoked with missing/invalid args",
    );
    return;
  }

  const conn = registry.list().find((c) => c.host === parsed.host);
  if (!conn) {
    log.warn(
      { event: "exportComponent.noConnection", host: parsed.host },
      "No connection registered for host",
    );
    vscode.window.showErrorMessage(`No connection found for ${parsed.host}.`);
    return;
  }

  try {
    const client = await clientCache.get(parsed.host);
    const meta = buildExportMeta(conn, parsed.realm, extensionVersion, new Date().toISOString());
    const result = await fetchAndSerialize(client, parsed, meta);
    if (!result) {
      log.warn(
        { event: "exportComponent.notFound", host: parsed.host, kind: parsed.kind, id: parsed.id },
        "Component not found / not available for export",
      );
      vscode.window.showErrorMessage(`Couldn't find the ${parsed.kind} to export.`);
      return;
    }
    const { bundle, typeLabel } = result;

    const filename = `${sanitizeFilename(parsed.name ?? parsed.id)}.${typeLabel}.json`;
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultUri = folder ? vscode.Uri.joinPath(folder, filename) : vscode.Uri.file(filename);
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { JSON: ["json"] },
      saveLabel: "Export",
    });
    if (!target) {
      log.debug(
        { event: "exportComponent.cancelled", host: parsed.host, kind: parsed.kind },
        "Export cancelled by user",
      );
      return;
    }

    const json = JSON.stringify(bundle, null, 2);
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(json));
    log.info(
      {
        event: "exportComponent",
        host: parsed.host,
        realm: parsed.realm,
        kind: parsed.kind,
        id: parsed.id,
      },
      "Exported component to file",
    );
    vscode.window.showInformationMessage(`Exported ${filename}.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { event: "exportComponent.failed", host: parsed.host, kind: parsed.kind, message },
      "Failed to export component",
    );
    vscode.window.showErrorMessage(`Couldn't export the component. ${message}`);
  }
}
