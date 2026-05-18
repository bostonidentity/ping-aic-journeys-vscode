import { Handle, type NodeProps, Position } from "reactflow";
import type { DiagramNodeData } from "./ScriptedDecisionNodeView";
import { buildNodeTooltip } from "./tooltip";

export function ClientScriptNodeView({ data }: NodeProps<DiagramNodeData>) {
  const scriptId = data.info?.scriptId;
  return (
    <div
      className={`diag-node client-script ${data.isEntry ? "entry" : ""}`}
      title={buildNodeTooltip(data)}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="kind">Client Script</div>
      <div className="label">{data.displayName ?? "(unnamed)"}</div>
      {scriptId ? <div className="hint">{scriptId}</div> : null}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}
