import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  ControlButton,
  Controls,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type ReactFlowInstance,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";
import type { Journey } from "../../../../domain/types";
import type { NodeInfo } from "../../../messages";
import {
  computeDagreLayout,
  computeLayout,
  type LaidOutNode,
  NODE_H,
  NODE_W,
  START_NODE_ID,
} from "./layout";

// Start is the only fixed anchor — Success / Failure are draggable so users
// can rearrange terminal labels alongside the real flow nodes.
const NON_DRAGGABLE = new Set([START_NODE_ID]);

import { ClientScriptNodeView } from "./nodes/ClientScriptNodeView";
import { ConfigProviderNodeView } from "./nodes/ConfigProviderNodeView";
import { DeviceMatchNodeView } from "./nodes/DeviceMatchNodeView";
import { EmailNodeView } from "./nodes/EmailNodeView";
import { FailureNodeView } from "./nodes/FailureNodeView";
import { InnerTreeEvaluatorNodeView } from "./nodes/InnerTreeEvaluatorNodeView";
import { OtherNodeView } from "./nodes/OtherNodeView";
import { PageNodeView } from "./nodes/PageNodeView";
import { PingOneVerifyCompletionDecisionNodeView } from "./nodes/PingOneVerifyCompletionDecisionNodeView";
import { ScriptedDecisionNodeView } from "./nodes/ScriptedDecisionNodeView";
import { SelectIdPNodeView } from "./nodes/SelectIdPNodeView";
import { SocialProviderHandlerNodeView } from "./nodes/SocialProviderHandlerNodeView";
import { StartNodeView } from "./nodes/StartNodeView";
import { SuccessNodeView } from "./nodes/SuccessNodeView";

interface Props {
  journey: Journey;
  nodeIndex: Record<string, NodeInfo>;
  /** Open the clicked node's card in a separate preview panel beside the
   * main inspector. Does NOT change tree selection or replace the current
   * inspector content. */
  onPreview: (uid: string) => void;
}

/** Map AIC node types to the registered ReactFlow node component. Unknown
 * types fall through to `Other`. Start/Success/Failure are synthesized
 * by `computeLayout` (D28) — they are not real AIC node types but render
 * via dedicated views. */
const nodeTypes = {
  ScriptedDecisionNode: ScriptedDecisionNodeView,
  InnerTreeEvaluatorNode: InnerTreeEvaluatorNodeView,
  PageNode: PageNodeView,
  EmailSuspendNode: EmailNodeView,
  EmailTemplateNode: EmailNodeView,
  SocialProviderHandlerNode: SocialProviderHandlerNodeView,
  SocialProviderHandlerNodeV2: SocialProviderHandlerNodeView,
  SelectIdPNode: SelectIdPNodeView,
  DeviceMatchNode: DeviceMatchNodeView,
  ConfigProviderNode: ConfigProviderNodeView,
  ClientScriptNode: ClientScriptNodeView,
  PingOneVerifyCompletionDecisionNode: PingOneVerifyCompletionDecisionNodeView,
  StartNode: StartNodeView,
  SuccessNode: SuccessNodeView,
  FailureNode: FailureNodeView,
  Other: OtherNodeView,
};

function rfNodeType(aicType: string): keyof typeof nodeTypes {
  if (aicType in nodeTypes) return aicType as keyof typeof nodeTypes;
  return "Other";
}

/** Convert a `LaidOutNode` (pure layout output) into a ReactFlow `Node`.
 * Shared between the initial render and the "Re-layout with dagre" handler
 * (D32) so both paths produce identical node shape. */
function toRfNode(n: LaidOutNode, nodeIndex: Record<string, NodeInfo>): Node {
  return {
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
    // Start is fixed (it's the flow's anchor). Other nodes (including
    // Success/Failure) stay draggable per D26.
    draggable: !NON_DRAGGABLE.has(n.id),
  };
}

export function JourneyDiagram({ journey, nodeIndex, onPreview }: Props) {
  const initial = useMemo(() => {
    const layout = computeLayout(journey);
    const nodes: Node[] = layout.nodes.map((n) => toRfNode(n, nodeIndex));
    const edges: Edge[] = layout.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
    }));
    return { nodes, edges };
  }, [journey, nodeIndex]);

  // useNodesState owns positions for the lifetime of this tab. Drag
  // movements persist within a tab (D26) and reset on close — no
  // persistence layer.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(initial.nodes);

  // Re-seed when the journey identity changes (e.g. parent re-renders with a
  // different journey). Within the same tab + journey, drag positions stay.
  useEffect(() => {
    setRfNodes(initial.nodes);
  }, [initial.nodes, setRfNodes]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      // Any node with a resolved tree-leaf uid opens its card in a separate
      // tab. Synthetic terminals (Success / Failure) have no uid → no-op.
      const info = nodeIndex[node.id];
      if (info?.uid) onPreview(info.uid);
    },
    [nodeIndex, onPreview],
  );

  /** Layout toggle (D32). Default state uses AIC's server-coords layout
   * (D31). Click → switch to dagre. Click again → back to AIC's layout.
   * Drag positions made in either state are discarded on toggle — the
   * toggle is a "give me a fresh arrangement" gesture, not a drag-preserver. */
  const [usingDagre, setUsingDagre] = useState(false);
  const toggleLayout = useCallback(() => {
    const next = !usingDagre;
    setUsingDagre(next);
    const layout = next ? computeDagreLayout(journey) : computeLayout(journey);
    setRfNodes(layout.nodes.map((n) => toRfNode(n, nodeIndex)));
    window.requestAnimationFrame(() => {
      rfInstanceRef.current?.fitView({ padding: 0.12 });
    });
  }, [usingDagre, journey, nodeIndex, setRfNodes]);

  // Expand toggle: collapsed = 360px height inside the card's normal width;
  // expanded = full tab width via the parent card's `:has(.diagram.expanded)`
  // rule + height derived from a 16:9 aspect ratio of the tab width (CSS
  // `aspect-ratio` — taller tabs scroll naturally, so we don't try to
  // measure viewport height). ReactFlow doesn't auto-refit on container
  // resize, so we hold the instance and call fitView() after the size
  // changes.
  const [expanded, setExpanded] = useState(false);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  // Refit the viewport when the container size changes. `expanded` is the
  // trigger signal — the effect must re-run when it toggles even though the
  // body doesn't reference it directly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional re-run on `expanded` toggle
  useEffect(() => {
    if (!rfInstanceRef.current) return;
    const t = window.requestAnimationFrame(() => {
      rfInstanceRef.current?.fitView({ padding: 0.12 });
    });
    return () => window.cancelAnimationFrame(t);
  }, [expanded]);

  if (rfNodes.length === 0) {
    return (
      <section className="diagram-empty">
        <em>No nodes in this journey.</em>
      </section>
    );
  }

  return (
    <section className={`diagram${expanded ? " expanded" : ""}`}>
      <ReactFlow
        nodes={rfNodes}
        edges={initial.edges}
        onNodesChange={onNodesChange}
        onInit={(inst) => {
          rfInstanceRef.current = inst;
        }}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable
      >
        <Background />
        <Controls showInteractive={false} position="top-left">
          <ControlButton
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? "Collapse" : "Expand"}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {/* Horizontal arrows pointing INWARD (collapse) */}
                <path d="M1 7h12" />
                <path d="M2 4l3 3-3 3" />
                <path d="M12 4l-3 3 3 3" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {/* Horizontal arrows pointing OUTWARD (expand) */}
                <path d="M1 7h12" />
                <path d="M5 4L2 7l3 3" />
                <path d="M9 4l3 3-3 3" />
              </svg>
            )}
          </ControlButton>
          <ControlButton
            onClick={toggleLayout}
            title={usingDagre ? "Original layout" : "Re-layout"}
            aria-label={usingDagre ? "Original layout" : "Re-layout"}
          >
            {usingDagre ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {/* Counter-clockwise circular arrow (revert / restore) */}
                <path d="M2.5 7a4.5 4.5 0 1 0 1.3-3.2" />
                <path d="M2 1.5L3.8 3.8L6 3.2" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 14 14"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {/* Tree-graph: root at left, two branches to leaves at right */}
                <circle cx="3" cy="7" r="1.4" />
                <circle cx="11" cy="3" r="1.4" />
                <circle cx="11" cy="11" r="1.4" />
                <path d="M4.4 6L9.6 3.7" fill="none" />
                <path d="M4.4 8L9.6 10.3" fill="none" />
              </svg>
            )}
          </ControlButton>
        </Controls>
      </ReactFlow>
    </section>
  );
}
