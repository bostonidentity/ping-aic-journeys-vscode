/**
 * Import bundle parser — identifies and summarizes a frodo / PAIC-UI export
 * bundle for the Transfer page's read-only Source preview (D42 / TD-6, M9
 * Phase 4 Batch 1 Slice A). Pure TypeScript: no `vscode`, no network.
 *
 * The inverse of `src/export/serialize.ts`, but Slice A only needs to
 * *recognize* a bundle and describe its contents — value extraction for the
 * actual writes lands in Slice C.
 */

import type { ExportMeta } from "../export/serialize";
import { discoverJourneyRefs } from "./discover";

export type BundleKind =
  | "journey"
  | "script"
  | "theme"
  | "emailTemplate"
  | "socialIdp"
  | "variable"
  | "secret";

/** One component row in the Source preview. */
export interface ComponentSummary {
  kind: BundleKind;
  /** The bundle map key — script UUID, theme id, `emailTemplate/<name>`, … */
  id: string;
  displayName: string;
  /** Secondary descriptor — social-IdP provider type, "library script", … */
  detail?: string;
}

/** A recognized, summarized bundle — drives the read-only Source preview. */
export interface ParsedBundle {
  /** Provenance block; may be absent (the `meta` block is opt-out — TD-2). */
  meta: ExportMeta | null;
  kind: BundleKind;
  /** Type-chip label, e.g. "Journey bundle (2 trees)" / "Theme". */
  label: string;
  components: ComponentSummary[];
  /** Extra human-readable preview lines (counts, requires) — journeys mainly. */
  inventory: string[];
}

/** A bundle component plus its raw export object — extracted in the same parse
 * pass and kept extension-side (never posted to the webview) for the compare.
 * Journey bundles decompose into journey units (each tree; its nodes fold into
 * `raw`, PD-3) + the shared leaves they carry, deduped across trees (PD-6). */
export interface ImportComponent {
  kind: BundleKind;
  id: string;
  displayName: string;
  raw: Record<string, unknown>;
}

export type ParseResult =
  | { ok: true; bundle: ParsedBundle; rawComponents: ImportComponent[] }
  | { ok: false; error: string };

/** Frodo per-type bundle key → our `BundleKind` (inverse of `PER_TYPE_KEY`).
 * `script` covers both decision and library scripts; `idp` is frodo's key for
 * social identity providers. */
const LEAF_KEY_TO_KIND: Record<string, BundleKind> = {
  script: "script",
  theme: "theme",
  emailTemplate: "emailTemplate",
  idp: "socialIdp",
  variable: "variable",
  secret: "secret",
};

/** Per-tree leaf-map name → BundleKind, for decomposing a journey bundle's shared
 * leaves (the D42 per-tree maps). Nodes/innerNodes fold into the journey unit
 * (PD-3); `circlesOfTrust` / `saml2Entities` are out of scope. */
const TREE_LEAF_MAPS: ReadonlyArray<{ mapKey: string; kind: BundleKind }> = [
  { mapKey: "scripts", kind: "script" },
  { mapKey: "themes", kind: "theme" },
  { mapKey: "emailTemplates", kind: "emailTemplate" },
  { mapKey: "socialIdentityProviders", kind: "socialIdp" },
];

const KIND_LABEL: Record<BundleKind, string> = {
  journey: "Journey bundle",
  script: "Script",
  theme: "Theme",
  emailTemplate: "Email template",
  socialIdp: "Social IdP",
  variable: "ESV variable",
  secret: "ESV secret",
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const countMap = (v: unknown): number => (isRecord(v) ? Object.keys(v).length : 0);

/**
 * Recognize + summarize an export bundle from its JSON text. Never throws —
 * malformed input returns `{ ok: false, error }` so the panel can surface a
 * friendly banner.
 */
export function parseBundle(text: string): ParseResult {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file isn't valid JSON." };
  }
  if (!isRecord(root)) {
    return { ok: false, error: "This file isn't a PAIC export bundle." };
  }
  const meta = isRecord(root.meta) ? (root.meta as unknown as ExportMeta) : null;

  // Journey bundle — { meta, trees: { <name>: SingleTreeExport } }.
  if (isRecord(root.trees)) {
    return { ok: true, ...summarizeJourney(root.trees, meta) };
  }

  // Leaf bundle — exactly one per-type key present.
  const present = Object.keys(LEAF_KEY_TO_KIND).filter((k) => isRecord(root[k]));
  if (present.length === 0) {
    return {
      ok: false,
      error: "This doesn't look like a PAIC export bundle (no recognizable component).",
    };
  }
  if (present.length > 1) {
    return {
      ok: false,
      error: `This bundle mixes multiple component types (${present.join(", ")}) — not supported.`,
    };
  }
  const key = present[0];
  return { ok: true, ...summarizeLeaf(key, root[key] as Record<string, unknown>, meta) };
}

function summarizeLeaf(
  key: string,
  map: Record<string, unknown>,
  meta: ExportMeta | null,
): { bundle: ParsedBundle; rawComponents: ImportComponent[] } {
  const kind = LEAF_KEY_TO_KIND[key];
  const components: ComponentSummary[] = [];
  const rawComponents: ImportComponent[] = [];
  for (const [id, raw] of Object.entries(map)) {
    const obj = isRecord(raw) ? raw : {};
    const displayName = leafDisplayName(kind, id, obj);
    const detail = leafDetail(kind, obj);
    components.push({ kind, id, displayName, ...(detail ? { detail } : {}) });
    rawComponents.push({ kind, id, displayName, raw: obj });
  }
  const bundle: ParsedBundle = { meta, kind, label: KIND_LABEL[kind], components, inventory: [] };
  return { bundle, rawComponents };
}

function leafDisplayName(kind: BundleKind, id: string, obj: Record<string, unknown>): string {
  // Email templates are keyed `emailTemplate/<name>` — show just the name.
  if (kind === "emailTemplate") return id.replace(/^emailTemplate\//, "");
  return str(obj.name) ?? id;
}

function leafDetail(kind: BundleKind, obj: Record<string, unknown>): string | undefined {
  if (kind === "socialIdp") {
    // `_type` is `{ _id: "oidcConfig", … }` — the provider type.
    const t = obj._type;
    return isRecord(t) ? str(t._id) : str(t);
  }
  if (kind === "script") {
    return str(obj.context) === "LIBRARY" ? "library script" : undefined;
  }
  if (kind === "variable") {
    // Variable values are NOT secret (D22) and travel in the bundle as the raw
    // `valueBase64` — decode it so the user sees exactly what will be written.
    // Extension-side only (this never runs in the webview); never logged.
    const b64 = str(obj.valueBase64);
    return b64 === undefined ? undefined : `value: ${Buffer.from(b64, "base64").toString("utf8")}`;
  }
  if (kind === "secret") {
    return "value supplied at import"; // secret value is never in the bundle (write-only)
  }
  return undefined;
}

function summarizeJourney(
  trees: Record<string, unknown>,
  meta: ExportMeta | null,
): { bundle: ParsedBundle; rawComponents: ImportComponent[] } {
  const names = Object.keys(trees);
  const components: ComponentSummary[] = names.map((name) => ({
    kind: "journey",
    id: name,
    displayName: name,
  }));

  // Aggregate the flat per-tree leaf maps across every bundled tree.
  let nodes = 0;
  let innerNodes = 0;
  let scripts = 0;
  let libs = 0;
  let themes = 0;
  let emails = 0;
  let idps = 0;
  for (const t of Object.values(trees)) {
    if (!isRecord(t)) continue;
    nodes += countMap(t.nodes);
    innerNodes += countMap(t.innerNodes);
    themes += countMap(t.themes);
    emails += countMap(t.emailTemplates);
    idps += countMap(t.socialIdentityProviders);
    if (isRecord(t.scripts)) {
      for (const s of Object.values(t.scripts)) {
        scripts += 1;
        if (isRecord(s) && str(s.context) === "LIBRARY") libs += 1;
      }
    }
  }

  const inventory: string[] = [];
  if (meta?.depthMode) inventory.push(`Depth: ${meta.depthMode}`);
  inventory.push(`Nodes: ${nodes}${innerNodes ? ` · Inner nodes: ${innerNodes}` : ""}`);
  if (scripts) inventory.push(`Scripts: ${scripts}${libs ? ` (${libs} library)` : ""}`);
  const idmLine = [
    themes ? `Themes: ${themes}` : "",
    emails ? `Email templates: ${emails}` : "",
    idps ? `Social IdPs: ${idps}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (idmLine) inventory.push(idmLine);

  // Decompose into the flat import units FIRST: one journey unit per tree (its nodes
  // fold into `raw`, PD-3) + the shared leaves it carries, deduped across trees (PD-6).
  const rawComponents: ImportComponent[] = [];
  for (const [treeId, t] of Object.entries(trees)) {
    if (!isRecord(t)) continue;
    rawComponents.push({
      kind: "journey",
      id: treeId,
      displayName: treeId,
      raw: {
        tree: isRecord(t.tree) ? t.tree : {},
        nodes: isRecord(t.nodes) ? t.nodes : {},
        innerNodes: isRecord(t.innerNodes) ? t.innerNodes : {},
      },
    });
  }
  const seen = new Set<string>();
  for (const t of Object.values(trees)) {
    if (!isRecord(t)) continue;
    for (const { mapKey, kind } of TREE_LEAF_MAPS) {
      const map = t[mapKey];
      if (!isRecord(map)) continue;
      for (const [id, raw] of Object.entries(map)) {
        const dedupKey = `${kind}:${id}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        const obj = isRecord(raw) ? raw : {};
        rawComponents.push({ kind, id, displayName: leafDisplayName(kind, id, obj), raw: obj });
      }
    }
  }

  // PD-18 (content-derived, shared with the S3 gate via discoverJourneyRefs): inner
  // journeys an InnerTreeEvaluatorNode references but that aren't bundled must already
  // exist on the target.
  const { innerJourneys } = discoverJourneyRefs(rawComponents);
  if (innerJourneys.length > 0) {
    inventory.push(`References inner journeys (must exist on target): ${innerJourneys.join(", ")}`);
  }

  const n = names.length;
  const bundle: ParsedBundle = {
    meta,
    kind: "journey",
    label: `Journey bundle (${n} tree${n === 1 ? "" : "s"})`,
    components,
    inventory,
  };
  return { bundle, rawComponents };
}
