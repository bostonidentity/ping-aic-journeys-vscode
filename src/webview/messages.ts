/**
 * Typed message protocol between the extension host (Node.js) and the
 * inspector webview (browser, React). Both sides import these types so a
 * mismatch is a compile-time error.
 *
 * Direction is encoded in the union name:
 *   - `E2W` — extension → webview (host pushes selection / dep data to UI)
 *   - `W2E` — webview → extension (UI requests navigation, signals ready)
 */
import type { Connection, Journey, Realm, Script } from "../domain/types";

/** A lightweight reference to a tree node that the panel may navigate to. */
export interface NodeRef {
  uid: string;
  /** Display label for the link. */
  label: string;
  /** Discriminates which card kind shows when the user navigates. */
  kind: "connection" | "realm" | "journey" | "script" | "innerJourney";
}

/** Per-node info attached to journey-diagram nodes for click handling + hover. */
export interface NodeInfo {
  kind: "script" | "inner" | "other";
  /** Tree-node uid the inspector can navigate to (matches a ScriptNode or
   * InnerJourneyNode created during journey expansion). */
  uid?: string;
  /** For ScriptedDecisionNode → clicking opens this script's body. */
  scriptId?: string;
  /** For InnerTreeEvaluatorNode → the inner journey's id (informational). */
  innerTreeId?: string;
  /** Schema slices for hover tooltips (M2 polish). All optional — populated
   * only for `ScriptedDecisionNode`-shaped entries today; M3 widens. */
  outcomes?: string[];
  inputs?: string[];
  outputs?: string[];
  /** For `kind: "other"` — the raw AIC node-type string (`PageNode`, etc.). */
  rawNodeType?: string;
}

/** Extension → webview. */
export type E2W =
  | { type: "select"; payload: SelectPayload }
  | {
      type: "journeyDeps";
      uid: string;
      scripts: NodeRef[];
      inners: NodeRef[];
      nodeIndex: Record<string, NodeInfo>;
    }
  | { type: "error"; uid?: string; message: string };

export type SelectPayload =
  | { kind: "connection"; uid: string; connection: Connection }
  | { kind: "realm"; uid: string; host: string; realm: Realm }
  | { kind: "journey"; uid: string; host: string; realmName: string; journey: Journey }
  | {
      kind: "innerJourney";
      uid: string;
      host: string;
      realmName: string;
      journey: Journey;
      visited: readonly string[];
    }
  | {
      kind: "script";
      uid: string;
      host: string;
      realmName: string;
      scriptId: string;
      script?: Script;
    }
  | { kind: "message"; uid: string; label: string };

/** Webview → extension. */
export type W2E =
  | { type: "ready" }
  | { type: "navigate"; uid: string }
  | {
      type: "openScriptBody";
      host: string;
      realm: string;
      scriptId: string;
      language?: string;
    };

// ─── Type-guard helpers ───────────────────────────────────────────────────
// Useful in tests + on the webview side where `event.data` is `unknown`.

export function isE2W(msg: unknown): msg is E2W {
  if (!msg || typeof msg !== "object") return false;
  const t = (msg as { type?: unknown }).type;
  return t === "select" || t === "journeyDeps" || t === "error";
}

export function isW2E(msg: unknown): msg is W2E {
  if (!msg || typeof msg !== "object") return false;
  const t = (msg as { type?: unknown }).type;
  return t === "ready" || t === "navigate" || t === "openScriptBody";
}
