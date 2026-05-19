import { Handle, type NodeProps, Position } from "reactflow";
import type { DiagramNodeData } from "./ScriptedDecisionNodeView";
import { buildNodeTooltip } from "./tooltip";

export function EmailNodeView({ data }: NodeProps<DiagramNodeData>) {
  const isSuspend = data.nodeType === "EmailSuspendNode";
  const kindLabel = isSuspend ? "Email Suspend" : "Email Template";
  const name = data.info?.emailTemplateName;
  return (
    <div
      className={`diag-node email ${data.isEntry ? "entry" : ""}`}
      title={buildNodeTooltip(data)}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="kind">{kindLabel}</div>
      <div className="label">{data.displayName ?? "(unnamed)"}</div>
      {name ? <div className="hint">Template: {name}</div> : null}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
