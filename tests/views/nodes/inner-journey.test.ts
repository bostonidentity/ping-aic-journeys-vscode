import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../../util/vscode-mock")).makeVscodeMock());

import { describe, expect, it } from "vitest";
import type { Journey, NodePayload } from "@/domain/types";
import { MessageNode } from "@/views/nodes/base";
import { InnerJourneyNode } from "@/views/nodes/inner-journey";
import { ScriptNode } from "@/views/nodes/script";
import { makeFakeCache, makeFakeLogger, makeFakePaicClient } from "../fakes";

const HOST = "h.example.com";
const REALM = "alpha";

describe("InnerJourneyNode", () => {
  it("expands like a journey when not in visited list", async () => {
    const innerJourney: Journey = {
      id: "Inner",
      enabled: true,
      entryNodeId: "n1",
      nodes: { n1: { nodeType: "ScriptedDecisionNode", connections: {} } },
    };
    const payload: NodePayload = {
      id: "n1",
      nodeType: "ScriptedDecisionNode",
      scriptId: "s-inner",
      outcomes: [],
      inputs: [],
      outputs: [],
    };
    const client = makeFakePaicClient({
      journeyById: { Inner: innerJourney },
      nodesByKey: { [`${REALM}:ScriptedDecisionNode:n1`]: payload },
    });
    const node = new InnerJourneyNode(
      HOST,
      REALM,
      "Inner",
      makeFakeCache(client),
      makeFakeLogger(),
      ["Login"],
    );
    const kids = await node.getChildren();
    expect(kids).toHaveLength(1);
    expect(kids[0]).toBeInstanceOf(ScriptNode);
    expect((kids[0] as ScriptNode).scriptId).toBe("s-inner");
  });

  it("emits a cycle MessageNode when own id appears in the visited ancestor list", async () => {
    const client = makeFakePaicClient({}); // no fixtures needed — should short-circuit
    const node = new InnerJourneyNode(
      HOST,
      REALM,
      "PasswordReset",
      makeFakeCache(client),
      makeFakeLogger(),
      ["Login", "PasswordReset"],
    );
    const kids = await node.getChildren();
    expect(kids).toHaveLength(1);
    expect(kids[0]).toBeInstanceOf(MessageNode);
    expect(kids[0].label).toBe("[cycle: PasswordReset]");
    // getJourney was not called.
    expect((client.getJourney as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
