import { Handle, type NodeProps, Position } from "reactflow";
import type { NodeInfo } from "../../../../messages";
import { buildNodeTooltip } from "./tooltip";

export interface DiagramNodeData {
  displayName?: string;
  nodeType: string;
  info?: NodeInfo;
  isEntry: boolean;
}

export function ScriptedDecisionNodeView({ data }: NodeProps<DiagramNodeData>) {
  return (
    <div
      className={`diag-node script ${data.isEntry ? "entry" : ""}`}
      title={buildNodeTooltip(data)}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="kind">Scripted Decision</div>
      <div className="label">{data.displayName ?? "(unnamed)"}</div>
      {data.info?.scriptName || data.info?.scriptId ? (
        <div className="hint">{data.info?.scriptName ?? data.info?.scriptId}</div>
      ) : null}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
