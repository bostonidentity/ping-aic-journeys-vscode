import { Handle, type NodeProps, Position } from "reactflow";
import type { DiagramNodeData } from "./ScriptedDecisionNodeView";
import { buildNodeTooltip } from "./tooltip";

export function PageNodeView({ data }: NodeProps<DiagramNodeData>) {
  const themeId = data.info?.themeId;
  return (
    <div className={`diag-node page ${data.isEntry ? "entry" : ""}`} title={buildNodeTooltip(data)}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="kind">Page</div>
      <div className="label">{data.displayName ?? "(unnamed)"}</div>
      {themeId ? <div className="hint">Theme: {themeId}</div> : null}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}
