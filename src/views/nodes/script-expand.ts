import { mapConcurrent } from "../../paic/concurrency";
import { extractScriptBodyRefs } from "../../resolver/script-body-parser";
import type { ClientCache } from "../../tenants/client-cache";
import type { Logger } from "../../util/logger";
import { MessageNode, type PaicNode } from "./base";
import { EsvNode } from "./esv";
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

  for (const name of refs.esvs) {
    children.push(new EsvNode(host, realm, name, parent));
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
