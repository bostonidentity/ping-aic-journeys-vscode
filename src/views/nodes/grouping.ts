import type { PaicNode } from "./base";
import { CategoryHeaderNode } from "./category-header";
import { EmailTemplateNode } from "./email-template";
import { EsvNode } from "./esv";
import { InnerJourneyNode } from "./inner-journey";
import { LibraryScriptNode } from "./library-script";
import { ScriptNode } from "./script";
import { SocialIdpNode } from "./social-idp";
import { ThemeNode } from "./theme";

type Kind =
  | "innerJourney"
  | "script"
  | "libraryScript"
  | "theme"
  | "emailTemplate"
  | "socialIdp"
  | "esvVariable"
  | "esvSecret"
  | "esvMissing"
  /** Fallback for `EsvNode` instances without a `kind` (D22 ESV index
   * fetch failed; nodes emitted unclassified). Renders as `── ESVs ──`. */
  | "esv";

const KIND_ORDER: Record<Kind, number> = {
  innerJourney: 0,
  script: 1,
  libraryScript: 2,
  theme: 3,
  emailTemplate: 4,
  socialIdp: 5,
  esvVariable: 6,
  esvSecret: 7,
  esvMissing: 8,
  esv: 9,
};

const KIND_LABEL: Record<Kind, string> = {
  innerJourney: "Inner Journeys",
  script: "Scripts",
  libraryScript: "Library Scripts",
  theme: "Themes",
  emailTemplate: "Email Templates",
  socialIdp: "Social IdPs",
  esvVariable: "ESV Variables",
  esvSecret: "ESV Secrets",
  esvMissing: "ESVs (missing)",
  esv: "ESVs",
};

export function kindOf(node: PaicNode): Kind | null {
  if (node instanceof InnerJourneyNode) return "innerJourney";
  if (node instanceof ScriptNode) return "script";
  if (node instanceof LibraryScriptNode) return "libraryScript";
  if (node instanceof ThemeNode) return "theme";
  if (node instanceof EmailTemplateNode) return "emailTemplate";
  if (node instanceof SocialIdpNode) return "socialIdp";
  if (node instanceof EsvNode) {
    // EsvNode.kind is set by script-expand's D22 per-expansion classification
    // (variables + secrets list-fetch). When the fetch failed, the node has
    // no kind — falls back to the unclassified `── ESVs ──` group.
    if (node.kind === "variable") return "esvVariable";
    if (node.kind === "secret") return "esvSecret";
    if (node.kind === "missing") return "esvMissing";
    return "esv";
  }
  return null;
}

function labelOf(node: PaicNode): string {
  // TreeItem.label can be string | TreeItemLabel | undefined.
  const l = node.label;
  if (typeof l === "string") return l;
  if (l && typeof l === "object" && "label" in l) return l.label;
  return "";
}

/** Group children by kind (priority order), alphabetize within each kind,
 * always prepend a `CategoryHeaderNode` to each group — `── <Kind> (N) ──`.
 * Nodes that don't match any known kind (e.g. MessageNode for cycle /
 * missing) are appended at the end in their original order.
 *
 * D33 originally skipped the header when only one kind was present, but
 * that produced confusing structure in deep transitive trees and on
 * copy-paste. As of 2026-05-19 the header is always emitted (see lesson
 * 2026-05-19 in `docs/lessons.md`). */
export function groupAndSort(nodes: readonly PaicNode[]): PaicNode[] {
  const byKind = new Map<Kind, PaicNode[]>();
  const unknowns: PaicNode[] = [];
  for (const n of nodes) {
    const k = kindOf(n);
    if (k === null) {
      unknowns.push(n);
      continue;
    }
    const existing = byKind.get(k);
    if (existing) {
      existing.push(n);
    } else {
      byKind.set(k, [n]);
    }
  }
  const presentKinds = [...byKind.keys()].sort((a, b) => KIND_ORDER[a] - KIND_ORDER[b]);
  const out: PaicNode[] = [];
  for (const k of presentKinds) {
    const group = byKind.get(k);
    if (!group) continue;
    group.sort((a, b) => labelOf(a).localeCompare(labelOf(b), undefined, { sensitivity: "base" }));
    out.push(new CategoryHeaderNode(KIND_LABEL[k], group.length));
    out.push(...group);
  }
  out.push(...unknowns);
  return out;
}
