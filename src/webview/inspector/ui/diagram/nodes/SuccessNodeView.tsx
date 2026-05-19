import { Handle, type NodeProps, Position } from "reactflow";
import type { DiagramNodeData } from "./ScriptedDecisionNodeView";

export function SuccessNodeView(_: NodeProps<DiagramNodeData>) {
  return (
    <div
      className="diag-node terminal-success"
      title="Platform terminal — every AIC journey ends here."
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="kind">Terminal</div>
      <div className="label">Success</div>
    </div>
  );
}
