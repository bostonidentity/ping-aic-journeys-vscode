import type { DiagramNodeData } from "./ScriptedDecisionNodeView";

/** Build a multi-line title-attribute string for a diagram node. Used by all
 * three node views (script/inner/other). Browser-native tooltip — no styling,
 * but accessible and dependency-free. */
export function buildNodeTooltip(data: DiagramNodeData): string {
  const lines: string[] = [];
  const info = data.info;
  lines.push(`${prettyKind(data.nodeType)}${data.isEntry ? " (entry)" : ""}`);
  if (data.displayName) lines.push(`Name: ${data.displayName}`);
  if (info?.kind === "script" && info.scriptId) {
    lines.push(`Script ID: ${info.scriptId}`);
    if (info.outcomes?.length) lines.push(`Outcomes: ${info.outcomes.join(", ")}`);
    if (info.inputs?.length) lines.push(`Inputs: ${info.inputs.join(", ")}`);
    if (info.outputs?.length) lines.push(`Outputs: ${info.outputs.join(", ")}`);
  } else if (info?.kind === "inner" && info.innerTreeId) {
    lines.push(`Inner tree: ${info.innerTreeId}`);
  } else if (info?.kind === "other" && info.rawNodeType) {
    lines.push(`AIC type: ${info.rawNodeType}`);
  }
  return lines.join("\n");
}

function prettyKind(nodeType: string): string {
  return nodeType
    .replace(/Node$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}
