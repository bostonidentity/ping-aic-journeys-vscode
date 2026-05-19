import { Handle, type NodeProps, Position } from "reactflow";
import type { DiagramNodeData } from "./ScriptedDecisionNodeView";
import { buildNodeTooltip } from "./tooltip";

function summarizeIdps(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length <= 2) return `IdPs: ${names.join(", ")}`;
  return `IdPs (${names.length}): ${names.slice(0, 2).join(", ")}, …`;
}

export function SelectIdPNodeView({ data }: NodeProps<DiagramNodeData>) {
  const idpNames = data.info?.socialIdpNames ?? [];
  const summary = summarizeIdps(idpNames);
  return (
    <div
      className={`diag-node select-idp ${data.isEntry ? "entry" : ""}`}
      title={buildNodeTooltip(data)}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="kind">Select IdP</div>
      <div className="label">{data.displayName ?? "(unnamed)"}</div>
      {summary ? <div className="hint">{summary}</div> : null}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
