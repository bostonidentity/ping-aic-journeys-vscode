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
    if (info.scriptName) lines.push(`Script: ${info.scriptName}`);
    lines.push(`Script ID: ${info.scriptId}`);
    if (info.outcomes?.length) lines.push(`Outcomes: ${info.outcomes.join(", ")}`);
    if (info.inputs?.length) lines.push(`Inputs: ${info.inputs.join(", ")}`);
    if (info.outputs?.length) lines.push(`Outputs: ${info.outputs.join(", ")}`);
    if (info.socialIdpNames?.length) lines.push(`IdPs: ${info.socialIdpNames.join(", ")}`);
  } else if (info?.kind === "inner" && info.innerTreeId) {
    lines.push(`Inner tree: ${info.innerTreeId}`);
  } else if (info?.kind === "theme" && info.themeId) {
    lines.push(`Theme: ${info.themeId}`);
  } else if (info?.kind === "emailTemplate" && info.emailTemplateName) {
    lines.push(`Template: ${info.emailTemplateName}`);
  } else if (info?.kind === "socialIdp" && info.socialIdpNames?.length) {
    lines.push(`IdPs: ${info.socialIdpNames.join(", ")}`);
  } else if (info?.kind === "other" && info.rawNodeType) {
    lines.push(`AIC type: ${info.rawNodeType}`);
  }
  if (info?.useScript === false) {
    // biome-ignore lint/security/noSecrets: tooltip text, not a secret
    lines.push("Script: inactive (useScript=false)");
  }
  return lines.join("\n");
}

function prettyKind(nodeType: string): string {
  return nodeType
    .replace(/Node$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}
