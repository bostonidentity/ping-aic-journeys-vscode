import { Handle, type NodeProps, Position } from "reactflow";
import type { DiagramNodeData } from "./ScriptedDecisionNodeView";
import { buildNodeTooltip } from "./tooltip";

export function OtherNodeView({ data }: NodeProps<DiagramNodeData>) {
  return (
    <div
      className={`diag-node other ${data.isEntry ? "entry" : ""}`}
      title={buildNodeTooltip(data)}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="kind">{prettyKind(data.nodeType)}</div>
      <div className="label">{data.displayName ?? "(unnamed)"}</div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

function prettyKind(nodeType: string): string {
  // "PageNode" → "Page", "ConfigProviderNode" → "Config Provider".
  return nodeType
    .replace(/Node$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}
