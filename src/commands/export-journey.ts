/**
 * `paicJourneys.exportJourney` — export a journey (and, optionally, its full
 * inner-journey closure) to a frodo/PAIC-UI-compatible `{ meta, trees }` file
 * (D42 / M9 Phase 2). Read-only. Depth is chosen via a QuickPick (TD-5); the
 * closure walk runs under a progress notification.
 */

import * as vscode from "vscode";
import { buildJourneyBundle, type DepthMode } from "../export/journey-bundle";
import type { ClientCache } from "../tenants/client-cache";
import type { TenantsRegistry } from "../tenants/registry";
import type { Logger } from "../util/logger";

export interface ExportJourneyDeps {
  clientCache: ClientCache;
  registry: TenantsRegistry;
  log: Logger;
  extensionVersion: string;
}

interface ExportJourneyArgs {
  host: string;
  realm: string;
  journeyId: string;
  name?: string;
  isInner?: boolean;
}

function parseArg(arg: unknown): ExportJourneyArgs | null {
  if (!arg || typeof arg !== "object") return null;
  const a = arg as Record<string, unknown>;
  if (
    typeof a.host === "string" &&
    typeof a.realm === "string" &&
    typeof a.journeyId === "string"
  ) {
    return {
      host: a.host,
      realm: a.realm,
      journeyId: a.journeyId,
      name: typeof a.name === "string" ? a.name : undefined,
      isInner: a.isInner === true,
    };
  }
  return null;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_") || "journey";
}

async function pickDepth(label: string): Promise<DepthMode | undefined> {
  const items: Array<vscode.QuickPickItem & { mode: DepthMode }> = [
    {
      label: "Level 1 only",
      detail:
        "This journey only. Inner journeys are referenced and must already exist in the target.",
      mode: "level1",
    },
    {
      label: "All levels",
      detail:
        "Include every nested inner journey (self-contained). Larger file; on import it would also create/overwrite those journeys.",
      mode: "allLevels",
    },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `Export "${label}" — include nested inner journeys?`,
  });
  return pick?.mode;
}

export async function exportJourney(deps: ExportJourneyDeps, arg: unknown): Promise<void> {
  const { clientCache, registry, log, extensionVersion } = deps;
  const parsed = parseArg(arg);
  if (!parsed) {
    log.warn({ event: "exportJourney.badArg" }, "exportJourney invoked with missing/invalid args");
    return;
  }

  const conn = registry.list().find((c) => c.host === parsed.host);
  if (!conn) {
    log.warn(
      { event: "exportJourney.noConnection", host: parsed.host },
      "No connection registered for host",
    );
    vscode.window.showErrorMessage(`No connection found for ${parsed.host}.`);
    return;
  }

  const depth = await pickDepth(parsed.name ?? parsed.journeyId);
  if (!depth) return; // user dismissed the depth pick

  const filename = `${sanitizeFilename(parsed.name ?? parsed.journeyId)}.journey.json`;
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const defaultUri = folder ? vscode.Uri.joinPath(folder, filename) : vscode.Uri.file(filename);
  const target = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { JSON: ["json"] },
    saveLabel: "Export",
  });
  if (!target) {
    log.debug(
      { event: "exportJourney.cancelled", host: parsed.host, journey: parsed.journeyId },
      "Export cancelled by user",
    );
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Exporting journey "${parsed.journeyId}"…`,
      },
      async () => {
        const client = await clientCache.get(parsed.host);
        const bundle = await buildJourneyBundle(
          client,
          conn,
          parsed.realm,
          parsed.journeyId,
          depth,
          extensionVersion,
          new Date().toISOString(),
          log,
        );
        if (!bundle) {
          log.warn(
            { event: "exportJourney.notFound", host: parsed.host, journey: parsed.journeyId },
            "Journey not found / not available for export",
          );
          vscode.window.showErrorMessage(
            `Couldn't find the journey "${parsed.journeyId}" to export.`,
          );
          return;
        }
        const json = JSON.stringify(bundle, null, 2);
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(json));
        const treeCount = Object.keys(bundle.trees).length;
        log.info(
          {
            event: "exportJourney",
            host: parsed.host,
            realm: parsed.realm,
            journey: parsed.journeyId,
            depth,
            trees: treeCount,
          },
          "Exported journey to file",
        );
        vscode.window.showInformationMessage(`Exported ${filename} (${treeCount} tree(s)).`);
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { event: "exportJourney.failed", host: parsed.host, journey: parsed.journeyId, message },
      "Failed to export journey",
    );
    vscode.window.showErrorMessage(`Couldn't export the journey. ${message}`);
  }
}
