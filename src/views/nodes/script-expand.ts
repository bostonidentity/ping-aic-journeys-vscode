import type { Esv } from "../../domain/types";
import { mapConcurrent } from "../../paic/concurrency";
import { extractScriptBodyRefs } from "../../resolver/script-body-parser";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import { MessageNode, type PaicNode } from "./base";
import { type EsvKind, EsvNode } from "./esv";
import { LibraryScriptNode } from "./library-script";

/** Concurrency cap for `getScriptByName` lookups when resolving multiple
 * `require()` references in a single body. POC-tested at 10. */
const CONCURRENCY = 10;

export interface ScriptExpandArgs {
  host: string;
  realm: string;
  body: string;
  /** Cycle-detection key for this script — the *name* for library scripts,
   * the scriptId for journey-entry ScriptNodes. */
  selfKey: string;
  visited: readonly string[];
  cache: ClientCache;
  log: Logger;
  /** Tree parent for emitted children. */
  parent: PaicNode;
}

type LibraryResolveResult =
  | { kind: "cycle"; name: string }
  | { kind: "missing"; name: string }
  | { kind: "found"; name: string; scriptId: string; body: string };

/**
 * Parse a script body (D20) and emit tree children for each library-script
 * `require()` and each ESV reference. Library scripts are fetched by name
 * (one `getScriptByName` per unique name) and resolved to a UUID + body.
 *
 * Cycle guard threads `visited` names through `expandScript` → library →
 * `expandScript` recursion; revisits emit a `[cycle: <name>]` MessageNode
 * instead of recursing. Missing libraries emit `[missing library: …]`.
 */
export async function expandScript(args: ScriptExpandArgs): Promise<PaicNode[]> {
  const { host, realm, body, selfKey, visited, cache, log, parent } = args;
  const childLog = log.child({ component: "views.scriptExpand" });

  const refs = extractScriptBodyRefs(body);
  const newVisited = [...visited, selfKey];
  const children: PaicNode[] = [];

  if (refs.libraryScripts.length > 0) {
    const client = await cache.get(host);
    const resolved: LibraryResolveResult[] = await mapConcurrent(
      refs.libraryScripts,
      CONCURRENCY,
      async (name) => {
        if (newVisited.includes(name)) {
          return { kind: "cycle", name };
        }
        const script = await client.getScriptByName(realm, name);
        if (!script) return { kind: "missing", name };
        return { kind: "found", name, scriptId: script.id, body: script.body };
      },
    );
    for (const r of resolved) {
      if (r.kind === "cycle") {
        children.push(new MessageNode(`[cycle: ${r.name}]`, "cycle"));
      } else if (r.kind === "missing") {
        children.push(new MessageNode(`[missing library: ${r.name}]`, "error"));
      } else {
        children.push(
          new LibraryScriptNode(
            host,
            realm,
            r.scriptId,
            r.name,
            r.body,
            cache,
            log,
            newVisited,
            parent,
          ),
        );
      }
    }
  }

  if (refs.esvs.length > 0) {
    // D22 — once-per-expansion eager batch: fetch the realm's full ESV index
    // (variables + secrets in parallel) and classify each ref by-kind before
    // emitting nodes. The tree is otherwise lazy/fresh; this is the only
    // scoped eagerness per D21. On fetch failure, fall back to emitting nodes
    // without kind labels so we don't lose visibility.
    const client = await cache.get(host);
    let varByDottedName: Map<string, Esv> | null = null;
    let secByDottedName: Map<string, Esv> | null = null;
    try {
      const [variables, secrets] = await Promise.all([
        client.listVariables(realm),
        client.listSecrets(realm),
      ]);
      varByDottedName = new Map(variables.map((v) => [v.name, v as Esv]));
      secByDottedName = new Map(secrets.map((s) => [s.name, s as Esv]));
    } catch (err) {
      childLog.warn(
        {
          event: "script.expand.esvListFailed",
          host,
          realm,
          self_key: selfKey,
          message: err instanceof Error ? err.message : String(err),
        },
        "ESV list fetch failed — emitting EsvNodes without kind labels",
      );
    }

    for (const name of refs.esvs) {
      let kind: EsvKind | undefined;
      let resolved: Esv | undefined;
      if (varByDottedName && secByDottedName) {
        const v = varByDottedName.get(name);
        const s = v ? undefined : secByDottedName.get(name);
        resolved = v ?? s;
        if (v) kind = "variable";
        else if (s) kind = "secret";
        else kind = "missing";
      }
      children.push(new EsvNode(host, realm, name, parent, kind, resolved));
    }
  }

  childLog.debug(
    {
      event: "script.expand.done",
      host,
      realm,
      self_key: selfKey,
      libraries: refs.libraryScripts.length,
      esvs: refs.esvs.length,
    },
    "Script expanded",
  );

  if (children.length === 0) {
    return [new MessageNode("No script-body dependencies", "info")];
  }
  return children;
}
