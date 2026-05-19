import { Handle, type NodeProps, Position } from "reactflow";
import type { DiagramNodeData } from "./ScriptedDecisionNodeView";

export function FailureNodeView(_: NodeProps<DiagramNodeData>) {
  return (
    <div
      className="diag-node terminal-failure"
      title="Platform terminal — every AIC journey ends here."
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="kind">Terminal</div>
      <div className="label">Failure</div>
    </div>
  );
}
