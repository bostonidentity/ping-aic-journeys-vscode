import { Handle, type NodeProps, Position } from "reactflow";
import type { DiagramNodeData } from "./ScriptedDecisionNodeView";
import { buildNodeTooltip } from "./tooltip";

export function DeviceMatchNodeView({ data }: NodeProps<DiagramNodeData>) {
  const info = data.info;
  const inactive = info?.useScript === false;
  const scriptLabel = inactive ? undefined : (info?.scriptName ?? info?.scriptId);
  return (
    <div
      className={`diag-node device-match ${data.isEntry ? "entry" : ""}`}
      title={buildNodeTooltip(data)}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="kind">Device Match</div>
      <div className="label">{data.displayName ?? "(unnamed)"}</div>
      {scriptLabel ? <div className="hint">{scriptLabel}</div> : null}
      {inactive ? <div className="hint">Script: inactive</div> : null}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
