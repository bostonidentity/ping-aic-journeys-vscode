import { describe, expect, it } from "vitest";
import {
  mapJourney,
  mapNodePayload,
  mapRealm,
  mapScript,
  type RawJourney,
  type RawNodePayload,
  type RawScript,
} from "@/paic/mappers";

describe("mapRealm", () => {
  it("extracts name/active/parentPath; defaults parentPath to '/'", () => {
    expect(
      mapRealm({
        _id: "uuid-1",
        name: "alpha",
        active: true,
        parentPath: "/",
        aliases: ["customers"],
      }),
    ).toEqual({ name: "alpha", active: true, parentPath: "/" });

    expect(mapRealm({ name: "beta", active: false } as never)).toEqual({
      name: "beta",
      active: false,
      parentPath: "/",
    });
  });
});

describe("mapJourney", () => {
  it("lifts nodes inline and defaults missing fields", () => {
    const raw: RawJourney = {
      _id: "Login",
      _rev: "abc",
      description: "Standard sign-in",
      enabled: true,
      identityResource: "managed/alpha_user",
      entryNodeId: "node-entry-uuid",
      nodes: {
        "node-1": {
          nodeType: "ScriptedDecisionNode",
          displayName: "Script:SetSessionAssurance",
          connections: { true: "node-2" },
          x: 100,
          y: 200,
        },
        "node-2": { nodeType: "SuccessNode" },
      },
    };
    const j = mapJourney(raw);
    expect(j.id).toBe("Login");
    expect(j.description).toBe("Standard sign-in");
    expect(j.enabled).toBe(true);
    expect(j.identityResource).toBe("managed/alpha_user");
    expect(j.entryNodeId).toBe("node-entry-uuid");
    expect(j.nodes["node-1"].nodeType).toBe("ScriptedDecisionNode");
    expect(j.nodes["node-1"].connections).toEqual({ true: "node-2" });
    expect(j.nodes["node-2"].connections).toEqual({});
  });

  it("defaults enabled to false when omitted", () => {
    const raw: RawJourney = { _id: "x", entryNodeId: "e" };
    expect(mapJourney(raw).enabled).toBe(false);
  });
});

describe("mapNodePayload", () => {
  it("extracts scriptId from a ScriptedDecisionNode payload", () => {
    const raw: RawNodePayload = {
      _id: "node-uuid",
      _type: { _id: "ScriptedDecisionNode" },
      script: "script-uuid-1",
      outcomes: ["true", "false"],
      inputs: ["*"],
      outputs: ["*"],
    };
    const p = mapNodePayload(raw);
    expect(p.nodeType).toBe("ScriptedDecisionNode");
    if (p.nodeType === "ScriptedDecisionNode") {
      expect(p.scriptId).toBe("script-uuid-1");
      expect(p.outcomes).toEqual(["true", "false"]);
      expect(p.inputs).toEqual(["*"]);
      expect(p.outputs).toEqual(["*"]);
    }
  });

  it("extracts tree name from an InnerTreeEvaluatorNode payload", () => {
    const raw: RawNodePayload = {
      _id: "node-uuid",
      _type: { _id: "InnerTreeEvaluatorNode" },
      tree: "PasswordReset",
    };
    const p = mapNodePayload(raw);
    expect(p.nodeType).toBe("InnerTreeEvaluatorNode");
    if (p.nodeType === "InnerTreeEvaluatorNode") {
      expect(p.tree).toBe("PasswordReset");
    }
  });

  it("falls through to OtherNodePayload for unknown node types, preserving raw + rawNodeType", () => {
    const raw: RawNodePayload = {
      _id: "n",
      _type: { _id: "PageNode" },
      // extra field that should land in raw
      stage: "something",
    };
    const p = mapNodePayload(raw);
    expect(p.nodeType).toBe("other");
    if (p.nodeType === "other") {
      expect(p.rawNodeType).toBe("PageNode");
      expect(p.raw.stage).toBe("something");
    }
  });
});

describe("mapScript", () => {
  it("decodes a base64-encoded body to UTF-8", () => {
    const source = "var x = 1;\nreturn x;";
    const b64 = Buffer.from(source, "utf8").toString("base64");
    const raw: RawScript = { _id: "s1", name: "MyScript", language: "JAVASCRIPT", script: b64 };
    expect(mapScript(raw)).toEqual({
      id: "s1",
      name: "MyScript",
      language: "JAVASCRIPT",
      body: source,
    });
  });

  it("returns empty body when script field is missing", () => {
    expect(mapScript({ _id: "s2", name: "Empty" }).body).toBe("");
  });

  it("defaults language to JAVASCRIPT when not provided", () => {
    expect(mapScript({ _id: "s3", name: "x" }).language).toBe("JAVASCRIPT");
  });
});
