import { Handle, type NodeProps, Position } from "reactflow";
import type { DiagramNodeData } from "./ScriptedDecisionNodeView";
import { buildNodeTooltip } from "./tooltip";

export function InnerTreeEvaluatorNodeView({ data }: NodeProps<DiagramNodeData>) {
  return (
    <div
      className={`diag-node inner ${data.isEntry ? "entry" : ""}`}
      title={buildNodeTooltip(data)}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="kind">Inner Journey</div>
      <div className="label">{data.displayName ?? data.info?.innerTreeId ?? "(unnamed)"}</div>
      {data.info?.innerTreeId ? <div className="hint">{data.info.innerTreeId}</div> : null}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
