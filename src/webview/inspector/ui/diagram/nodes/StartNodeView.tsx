import { Handle, type NodeProps, Position } from "reactflow";
import type { DiagramNodeData } from "./ScriptedDecisionNodeView";

export function StartNodeView(_: NodeProps<DiagramNodeData>) {
  return (
    <div
      className="diag-node terminal-start"
      title="Platform terminal — every AIC journey begins here."
    >
      <div className="kind">Terminal</div>
      <div className="label">Start</div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
