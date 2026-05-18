import { Handle, type NodeProps, Position } from "reactflow";
import type { DiagramNodeData } from "./ScriptedDecisionNodeView";
import { buildNodeTooltip } from "./tooltip";

export function ConfigProviderNodeView({ data }: NodeProps<DiagramNodeData>) {
  const info = data.info;
  const inactive = info?.useScript === false;
  const scriptId = inactive ? undefined : info?.scriptId;
  return (
    <div
      className={`diag-node config-provider ${data.isEntry ? "entry" : ""}`}
      title={buildNodeTooltip(data)}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="kind">Config Provider</div>
      <div className="label">{data.displayName ?? "(unnamed)"}</div>
      {scriptId ? <div className="hint">{scriptId}</div> : null}
      {inactive ? <div className="hint">Script: inactive</div> : null}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}
