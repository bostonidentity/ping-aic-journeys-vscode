import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../../util/vscode-mock")).makeVscodeMock());

import { describe, expect, it } from "vitest";
import type { Journey, NodePayload } from "@/domain/types";
import { MessageNode } from "@/views/nodes/base";
import { InnerJourneyNode } from "@/views/nodes/inner-journey";
import { JourneyNode } from "@/views/nodes/journey";
import { ScriptNode } from "@/views/nodes/script";
import { makeFakeCache, makeFakeLogger, makeFakePaicClient } from "../fakes";

const HOST = "h.example.com";
const REALM = "alpha";

function scriptedDecisionPayload(id: string, scriptId: string): NodePayload {
  return {
    id,
    nodeType: "ScriptedDecisionNode",
    scriptId,
    outcomes: ["true", "false"],
    inputs: ["*"],
    outputs: ["*"],
  };
}

function innerTreePayload(id: string, tree: string): NodePayload {
  return { id, nodeType: "InnerTreeEvaluatorNode", tree };
}

function otherPayload(id: string, raw = "PageNode"): NodePayload {
  return { id, nodeType: "other", rawNodeType: raw, raw: {} };
}

/** Build a Journey skeleton + a client whose `getNode` returns the supplied payloads. */
function makeFixture(
  journeyId: string,
  nodes: Record<string, { nodeType: string; payload: NodePayload }>,
) {
  const journey: Journey = {
    id: journeyId,
    enabled: true,
    entryNodeId: "n0",
    nodes: Object.fromEntries(
      Object.entries(nodes).map(([id, n]) => [id, { nodeType: n.nodeType, connections: {} }]),
    ),
  };
  const nodesByKey: Record<string, NodePayload> = {};
  for (const [id, n] of Object.entries(nodes)) {
    nodesByKey[`${REALM}:${n.nodeType}:${id}`] = n.payload;
  }
  const client = makeFakePaicClient({ nodesByKey });
  const cache = makeFakeCache(client);
  return {
    journey,
    client,
    node: new JourneyNode(HOST, REALM, journey, cache, makeFakeLogger()),
  };
}

describe("JourneyNode", () => {
  it("emits one ScriptNode per ScriptedDecisionNode and one InnerJourneyNode per InnerTreeEvaluatorNode", async () => {
    const { node } = makeFixture("Login", {
      n1: { nodeType: "ScriptedDecisionNode", payload: scriptedDecisionPayload("n1", "s-1") },
      n2: { nodeType: "InnerTreeEvaluatorNode", payload: innerTreePayload("n2", "Inner") },
    });
    const kids = await node.getChildren();
    expect(kids).toHaveLength(2);
    const script = kids.find((k) => k instanceof ScriptNode) as ScriptNode;
    const inner = kids.find((k) => k instanceof InnerJourneyNode) as InnerJourneyNode;
    expect(script.scriptId).toBe("s-1");
    expect(inner.id).toBe("Inner");
    // visited carries the parent journey id for cycle-checking downstream.
    expect(inner.visited).toEqual(["Login"]);
  });

  it("dedupes a shared script (two nodes → one ScriptNode)", async () => {
    const { node } = makeFixture("Login", {
      n1: { nodeType: "ScriptedDecisionNode", payload: scriptedDecisionPayload("n1", "s-1") },
      n2: { nodeType: "ScriptedDecisionNode", payload: scriptedDecisionPayload("n2", "s-1") },
    });
    const kids = await node.getChildren();
    expect(kids).toHaveLength(1);
    expect(kids[0]).toBeInstanceOf(ScriptNode);
  });

  it("skips 'other' node types at M1", async () => {
    const { node } = makeFixture("Login", {
      n1: { nodeType: "PageNode", payload: otherPayload("n1") },
      n2: { nodeType: "ScriptedDecisionNode", payload: scriptedDecisionPayload("n2", "s-1") },
    });
    const kids = await node.getChildren();
    expect(kids).toHaveLength(1);
    expect(kids[0]).toBeInstanceOf(ScriptNode);
  });

  it("only-Other / empty-deps surfaces a MessageNode", async () => {
    const { node } = makeFixture("Login", {
      n1: { nodeType: "PageNode", payload: otherPayload("n1") },
    });
    const kids = await node.getChildren();
    expect(kids).toHaveLength(1);
    expect(kids[0]).toBeInstanceOf(MessageNode);
    expect(kids[0].label).toBe("No script or inner-tree dependencies");
  });

  it("refresh() clears the cache — next getChildren re-calls getNode", async () => {
    const { node, client } = makeFixture("Login", {
      n1: { nodeType: "ScriptedDecisionNode", payload: scriptedDecisionPayload("n1", "s-1") },
    });
    await node.getChildren();
    await node.getChildren();
    expect((client.getNode as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    node.refresh();
    await node.getChildren();
    expect((client.getNode as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});
