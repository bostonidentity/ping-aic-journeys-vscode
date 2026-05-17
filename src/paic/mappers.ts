import type { Journey, NodePayload, NodeRef, Realm, Script } from "../domain/types";

// ─── Realm ─────────────────────────────────────────────────────────────────

/** Raw AIC realm entry from `GET /am/json/global-config/realms?_queryFilter=true`. */
export interface RawRealm {
  _id?: string;
  name: string;
  active: boolean;
  parentPath?: string;
  aliases?: string[];
}

export function mapRealm(raw: RawRealm): Realm {
  return {
    name: raw.name,
    active: raw.active,
    parentPath: raw.parentPath ?? "/",
  };
}

// ─── Journey ───────────────────────────────────────────────────────────────

/** Per-node ref shape from a list/get-journey response. */
export interface RawNodeRef {
  nodeType: string;
  displayName?: string;
  connections?: Record<string, string>;
  x?: number;
  y?: number;
  version?: string;
}

/** Raw journey shape (one entry from list, or the get-journey response). */
export interface RawJourney {
  _id: string;
  _rev?: string;
  description?: string;
  enabled?: boolean;
  identityResource?: string;
  entryNodeId: string;
  nodes?: Record<string, RawNodeRef>;
}

export function mapJourney(raw: RawJourney): Journey {
  const nodes: Record<string, NodeRef> = {};
  for (const [id, n] of Object.entries(raw.nodes ?? {})) {
    nodes[id] = {
      nodeType: n.nodeType,
      displayName: n.displayName,
      connections: n.connections ?? {},
    };
  }
  return {
    id: raw._id,
    description: raw.description,
    enabled: raw.enabled ?? false,
    identityResource: raw.identityResource,
    entryNodeId: raw.entryNodeId,
    nodes,
  };
}

// ─── Node payload ──────────────────────────────────────────────────────────

/** Raw shape from `/nodes/{nodeType}/{id}`. `_type` is an object (not a string). */
export interface RawNodePayload {
  _id: string;
  _rev?: string;
  _type?: { _id?: string };
  script?: unknown;
  tree?: unknown;
  outcomes?: string[];
  inputs?: string[];
  outputs?: string[];
  [key: string]: unknown;
}

export function mapNodePayload(raw: RawNodePayload): NodePayload {
  const nodeType = raw._type?._id ?? "Unknown";

  if (nodeType === "ScriptedDecisionNode") {
    return {
      id: raw._id,
      nodeType: "ScriptedDecisionNode",
      scriptId: typeof raw.script === "string" ? raw.script : "",
      outcomes: raw.outcomes ?? [],
      inputs: raw.inputs ?? [],
      outputs: raw.outputs ?? [],
    };
  }

  if (nodeType === "InnerTreeEvaluatorNode") {
    return {
      id: raw._id,
      nodeType: "InnerTreeEvaluatorNode",
      tree: typeof raw.tree === "string" ? raw.tree : "",
    };
  }

  return {
    id: raw._id,
    nodeType: "other",
    rawNodeType: nodeType,
    raw: raw as Record<string, unknown>,
  };
}

// ─── Script ────────────────────────────────────────────────────────────────

/** Raw script shape. The `script` body field is base64-encoded by AIC. */
export interface RawScript {
  _id: string;
  _rev?: string;
  name: string;
  language?: string;
  script?: string;
}

export function mapScript(raw: RawScript): Script {
  return {
    id: raw._id,
    name: raw.name,
    language: raw.language ?? "JAVASCRIPT",
    body: decodeScriptBody(raw.script),
  };
}

function decodeScriptBody(b64: string | undefined): string {
  if (!b64) return "";
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    // If decoding throws for any reason, fall through to raw — better than empty.
    return b64;
  }
}
