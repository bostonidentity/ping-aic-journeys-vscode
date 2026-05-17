/**
 * Canonical domain types consumed by the resolver, tree provider, detail
 * panel, and webview. PAIC REST envelopes are translated into these shapes
 * by `src/paic/mappers.ts`; consumers never see raw AIC field names like
 * `_id`, `_rev`, or `_type`.
 */

/** A user-managed PAIC connection. Persisted in settings.json + SecretStorage. */
export interface Connection {
  host: string;
  saId: string;
  name?: string;
}

/** One realm under a tenant. */
export interface Realm {
  /** Realm name, e.g. "alpha", "beta", or "alpha/customers" for sub-realms. */
  name: string;
  /** Whether the realm is enabled. */
  active: boolean;
  /** Parent realm path. "/" for top-level realms. */
  parentPath: string;
}

/** A journey (tree) — skeleton plus per-node references. The `nodes` map
 * mirrors what the list endpoint returns inline (no separate skeleton call
 * needed). External references (script UUID, inner-tree name) require a
 * per-node payload fetch via `getNode()`. */
export interface Journey {
  /** Name-shaped ID (e.g. "Login", "kyid_2B1_MFA_Registration"). */
  id: string;
  description?: string;
  enabled: boolean;
  identityResource?: string;
  /** UUID of the starting node. */
  entryNodeId: string;
  /** nodeId → node reference. */
  nodes: Record<string, NodeRef>;
}

/** A node as referenced inside a journey skeleton. External refs (script
 * UUID, inner-tree name, theme ID) live in `NodePayload` from a separate
 * fetch. */
export interface NodeRef {
  nodeType: string;
  displayName?: string;
  /** outcome → next-node-id within the same journey. */
  connections: Record<string, string>;
}

/** Full node payload from `/nodes/{nodeType}/{id}`. Discriminated union covers
 * the M1 surface (scripted decision + inner-tree evaluator). Other node types
 * surface as a fallback `Other` shape for now; M3 widens this. */
export type NodePayload =
  | ScriptedDecisionNodePayload
  | InnerTreeEvaluatorNodePayload
  | OtherNodePayload;

export interface ScriptedDecisionNodePayload {
  id: string;
  nodeType: "ScriptedDecisionNode";
  /** Script UUID this node invokes. */
  scriptId: string;
  outcomes: string[];
  inputs: string[];
  outputs: string[];
}

export interface InnerTreeEvaluatorNodePayload {
  id: string;
  nodeType: "InnerTreeEvaluatorNode";
  /** Name-shaped ID of the inner journey. */
  tree: string;
}

export interface OtherNodePayload {
  id: string;
  /** Discriminator-only literal so TypeScript narrows the union cleanly.
   * Use `rawNodeType` for the actual AIC node type string. */
  nodeType: "other";
  /** The actual AIC node type (e.g. "PageNode", "UsernameCollectorNode") that
   * we don't yet drill into. M3 widens parsing. */
  rawNodeType: string;
  /** Original AIC payload, kept opaque at M1. */
  raw: Record<string, unknown>;
}

/** A script. PAIC returns the body base64-encoded; mapper decodes to UTF-8. */
export interface Script {
  /** Script UUID. */
  id: string;
  name: string;
  /** "JAVASCRIPT" or "GROOVY" (per AIC). */
  language: string;
  /** Decoded script source. */
  body: string;
}
