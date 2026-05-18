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

  it("eager-fetches scripts during journey-expand → ScriptNode carries scriptName + label uses name", async () => {
    const journey: Journey = {
      id: "Login",
      enabled: true,
      entryNodeId: "n0",
      nodes: { n1: { nodeType: "ScriptedDecisionNode", connections: {} } },
    };
    const client = makeFakePaicClient({
      nodesByKey: {
        "alpha:ScriptedDecisionNode:n1": scriptedDecisionPayload("n1", "s-1"),
      },
      scriptsByKey: {
        "alpha:s-1": {
          id: "s-1",
          name: "AuthHelper",
          language: "JAVASCRIPT",
          body: "// body",
        },
      },
    });
    const cache = makeFakeCache(client);
    const node = new JourneyNode(HOST, REALM, journey, cache, makeFakeLogger());
    const kids = await node.getChildren();
    const script = kids.find((k) => k instanceof ScriptNode) as ScriptNode;
    expect(script.scriptName).toBe("AuthHelper");
    expect(script.label).toBe("AuthHelper");
    // description is the scriptId — keeps the UUID discoverable beside the label.
    expect(script.description).toBe("s-1");
    // Body is pre-stashed → ensureBody() short-circuits (no second getScript call).
    expect(await script.ensureBody()).toBe("// body");
    expect((client.getScript as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("falls back to scriptId on tree label when eager getScript fails", async () => {
    const { node } = makeFixture("Login", {
      n1: { nodeType: "ScriptedDecisionNode", payload: scriptedDecisionPayload("n1", "s-1") },
    });
    const kids = await node.getChildren();
    const script = kids.find((k) => k instanceof ScriptNode) as ScriptNode;
    // No scriptsByKey fixture → getScript rejected → ScriptNode falls back.
    expect(script.scriptName).toBeUndefined();
    expect(script.label).toBe("s-1");
    expect(script.description).toBeUndefined();
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
    expect(kids[0].label).toBe("No dependencies discovered");
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

  it("emits a ScriptNode for a ClientScriptNode (D19 predicate widens beyond ScriptedDecisionNode)", async () => {
    const clientScriptPayload: NodePayload = {
      id: "n1",
      nodeType: "ClientScriptNode",
      scriptId: "s-client",
    };
    const { node } = makeFixture("Login", {
      n1: { nodeType: "ClientScriptNode", payload: clientScriptPayload },
    });
    const kids = await node.getChildren();
    expect(kids).toHaveLength(1);
    expect(kids[0]).toBeInstanceOf(ScriptNode);
    expect((kids[0] as ScriptNode).scriptId).toBe("s-client");
  });

  it("emits a ThemeNode when a PageNode payload carries a themeId", async () => {
    const { ThemeNode } = await import("@/views/nodes/theme");
    const pagePayload: NodePayload = {
      id: "n1",
      nodeType: "PageNode",
      themeId: "theme-1",
      childRefs: [],
    };
    const { node } = makeFixture("Login", {
      n1: { nodeType: "PageNode", payload: pagePayload },
    });
    const kids = await node.getChildren();
    expect(kids).toHaveLength(1);
    expect(kids[0]).toBeInstanceOf(ThemeNode);
    expect((kids[0] as InstanceType<typeof ThemeNode>).themeId).toBe("theme-1");
  });

  it("emits an EmailTemplateNode when an EmailSuspendNode payload carries emailTemplateName", async () => {
    const { EmailTemplateNode } = await import("@/views/nodes/email-template");
    const emailPayload: NodePayload = {
      id: "n1",
      nodeType: "EmailSuspendNode",
      emailTemplateName: "PasswordResetMail",
    };
    const { node } = makeFixture("Login", {
      n1: { nodeType: "EmailSuspendNode", payload: emailPayload },
    });
    const kids = await node.getChildren();
    expect(kids).toHaveLength(1);
    expect(kids[0]).toBeInstanceOf(EmailTemplateNode);
    expect((kids[0] as InstanceType<typeof EmailTemplateNode>).name).toBe("PasswordResetMail");
  });

  it("PageNode container walk — a nested ScriptedDecisionNode emits a journey-level ScriptNode", async () => {
    // PageNode → childRefs includes a ScriptedDecisionNode → its script
    // surfaces as a top-level ScriptNode child of the journey.
    const journey: Journey = {
      id: "Login",
      enabled: true,
      entryNodeId: "p1",
      nodes: { p1: { nodeType: "PageNode", connections: {} } },
    };
    const nodesByKey: Record<string, NodePayload> = {
      "alpha:PageNode:p1": {
        id: "p1",
        nodeType: "PageNode",
        childRefs: [{ id: "child-sd", nodeType: "ScriptedDecisionNode" }],
      },
      "alpha:ScriptedDecisionNode:child-sd": scriptedDecisionPayload("child-sd", "s-nested"),
    };
    const client = makeFakePaicClient({ nodesByKey });
    const cache = makeFakeCache(client);
    const node = new JourneyNode(HOST, REALM, journey, cache, makeFakeLogger());
    const kids = await node.getChildren();
    const scriptKid = kids.find((k) => k instanceof ScriptNode) as ScriptNode | undefined;
    expect(scriptKid).toBeDefined();
    expect(scriptKid?.scriptId).toBe("s-nested");
  });

  it("PageNode container walk — a nested InnerTreeEvaluatorNode emits a journey-level InnerJourneyNode", async () => {
    const journey: Journey = {
      id: "Login",
      enabled: true,
      entryNodeId: "p1",
      nodes: { p1: { nodeType: "PageNode", connections: {} } },
    };
    const nodesByKey: Record<string, NodePayload> = {
      "alpha:PageNode:p1": {
        id: "p1",
        nodeType: "PageNode",
        childRefs: [{ id: "child-it", nodeType: "InnerTreeEvaluatorNode" }],
      },
      "alpha:InnerTreeEvaluatorNode:child-it": innerTreePayload("child-it", "NestedInner"),
    };
    const client = makeFakePaicClient({ nodesByKey });
    const cache = makeFakeCache(client);
    const node = new JourneyNode(HOST, REALM, journey, cache, makeFakeLogger());
    const kids = await node.getChildren();
    const innerKid = kids.find((k) => k instanceof InnerJourneyNode) as
      | InnerJourneyNode
      | undefined;
    expect(innerKid).toBeDefined();
    expect(innerKid?.id).toBe("NestedInner");
  });

  it("emits one SocialIdpNode per unique filteredProvider, deduped across multiple nodes", async () => {
    const { SocialIdpNode } = await import("@/views/nodes/social-idp");
    const selectPayload: NodePayload = {
      id: "n1",
      nodeType: "SelectIdPNode",
      filteredProviders: ["google-oidc", "apple-oidc"],
    };
    const handlerPayload: NodePayload = {
      id: "n2",
      nodeType: "SocialProviderHandlerNode",
      scriptId: "s-social",
      filteredProviders: ["google-oidc"], // overlaps with SelectIdPNode → dedup
    };
    const { node } = makeFixture("Login", {
      n1: { nodeType: "SelectIdPNode", payload: selectPayload },
      n2: { nodeType: "SocialProviderHandlerNode", payload: handlerPayload },
    });
    const kids = await node.getChildren();
    const socialKids = kids.filter((k) => k instanceof SocialIdpNode);
    expect(socialKids).toHaveLength(2);
    const names = socialKids.map((k) => (k as InstanceType<typeof SocialIdpNode>).name).sort();
    expect(names).toEqual(["apple-oidc", "google-oidc"]);
  });
});
