import type { NodePayload } from "../domain/types";

/**
 * D19 — per-node-type script-ref predicate. Returns the scriptId this
 * payload actively references, or null. Centralizes the logic so the tree
 * expander, the inspector card builder, and (M4+) the `RealmIndex` walk all
 * agree on what "this node has a script" means.
 *
 * Exhaustive switch — adding a new script-bearing AIC node type requires
 * (a) a new variant in `NodePayload` and (b) a new case here. TypeScript's
 * exhaustiveness check (no `default` branch) prevents drift.
 */
export function getScriptIdIfRef(p: NodePayload): string | null {
  switch (p.nodeType) {
    // Always-script-bearing kinds.
    case "ScriptedDecisionNode":
    case "ClientScriptNode":
    case "ConfigProviderNode":
    case "SocialProviderHandlerNode":
    case "SocialProviderHandlerNodeV2":
      // `||` catches empty-string `scriptId` ("no script bound" sentinel some
      // tenants emit) and avoids surfacing a 404-bound ScriptNode downstream.
      return p.scriptId || null;

    // Conditional-script kinds: predicate fires only when the flag is set.
    case "DeviceMatchNode":
      return p.useScript ? p.scriptId || null : null;
    // biome-ignore lint/security/noSecrets: AIC node type name, not a secret
    case "PingOneVerifyCompletionDecisionNode":
      return p.useFilterScript ? p.scriptId || null : null;

    case "InnerTreeEvaluatorNode":
    case "PageNode":
    case "EmailSuspendNode":
    case "EmailTemplateNode":
    case "SelectIdPNode":
    case "other":
      return null;
  }
}
