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
  | "esv";

const KIND_ORDER: Record<Kind, number> = {
  innerJourney: 0,
  script: 1,
  libraryScript: 2,
  theme: 3,
  emailTemplate: 4,
  socialIdp: 5,
  esv: 6,
};

const KIND_HEADER: Record<Kind, string> = {
  innerJourney: "── Inner Journeys ──",
  script: "── Scripts ──",
  libraryScript: "── Library Scripts ──",
  theme: "── Themes ──",
  emailTemplate: "── Email Templates ──",
  socialIdp: "── Social IdPs ──",
  esv: "── ESVs ──",
};

export function kindOf(node: PaicNode): Kind | null {
  if (node instanceof InnerJourneyNode) return "innerJourney";
  if (node instanceof ScriptNode) return "script";
  if (node instanceof LibraryScriptNode) return "libraryScript";
  if (node instanceof ThemeNode) return "theme";
  if (node instanceof EmailTemplateNode) return "emailTemplate";
  if (node instanceof SocialIdpNode) return "socialIdp";
  if (node instanceof EsvNode) return "esv";
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
 * prepend a `CategoryHeaderNode` to each group ONLY when 2+ kinds are
 * present. Nodes that don't match any known kind (e.g. MessageNode for
 * cycle/missing) are appended at the end in their original order. D33. */
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
  const multi = presentKinds.length >= 2;
  const out: PaicNode[] = [];
  for (const k of presentKinds) {
    const group = byKind.get(k);
    if (!group) continue;
    group.sort((a, b) => labelOf(a).localeCompare(labelOf(b), undefined, { sensitivity: "base" }));
    if (multi) out.push(new CategoryHeaderNode(KIND_HEADER[k]));
    out.push(...group);
  }
  out.push(...unknowns);
  return out;
}
