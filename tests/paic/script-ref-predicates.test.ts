import { describe, expect, it } from "vitest";
import type { NodePayload } from "@/domain/types";
import { getScriptIdIfRef } from "@/paic/script-ref-predicates";

describe("getScriptIdIfRef", () => {
  it("returns the scriptId from a ScriptedDecisionNode payload", () => {
    const p: NodePayload = {
      id: "n",
      nodeType: "ScriptedDecisionNode",
      scriptId: "s-1",
      outcomes: [],
      inputs: [],
      outputs: [],
    };
    expect(getScriptIdIfRef(p)).toBe("s-1");
  });

  it("returns null when a ScriptedDecisionNode has an empty scriptId", () => {
    const p: NodePayload = {
      id: "n",
      nodeType: "ScriptedDecisionNode",
      scriptId: "",
      outcomes: [],
      inputs: [],
      outputs: [],
    };
    expect(getScriptIdIfRef(p)).toBeNull();
  });

  it("returns the scriptId for each always-script-bearing kind", () => {
    const cases: NodePayload[] = [
      { id: "a", nodeType: "ClientScriptNode", scriptId: "s-client" },
      { id: "b", nodeType: "ConfigProviderNode", scriptId: "s-config" },
      {
        id: "c",
        nodeType: "SocialProviderHandlerNode",
        scriptId: "s-social",
        filteredProviders: [],
      },
      {
        id: "d",
        nodeType: "SocialProviderHandlerNodeV2",
        scriptId: "s-social-v2",
        filteredProviders: [],
      },
    ];
    expect(cases.map(getScriptIdIfRef)).toEqual([
      "s-client",
      "s-config",
      "s-social",
      "s-social-v2",
    ]);
  });

  it("returns the scriptId when DeviceMatchNode.useScript is true", () => {
    const p: NodePayload = {
      id: "n",
      nodeType: "DeviceMatchNode",
      useScript: true,
      scriptId: "s-device",
    };
    expect(getScriptIdIfRef(p)).toBe("s-device");
  });

  it("returns null when DeviceMatchNode.useScript is false (even if scriptId is set)", () => {
    const p: NodePayload = {
      id: "n",
      nodeType: "DeviceMatchNode",
      useScript: false,
      scriptId: "stale-but-set",
    };
    expect(getScriptIdIfRef(p)).toBeNull();
  });

  it("returns the scriptId when PingOneVerifyCompletionDecisionNode.useFilterScript is true", () => {
    const p: NodePayload = {
      id: "n",
      nodeType: "PingOneVerifyCompletionDecisionNode",
      useFilterScript: true,
      scriptId: "s-pingone",
    };
    expect(getScriptIdIfRef(p)).toBe("s-pingone");
  });

  it("returns null when PingOneVerifyCompletionDecisionNode.useFilterScript is false", () => {
    const p: NodePayload = {
      id: "n",
      nodeType: "PingOneVerifyCompletionDecisionNode",
      useFilterScript: false,
      scriptId: "stale-but-set",
    };
    expect(getScriptIdIfRef(p)).toBeNull();
  });

  it("returns null for InnerTreeEvaluatorNode and `other` kinds", () => {
    const inner: NodePayload = { id: "n1", nodeType: "InnerTreeEvaluatorNode", tree: "X" };
    const other: NodePayload = { id: "n2", nodeType: "other", rawNodeType: "PageNode", raw: {} };
    expect(getScriptIdIfRef(inner)).toBeNull();
    expect(getScriptIdIfRef(other)).toBeNull();
  });
});
