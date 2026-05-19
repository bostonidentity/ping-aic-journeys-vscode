import type {
  EmailTemplate,
  EsvSecret,
  EsvVariable,
  Journey,
  NodePayload,
  NodeRef,
  Realm,
  Script,
  SocialIdp,
  Theme,
} from "../domain/types";

// ─── Realm ─────────────────────────────────────────────────────────────────

/** Raw AIC realm entry from `GET /am/json/global-config/realms?_queryFilter=true`.
 * `parentPath` is `null` for the platform root realm and a path string for
 * child realms (e.g. `"/"` for alpha/bravo). */
export interface RawRealm {
  _id?: string;
  name: string;
  active: boolean;
  parentPath?: string | null;
  aliases?: string[];
}

export function mapRealm(raw: RawRealm): Realm {
  // `parentPath == null` matches both wire `null` and missing field — both
  // indicate the platform root realm. Loose-equals is intentional.
  const isRoot = raw.parentPath == null;
  return {
    name: raw.name,
    active: raw.active,
    parentPath: raw.parentPath ?? "/",
    isRoot,
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
  /** Coordinates for the three platform-fixed terminals (`startNode`,
   * Success UUID, Failure UUID). Present alongside `nodes` on the wire. */
  staticNodes?: Record<string, { x?: number; y?: number }>;
  innerTreeOnly?: boolean;
  noSession?: boolean;
  mustRun?: boolean;
  transactionalOnly?: boolean;
}

export function mapJourney(raw: RawJourney): Journey {
  const nodes: Record<string, NodeRef> = {};
  for (const [id, n] of Object.entries(raw.nodes ?? {})) {
    nodes[id] = {
      nodeType: n.nodeType,
      displayName: n.displayName,
      connections: n.connections ?? {},
      x: n.x,
      y: n.y,
    };
  }
  let staticNodes: Journey["staticNodes"];
  if (raw.staticNodes) {
    staticNodes = {};
    for (const [id, pos] of Object.entries(raw.staticNodes)) {
      staticNodes[id] = { x: pos.x ?? 0, y: pos.y ?? 0 };
    }
  }
  return {
    id: raw._id,
    description: raw.description,
    enabled: raw.enabled ?? false,
    identityResource: raw.identityResource,
    entryNodeId: raw.entryNodeId,
    innerTreeOnly: raw.innerTreeOnly,
    noSession: raw.noSession,
    mustRun: raw.mustRun,
    transactionalOnly: raw.transactionalOnly,
    nodes,
    staticNodes,
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
  /** Conditional-script flags (D19). */
  useScript?: unknown;
  useFilterScript?: unknown;
  /** Social-handler / SelectIdP — string array of social IdP names. */
  filteredProviders?: unknown;
  /** EmailSuspend / EmailTemplate node — IDM email-template id. */
  emailTemplateName?: unknown;
  /** PageNode — freeform string (JSON or `themeId=<id>`) encoding the
   * page-level theme override + (we don't read it) the localized page header. */
  stage?: unknown;
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

  // M3 Slice 1 — always-script-bearing kinds (D19).
  if (nodeType === "ClientScriptNode" || nodeType === "ConfigProviderNode") {
    return {
      id: raw._id,
      nodeType,
      scriptId: typeof raw.script === "string" ? raw.script : "",
    };
  }
  if (nodeType === "SocialProviderHandlerNode" || nodeType === "SocialProviderHandlerNodeV2") {
    const filteredProviders = Array.isArray(raw.filteredProviders)
      ? raw.filteredProviders.filter((s): s is string => typeof s === "string")
      : [];
    return {
      id: raw._id,
      nodeType,
      scriptId: typeof raw.script === "string" ? raw.script : "",
      filteredProviders,
    };
  }

  // M3 Slice 1 — conditional-script kinds (D19).
  if (nodeType === "DeviceMatchNode") {
    return {
      id: raw._id,
      nodeType: "DeviceMatchNode",
      useScript: raw.useScript === true,
      scriptId: typeof raw.script === "string" ? raw.script : undefined,
    };
  }
  // biome-ignore lint/security/noSecrets: AIC node type name, not a secret
  if (nodeType === "PingOneVerifyCompletionDecisionNode") {
    return {
      id: raw._id,
      // biome-ignore lint/security/noSecrets: AIC node type name, not a secret
      nodeType: "PingOneVerifyCompletionDecisionNode",
      useFilterScript: raw.useFilterScript === true,
      scriptId: typeof raw.script === "string" ? raw.script : undefined,
    };
  }

  // M3 Slice 3 — journey-level new-leaf carriers.
  if (nodeType === "PageNode") {
    const childRefs = Array.isArray(raw.nodes)
      ? (raw.nodes as unknown[])
          .filter((n): n is { _id: unknown; nodeType: unknown } => !!n && typeof n === "object")
          .map((n) => ({ id: String(n._id ?? ""), nodeType: String(n.nodeType ?? "") }))
          .filter((n) => n.id && n.nodeType)
      : [];
    return {
      id: raw._id,
      nodeType: "PageNode",
      themeId: parseStageForThemeId(raw.stage),
      childRefs,
    };
  }
  if (nodeType === "EmailSuspendNode" || nodeType === "EmailTemplateNode") {
    return {
      id: raw._id,
      nodeType,
      emailTemplateName: typeof raw.emailTemplateName === "string" ? raw.emailTemplateName : "",
    };
  }
  if (nodeType === "SelectIdPNode") {
    const filteredProviders = Array.isArray(raw.filteredProviders)
      ? raw.filteredProviders.filter((s): s is string => typeof s === "string")
      : [];
    return { id: raw._id, nodeType: "SelectIdPNode", filteredProviders };
  }

  return {
    id: raw._id,
    nodeType: "other",
    rawNodeType: nodeType,
    raw: raw as Record<string, unknown>,
  };
}

/** Parse `PageNode.stage`. AIC stores the page's theme override as either
 * a JSON object (`{"themeId":"<uuid>", …}`) or a legacy `themeId=<uuid>`
 * string. Returns the themeId, or undefined if neither form is present. */
function parseStageForThemeId(stage: unknown): string | undefined {
  if (typeof stage !== "string" || !stage) return undefined;
  try {
    const parsed = JSON.parse(stage) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "themeId" in parsed &&
      typeof (parsed as { themeId: unknown }).themeId === "string"
    ) {
      return (parsed as { themeId: string }).themeId;
    }
  } catch {
    // not JSON — fall through to legacy form
  }
  if (stage.startsWith("themeId=")) return stage.slice("themeId=".length);
  return undefined;
}

// ─── Script ────────────────────────────────────────────────────────────────

/** Raw script shape. The `script` body field is base64-encoded by AIC. */
export interface RawScript {
  _id: string;
  _rev?: string;
  name: string;
  language?: string;
  script?: string;
  context?: string;
  /** Author-supplied. Can come back as `null` for older scripts. */
  description?: string | null;
  default?: boolean;
  evaluatorVersion?: string;
  /** LDAP-style DN of the last editor. */
  lastModifiedBy?: string;
  /** Epoch milliseconds. */
  lastModifiedDate?: number;
}

export function mapScript(raw: RawScript): Script {
  return {
    id: raw._id,
    name: raw.name,
    language: raw.language ?? "JAVASCRIPT",
    body: decodeScriptBody(raw.script),
    context: raw.context,
    description: typeof raw.description === "string" ? raw.description : undefined,
    isDefault: raw.default,
    evaluatorVersion: raw.evaluatorVersion,
    lastModifiedBy: raw.lastModifiedBy,
    lastModifiedDate: raw.lastModifiedDate,
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

// ─── Theme ─────────────────────────────────────────────────────────────────

/** A single theme inside `ui/themerealm.realm.<realmName>[]`.
 *
 * The wire shape is rich (~80+ branding/color fields). We capture only what
 * the inspector card surfaces; everything else is intentionally ignored. */
export interface RawTheme {
  _id?: string;
  name?: string;
  isDefault?: boolean;
  /** Journey IDs that link to this theme. Useful for reverse-lookup
   * surfaces (M5 back-search will exploit this). */
  linkedTrees?: string[];
  primaryColor?: string;
  backgroundColor?: string;
  backgroundImage?: string;
  /** Localized logo URLs keyed by locale code (e.g. `{ "en": "https://…" }`). */
  logo?: Record<string, string>;
  logoAltText?: Record<string, string>;
  journeyLayout?: string;
  fontFamily?: string;
}

/** Full `ui/themerealm` document shape — IDM stores every realm's themes
 * in one config entity. The top-level key is `realm` (singular); its value
 * maps each realm name directly to a `RawTheme[]` (no `.themes` wrapper). */
export interface RawThemeRealmConfig {
  realm?: Record<string, RawTheme[]>;
}

export function mapTheme(realm: string, raw: RawTheme): Theme {
  return {
    id: raw._id ?? "",
    name: raw.name ?? "",
    realm,
    isDefault: raw.isDefault,
    linkedTrees: raw.linkedTrees,
    primaryColor: raw.primaryColor,
    backgroundColor: raw.backgroundColor,
    backgroundImage: raw.backgroundImage,
    logo: raw.logo,
    logoAltText: raw.logoAltText,
    journeyLayout: raw.journeyLayout,
    fontFamily: raw.fontFamily,
  };
}

// ─── Email template ───────────────────────────────────────────────────────

export interface RawEmailTemplate {
  _id?: string;
  enabled?: boolean;
  from?: string;
  /** Localized subject per locale code (`en`, `fr`, …). */
  subject?: Record<string, string>;
  message?: Record<string, string>;
  defaultLocale?: string;
  mimeType?: string;
  displayName?: string;
  description?: string;
  templateId?: string;
  styles?: string;
  html?: Record<string, string>;
  advancedEditor?: boolean;
}

export function mapEmailTemplate(name: string, raw: RawEmailTemplate): EmailTemplate {
  return {
    name,
    enabled: raw.enabled ?? false,
    from: raw.from,
    subject: raw.subject,
    message: raw.message,
    defaultLocale: raw.defaultLocale,
    mimeType: raw.mimeType,
    displayName: raw.displayName,
    description: raw.description,
    templateId: raw.templateId,
    styles: raw.styles,
    html: raw.html,
    advancedEditor: raw.advancedEditor,
  };
}

// ─── Social IdP ───────────────────────────────────────────────────────────

export interface RawSocialIdp {
  _id: string;
  _type?: { _id?: string };
  enabled?: boolean;
}

export function mapSocialIdp(realm: string, raw: RawSocialIdp): SocialIdp {
  return {
    name: raw._id,
    type: raw._type?._id ?? "",
    enabled: raw.enabled ?? false,
    realm,
  };
}

// ─── ESV ──────────────────────────────────────────────────────────────────

export interface RawEsvVariable {
  _id?: string;
  description?: string;
  expressionType?: string;
  lastChangeDate?: string;
  lastChangedBy?: string;
  loaded?: boolean;
  valueBase64?: string;
}

export interface RawEsvSecret {
  _id?: string;
  description?: string;
  encoding?: string;
  lastChangeDate?: string;
  lastChangedBy?: string;
  loaded?: boolean;
  activeVersion?: string;
  loadedVersion?: string;
  useInPlaceholders?: boolean;
}

export function mapEsvVariable(name: string, raw: RawEsvVariable): EsvVariable {
  return {
    kind: "variable",
    name,
    description: raw.description,
    expressionType: raw.expressionType,
    lastChangeDate: raw.lastChangeDate,
    lastChangedBy: raw.lastChangedBy,
    loaded: raw.loaded,
    valueBase64: raw.valueBase64,
  };
}

export function mapEsvSecret(name: string, raw: RawEsvSecret): EsvSecret {
  return {
    kind: "secret",
    name,
    description: raw.description,
    encoding: raw.encoding,
    lastChangeDate: raw.lastChangeDate,
    lastChangedBy: raw.lastChangedBy,
    loaded: raw.loaded,
    activeVersion: raw.activeVersion,
    loadedVersion: raw.loadedVersion,
    useInPlaceholders: raw.useInPlaceholders,
  };
}
