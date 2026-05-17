import { useCallback, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "reactflow";
import "reactflow/dist/style.css";
import type { Journey } from "../../../../domain/types";
import type { NodeInfo } from "../../../messages";
import { computeLayout, NODE_H, NODE_W } from "./layout";
import { InnerTreeEvaluatorNodeView } from "./nodes/InnerTreeEvaluatorNodeView";
import { OtherNodeView } from "./nodes/OtherNodeView";
import { ScriptedDecisionNodeView } from "./nodes/ScriptedDecisionNodeView";

interface Props {
  journey: Journey;
  nodeIndex: Record<string, NodeInfo>;
  host: string;
  realm: string;
  onNavigate: (uid: string) => void;
  onOpenBody: (host: string, realm: string, scriptId: string, language?: string) => void;
}

/** Map AIC node types to the registered ReactFlow node component. Unknown
 * types fall through to `Other`. */
const nodeTypes = {
  ScriptedDecisionNode: ScriptedDecisionNodeView,
  InnerTreeEvaluatorNode: InnerTreeEvaluatorNodeView,
  Other: OtherNodeView,
};

function rfNodeType(aicType: string): keyof typeof nodeTypes {
  if (aicType === "ScriptedDecisionNode" || aicType === "InnerTreeEvaluatorNode") return aicType;
  return "Other";
}

export function JourneyDiagram({ journey, nodeIndex, host, realm, onNavigate, onOpenBody }: Props) {
  const { rfNodes, rfEdges } = useMemo(() => {
    const layout = computeLayout(journey);
    const nodes: Node[] = layout.nodes.map((n) => ({
      id: n.id,
      type: rfNodeType(n.nodeType),
      position: { x: n.x, y: n.y },
      data: {
        displayName: n.displayName,
        nodeType: n.nodeType,
        info: nodeIndex[n.id],
        isEntry: n.isEntry,
      },
      width: NODE_W,
      height: NODE_H,
    }));
    const edges: Edge[] = layout.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
    }));
    return { rfNodes: nodes, rfEdges: edges };
  }, [journey, nodeIndex]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const info = nodeIndex[node.id];
      if (!info) return;
      if (info.kind === "script" && info.scriptId) {
        onOpenBody(host, realm, info.scriptId);
      } else if (info.kind === "inner" && info.uid) {
        onNavigate(info.uid);
      }
    },
    [nodeIndex, host, realm, onNavigate, onOpenBody],
  );

  if (rfNodes.length === 0) {
    return (
      <section className="diagram-empty">
        <em>No nodes in this journey.</em>
      </section>
    );
  }

  return (
    <section className="diagram" style={{ height: 360 }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>
  );
}
