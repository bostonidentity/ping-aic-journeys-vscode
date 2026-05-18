/**
 * Typed message protocol between the extension host (Node.js) and the
 * inspector webview (browser, React). Both sides import these types so a
 * mismatch is a compile-time error.
 *
 * Direction is encoded in the union name:
 *   - `E2W` — extension → webview (host pushes selection / dep data to UI)
 *   - `W2E` — webview → extension (UI requests navigation, signals ready)
 */
import type {
  Connection,
  EmailTemplate,
  Esv,
  Journey,
  Realm,
  Script,
  SocialIdp,
  Theme,
} from "../domain/types";

/** A lightweight reference to a tree node that the panel may navigate to. */
export interface NodeRef {
  uid: string;
  /** Display label for the link. */
  label: string;
  /** Discriminates which card kind shows when the user navigates. */
  kind:
    | "connection"
    | "realm"
    | "journey"
    | "script"
    | "innerJourney"
    | "libraryScript"
    | "esv"
    | "theme"
    | "emailTemplate"
    | "socialIdp";
}

/** Per-node info attached to journey-diagram nodes for click handling + hover. */
export interface NodeInfo {
  kind: "script" | "inner" | "theme" | "emailTemplate" | "socialIdp" | "other";
  /** Tree-node uid the inspector can navigate to. Populated for inner/theme/
   * emailTemplate/socialIdp/script kinds when a matching tree leaf exists. */
  uid?: string;
  /** For script-bearing kinds → clicking opens this script's body. Set on
   * `ScriptedDecisionNode`, `ClientScriptNode`, and on the conditional-script
   * kinds (Config/Device/PingOneVerify) when their `useScript` flag is on,
   * plus on `SocialProviderHandler*` (script wins over its IdPs for clicks). */
  scriptId?: string;
  /** For InnerTreeEvaluatorNode → the inner journey's id (informational). */
  innerTreeId?: string;
  /** Schema slices for hover tooltips. Populated for ScriptedDecisionNode. */
  outcomes?: string[];
  inputs?: string[];
  outputs?: string[];
  /** For `kind: "other"` — the raw AIC node-type string (`PageNode`, etc.). */
  rawNodeType?: string;
  /** For PageNode payloads whose `stage` carries a themeId. */
  themeId?: string;
  /** For EmailSuspendNode / EmailTemplateNode payloads. */
  emailTemplateName?: string;
  /** For SelectIdPNode / SocialProviderHandlerNode*. The full filteredProviders
   * list; the diagram view renders a count + truncated names, the tooltip
   * shows the whole list. `uid` (when set) points to the first IdP's tree leaf. */
  socialIdpNames?: string[];
  /** For ConfigProviderNode / DeviceMatchNode / PingOneVerifyCompletionDecisionNode.
   * Decorates the view + tooltip to indicate whether the (structurally-present)
   * scriptId is actually active. */
  useScript?: boolean;
}

/** Extension → webview. */
export type E2W =
  | { type: "select"; payload: SelectPayload }
  | {
      type: "journeyDeps";
      uid: string;
      scripts: NodeRef[];
      inners: NodeRef[];
      themes: NodeRef[];
      emailTemplates: NodeRef[];
      socialIdps: NodeRef[];
      nodeIndex: Record<string, NodeInfo>;
    }
  | {
      type: "scriptDeps";
      uid: string;
      libraryScripts: NodeRef[];
      esvs: NodeRef[];
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
  | {
      kind: "libraryScript";
      uid: string;
      host: string;
      realmName: string;
      scriptId: string;
      name: string;
      script?: Script;
    }
  | {
      kind: "esv";
      uid: string;
      host: string;
      realmName: string;
      name: string;
      esv?: Esv;
    }
  | {
      kind: "theme";
      uid: string;
      host: string;
      realmName: string;
      themeId: string;
      theme?: Theme;
    }
  | {
      kind: "emailTemplate";
      uid: string;
      host: string;
      realmName: string;
      name: string;
      template?: EmailTemplate;
    }
  | {
      kind: "socialIdp";
      uid: string;
      host: string;
      realmName: string;
      name: string;
      idp?: SocialIdp;
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
  return t === "select" || t === "journeyDeps" || t === "scriptDeps" || t === "error";
}

export function isW2E(msg: unknown): msg is W2E {
  if (!msg || typeof msg !== "object") return false;
  const t = (msg as { type?: unknown }).type;
  return t === "ready" || t === "navigate" || t === "openScriptBody";
}
