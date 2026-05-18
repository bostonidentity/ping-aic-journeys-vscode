import { Handle, type NodeProps, Position } from "reactflow";
import type { DiagramNodeData } from "./ScriptedDecisionNodeView";
import { buildNodeTooltip } from "./tooltip";

export function SocialProviderHandlerNodeView({ data }: NodeProps<DiagramNodeData>) {
  const isV2 = data.nodeType === "SocialProviderHandlerNodeV2";
  const idpNames = data.info?.socialIdpNames ?? [];
  const summary = idpSummary(idpNames);
  return (
    <div
      className={`diag-node social ${data.isEntry ? "entry" : ""}`}
      title={buildNodeTooltip(data)}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="kind">{isV2 ? "Social Provider (V2)" : "Social Provider"}</div>
      <div className="label">{data.displayName ?? "(unnamed)"}</div>
      {summary ? <div className="hint">{summary}</div> : null}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

function idpSummary(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length <= 2) return `IdPs: ${names.join(", ")}`;
  return `IdPs (${names.length}): ${names.slice(0, 2).join(", ")}, …`;
}
