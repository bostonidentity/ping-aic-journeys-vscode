/**
 * Canonical domain types consumed by the resolver, tree provider, detail
 * panel, and webview. PAIC REST envelopes are translated into these shapes
 * by `src/paic/mappers.ts`; consumers never see raw AIC field names like
 * `_id`, `_rev`, or `_type`.
 */

/**
 * A user-managed connection. Persisted in settings.json + SecretStorage.
 *
 * `kind`-discriminated union: `paic` (cloud, service-account JWT-bearer) and
 * `onprem` (self-managed PingAM, admin username/password → session token). See
 * D41. `host` is the common stable identity on BOTH variants — it keys the
 * secret store, the client cache, the session-status store, and tree node uids,
 * so it must never move inside a variant.
 */
export interface PaicConnection {
  kind: "paic";
  host: string;
  /** Service-account id (the JWK is the SecretStorage value). */
  saId: string;
  name?: string;
}

export interface OnpremConnection {
  kind: "onprem";
  /** AM base/origin URL, e.g. `http://openam.example.com:8080`. */
  host: string;
  /** Admin username (the password is the SecretStorage value). */
  username: string;
  name?: string;
}

export type Connection = PaicConnection | OnpremConnection;

/**
 * Normalize a stored connection into a proper discriminated union. Configs
 * written before D41 have no `kind` field — treat them as `paic` (back-compat,
 * no settings migration). Applied once at the registry read boundary so the
 * rest of the code always sees a real union.
 */
export function normalizeConnection(c: Connection): Connection {
  if (c.kind === "onprem") return c;
  // Missing `kind` (legacy) or `kind: "paic"` → canonical paic shape.
  const paic: PaicConnection = { kind: "paic", host: c.host, saId: c.saId };
  if (c.name !== undefined) paic.name = c.name;
  return paic;
}

/** One realm under a tenant. */
export interface Realm {
  /** Realm name, e.g. "alpha", "beta", or "alpha/customers" for sub-realms. */
  name: string;
  /** Whether the realm is enabled. */
  active: boolean;
  /** Parent realm path. "/" for top-level realms. */
  parentPath: string;
  /** True for the platform root realm. On the wire this is identified by
   * `parentPath === null` (no parent); on PAIC tenant service accounts have
   * no access to its journey/script endpoints. */
  isRoot: boolean;
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
  /** Runtime flags passed through verbatim from the AIC config. Rendered
   * raw on the inspector card per D23. */
  innerTreeOnly?: boolean;
  noSession?: boolean;
  mustRun?: boolean;
  transactionalOnly?: boolean;
  /** Pixel coordinates for the platform-fixed terminal nodes (`startNode`,
   * `<success-uuid>`, `<failure-uuid>`). Wire field is `staticNodes`
   * alongside `nodes` — see D31 in `docs/design-plan.md`. */
  staticNodes?: Record<string, { x: number; y: number }>;
}

/** A node as referenced inside a journey skeleton. External refs (script
 * UUID, inner-tree name, theme ID) live in `NodePayload` from a separate
 * fetch. */
export interface NodeRef {
  nodeType: string;
  displayName?: string;
  /** outcome → next-node-id within the same journey. */
  connections: Record<string, string>;
  /** Pixel coordinates from the AIC admin UI canvas (D31). When absent or
   * all-zero across the journey, the diagram layout falls back to dagre. */
  x?: number;
  y?: number;
}

/** Full node payload from `/nodes/{nodeType}/{id}`. Discriminated union covers
 * the M1+M3-Slice1+Slice3 surface. Other node types surface as a fallback
 * `Other` shape; Slice 4 may narrow further as the diagram grows custom
 * components. */
export type NodePayload =
  | ScriptedDecisionNodePayload
  | InnerTreeEvaluatorNodePayload
  | ClientScriptNodePayload
  | ConfigProviderNodePayload
  | SocialProviderHandlerNodePayload
  | SocialProviderHandlerNodeV2Payload
  | DeviceMatchNodePayload
  | PingOneVerifyCompletionDecisionNodePayload
  | PageNodePayload
  | EmailSuspendNodePayload
  | EmailTemplateNodePayload
  | SelectIdPNodePayload
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

/** Always-script-bearing node: fires per D19 predicate when `scriptId` is set. */
export interface ClientScriptNodePayload {
  id: string;
  nodeType: "ClientScriptNode";
  scriptId: string;
}

export interface ConfigProviderNodePayload {
  id: string;
  nodeType: "ConfigProviderNode";
  scriptId: string;
}

export interface SocialProviderHandlerNodePayload {
  id: string;
  nodeType: "SocialProviderHandlerNode";
  scriptId: string;
  /** Subset of the realm's social IdPs this handler accepts. */
  filteredProviders: string[];
}

export interface SocialProviderHandlerNodeV2Payload {
  id: string;
  nodeType: "SocialProviderHandlerNodeV2";
  scriptId: string;
  filteredProviders: string[];
}

/** Conditional-script-bearing node (D19): script ref is active only when the
 * `useScript` flag is true. A `scriptId` may be present even when the flag is
 * off (stale legacy data); the predicate gates activation. */
export interface DeviceMatchNodePayload {
  id: string;
  nodeType: "DeviceMatchNode";
  useScript: boolean;
  scriptId?: string;
}

/** Conditional-script-bearing node (D19): script ref active only when
 * `useFilterScript === true`. */
export interface PingOneVerifyCompletionDecisionNodePayload {
  id: string;
  nodeType: "PingOneVerifyCompletionDecisionNode";
  useFilterScript: boolean;
  scriptId?: string;
}

/** Container node — its `nodes[]` array holds inline child nodes. Also
 * carries a `stage` field that may encode a `themeId`. M3 Slice 3 emits
 * the theme edge; container child-walk is deferred. */
export interface PageNodePayload {
  id: string;
  nodeType: "PageNode";
  /** Parsed from raw `stage` (JSON form `{"themeId":"<id>"}` or legacy
   * `themeId=<id>`). Undefined when no theme is bound. */
  themeId?: string;
  /** Inline child-node refs `{id, nodeType}` carried verbatim. Slice 3
   * preserves them; container-walking lands later. */
  childRefs: Array<{ id: string; nodeType: string }>;
}

/** AIC's email-template-referencing nodes. Both carry the same shape — the
 * `emailTemplateName` field points at an IDM-side `emailTemplate/<name>`
 * record. */
export interface EmailSuspendNodePayload {
  id: string;
  nodeType: "EmailSuspendNode";
  emailTemplateName: string;
}

export interface EmailTemplateNodePayload {
  id: string;
  nodeType: "EmailTemplateNode";
  emailTemplateName: string;
}

/** Pure social-IdP selector (no script). `filteredProviders` lists the
 * subset of the realm's social IdPs presented to the user. */
export interface SelectIdPNodePayload {
  id: string;
  nodeType: "SelectIdPNode";
  filteredProviders: string[];
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
  /** Runtime category — declares which subsystem invokes the script.
   * Common values: `AUTHENTICATION_TREE_DECISION_NODE` (journey scripts),
   * `CONFIG_PROVIDER_NODE`, `LIBRARY` (required modules),
   * `OAUTH2_ACCESS_TOKEN_MODIFICATION`, `OIDC_CLAIMS`, `SAML2_IDP_ADAPTER`,
   * etc. See `poc/script-context-survey.mjs` for the full sb3 distribution. */
  context?: string;
  description?: string;
  /** `true` for AIC-supplied seed/OOTB scripts; `false` for customer-written. */
  isDefault?: boolean;
  /** AIC script-engine version (`"1.0"` vs `"2.0"`). */
  evaluatorVersion?: string;
  /** LDAP-style DN of the last editor. */
  lastModifiedBy?: string;
  /** Epoch milliseconds — render with `new Date(ms).toISOString()`. */
  lastModifiedDate?: number;
}

/** A UI theme registered in `ui/themerealm`. Captures the inspector-relevant
 * subset of AIC's ~80-field theme object; the rest (account-page styling,
 * deep color customization) is intentionally ignored. */
export interface Theme {
  id: string;
  name: string;
  realm: string;
  /** Whether this is the realm's default theme. */
  isDefault?: boolean;
  /** Journey IDs that reference this theme. Free reverse-lookup baked
   * into the response — useful for M5 back-search. */
  linkedTrees?: string[];
  primaryColor?: string;
  backgroundColor?: string;
  backgroundImage?: string;
  /** Localized logo URL keyed by locale code (e.g. `{ "en": "https://…" }`). */
  logo?: Record<string, string>;
  logoAltText?: Record<string, string>;
  journeyLayout?: string;
  fontFamily?: string;
}

/** An IDM email template (`/openidm/config/emailTemplate/<name>`). */
export interface EmailTemplate {
  name: string;
  enabled: boolean;
  from?: string;
  /** Localized — keyed by locale code (e.g. `en`, `fr`). */
  subject?: Record<string, string>;
  message?: Record<string, string>;
  /** Default locale for the template (e.g. `"en"`). */
  defaultLocale?: string;
  /** MIME type of the message — almost always `"text/html"` in AIC. */
  mimeType?: string;
  /** Author-supplied label, often friendlier than the slug `name`. */
  displayName?: string;
  description?: string;
  /** Echoed by the advanced editor; usually matches `name`. */
  templateId?: string;
  /** Separate CSS block authored alongside the message body. */
  styles?: string;
  /** Some advanced-editor templates store a parallel HTML container. */
  html?: Record<string, string>;
  /** True when the template was created via AIC's advanced editor. */
  advancedEditor?: boolean;
}

/** A social-identity provider configured under a realm. */
export interface SocialIdp {
  name: string;
  /** Provider type ("google-oidc", "appleSocialAuthentication", etc.). */
  type: string;
  enabled: boolean;
  realm: string;
}

/** An Environment-Specific Variable — either a variable or a secret. The
 * tenant resolves `&{esv.X}` / `systemEnv.X` in script bodies against one of
 * these two namespaces; we try variables first, then fall back to secrets. */
export type Esv = EsvVariable | EsvSecret;

export interface EsvVariable {
  kind: "variable";
  /** Canonical dotted name (e.g. `esv.kyid.portal.name`). The REST API
   * exposes hyphenated `_id`s; mappers translate to dotted for consistency
   * with how scripts reference ESVs. */
  name: string;
  description?: string;
  /** "string" | "int" | "bool" | "array" | "object" | "list" | "keyvaluelist"
   * | "number" | "base64encodedinlined". */
  expressionType?: string;
  lastChangeDate?: string;
  lastChangedBy?: string;
  /** Whether the variable has been pushed to runtime (`true` = live,
   * `false` = staged). */
  loaded?: boolean;
  /** Base64-encoded value. The webview decodes for display; variables are
   * not sensitive per D22. */
  valueBase64?: string;
}

export interface EsvSecret {
  kind: "secret";
  /** Canonical dotted name (see EsvVariable.name). */
  name: string;
  description?: string;
  encoding?: string;
  lastChangeDate?: string;
  lastChangedBy?: string;
  /** Whether the secret has been pushed to runtime. */
  loaded?: boolean;
  /** Active version PAIC is currently serving. */
  activeVersion?: string;
  /** Version pushed to runtime — can differ from active during a rollout. */
  loadedVersion?: string;
  /** Whether the secret can be referenced via `${esv.x}` placeholder
   * substitution in config strings. */
  useInPlaceholders?: boolean;
}
