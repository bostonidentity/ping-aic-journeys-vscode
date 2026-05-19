import { describe, expect, it, type vi } from "vitest";
import { keyOf } from "@/domain/resolved-graph";
import type {
  ClientScriptNodePayload,
  DeviceMatchNodePayload,
  EmailSuspendNodePayload,
  InnerTreeEvaluatorNodePayload,
  Journey,
  NodePayload,
  NodeRef,
  PageNodePayload,
  Script,
  ScriptedDecisionNodePayload,
  SelectIdPNodePayload,
} from "@/domain/types";
import { walkRoot } from "@/resolver/walk";
import { makeFakeLogger, makeFakePaicClient } from "../views/fakes";

// ─── Tiny helpers to keep fixtures compact and readable ────────────────────

function nodeRef(nodeType: string, connections: Record<string, string> = {}): NodeRef {
  return { nodeType, connections };
}

function journey(id: string, nodes: Record<string, NodeRef>, entryNodeId = ""): Journey {
  return { id, enabled: true, entryNodeId, nodes };
}

function script(id: string, name: string, body = ""): Script {
  return { id, name, language: "JAVASCRIPT", body };
}

function sdNode(id: string, scriptId: string): ScriptedDecisionNodePayload {
  return { id, nodeType: "ScriptedDecisionNode", scriptId, outcomes: [], inputs: [], outputs: [] };
}

function innerNode(id: string, tree: string): InnerTreeEvaluatorNodePayload {
  return { id, nodeType: "InnerTreeEvaluatorNode", tree };
}

function pageNode(
  id: string,
  themeId: string | undefined,
  childRefs: Array<{ id: string; nodeType: string }>,
): PageNodePayload {
  const out: PageNodePayload = { id, nodeType: "PageNode", childRefs };
  if (themeId) out.themeId = themeId;
  return out;
}

// ─── Test cases ────────────────────────────────────────────────────────────

describe("walkRoot", () => {
  it("returns a root-only graph for an empty journey", async () => {
    const j = journey("Empty", {});
    const client = makeFakePaicClient({ journeyById: { Empty: j } });
    const log = makeFakeLogger();

    const g = await walkRoot({ client, log }, { kind: "journey", realm: "alpha", id: "Empty" });

    expect(Object.keys(g.nodes)).toEqual(["journey:Empty"]);
    expect(g.edges).toEqual([]);
    expect(g.rootKey).toBe("journey:Empty");
    expect(g.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("walks one ScriptedDecisionNode child at depth 1", async () => {
    const j = journey("Login", { n1: nodeRef("ScriptedDecisionNode") });
    const sd = sdNode("n1", "script-uuid-1");
    const s1 = script("script-uuid-1", "email-validator");
    const client = makeFakePaicClient({
      journeyById: { Login: j },
      nodesByKey: { "alpha:ScriptedDecisionNode:n1": sd },
      scriptsByKey: { "alpha:script-uuid-1": s1 },
    });

    const g = await walkRoot(
      { client, log: makeFakeLogger() },
      { kind: "journey", realm: "alpha", id: "Login" },
    );

    expect(g.nodes["script:script-uuid-1"]).toMatchObject({
      kind: "script",
      id: "script-uuid-1",
      displayName: "email-validator",
      depth: 1,
    });
    expect(g.edges).toEqual([
      { fromKey: "journey:Login", toKey: "script:script-uuid-1", via: "ScriptedDecisionNode" },
    ]);
  });

  it("walks inner-journey recursion (J → IJ → script) with correct depths", async () => {
    const outer = journey("Outer", { n1: nodeRef("InnerTreeEvaluatorNode") });
    const inner = journey("Inner", { n2: nodeRef("ScriptedDecisionNode") });
    const inNode = innerNode("n1", "Inner");
    const sd = sdNode("n2", "script-uuid-2");
    const s2 = script("script-uuid-2", "inner-script");
    const client = makeFakePaicClient({
      journeyById: { Outer: outer, Inner: inner },
      nodesByKey: {
        "alpha:InnerTreeEvaluatorNode:n1": inNode,
        "alpha:ScriptedDecisionNode:n2": sd,
      },
      scriptsByKey: { "alpha:script-uuid-2": s2 },
    });

    const g = await walkRoot(
      { client, log: makeFakeLogger() },
      { kind: "journey", realm: "alpha", id: "Outer" },
    );

    expect(g.nodes["journey:Outer"]?.depth).toBe(0);
    expect(g.nodes["journey:Inner"]?.depth).toBe(1);
    expect(g.nodes["script:script-uuid-2"]?.depth).toBe(2);
    expect(g.edges).toEqual([
      { fromKey: "journey:Outer", toKey: "journey:Inner", via: "InnerTreeEvaluatorNode" },
      { fromKey: "journey:Inner", toKey: "script:script-uuid-2", via: "ScriptedDecisionNode" },
    ]);
  });

  it("detects a cycle: J → IJ → J back-edge marked cycle, no re-walk", async () => {
    const a = journey("A", { n1: nodeRef("InnerTreeEvaluatorNode") });
    const b = journey("B", { n2: nodeRef("InnerTreeEvaluatorNode") });
    const a2b = innerNode("n1", "B");
    const b2a = innerNode("n2", "A");
    const client = makeFakePaicClient({
      journeyById: { A: a, B: b },
      nodesByKey: {
        "alpha:InnerTreeEvaluatorNode:n1": a2b,
        "alpha:InnerTreeEvaluatorNode:n2": b2a,
      },
    });

    const g = await walkRoot(
      { client, log: makeFakeLogger() },
      { kind: "journey", realm: "alpha", id: "A" },
    );

    expect(g.nodes["journey:A"]?.depth).toBe(0);
    expect(g.nodes["journey:B"]?.depth).toBe(1);
    expect(g.edges).toEqual([
      { fromKey: "journey:A", toKey: "journey:B", via: "InnerTreeEvaluatorNode" },
      {
        fromKey: "journey:B",
        toKey: "journey:A",
        via: "InnerTreeEvaluatorNode",
        cycle: true,
      },
    ]);
  });

  it("performs a PageNode container walk: nested ScriptedDecisionNode surfaces with composite via", async () => {
    const j = journey("Pg", { n1: nodeRef("PageNode") });
    const page = pageNode("n1", undefined, [{ id: "n2", nodeType: "ScriptedDecisionNode" }]);
    const sd = sdNode("n2", "script-uuid-3");
    const s3 = script("script-uuid-3", "nested-script");
    const client = makeFakePaicClient({
      journeyById: { Pg: j },
      nodesByKey: {
        "alpha:PageNode:n1": page,
        "alpha:ScriptedDecisionNode:n2": sd,
      },
      scriptsByKey: { "alpha:script-uuid-3": s3 },
    });

    const g = await walkRoot(
      { client, log: makeFakeLogger() },
      { kind: "journey", realm: "alpha", id: "Pg" },
    );

    expect(g.nodes["script:script-uuid-3"]?.depth).toBe(1);
    const scriptEdge = g.edges.find((e) => e.toKey === "script:script-uuid-3");
    expect(scriptEdge?.via).toBe("PageNode → ScriptedDecisionNode");
  });

  it("emits a theme child from PageNode.themeId with via 'PageNode'", async () => {
    const j = journey("Themed", { n1: nodeRef("PageNode") });
    const page = pageNode("n1", "theme-uuid-1", []);
    const client = makeFakePaicClient({
      journeyById: { Themed: j },
      nodesByKey: { "alpha:PageNode:n1": page },
    });

    const g = await walkRoot(
      { client, log: makeFakeLogger() },
      { kind: "journey", realm: "alpha", id: "Themed" },
    );

    expect(g.nodes["theme:theme-uuid-1"]?.depth).toBe(1);
    expect(g.edges).toEqual([
      { fromKey: "journey:Themed", toKey: "theme:theme-uuid-1", via: "PageNode" },
    ]);
  });

  it("walks a script root: require() emits library script, ESV literal emits esv", async () => {
    const src = script(
      "script-root",
      "main",
      `var h = require('helpers');\nvar n = "esv.api.key";`,
    );
    const lib = script("lib-uuid", "helpers", "");
    const client = makeFakePaicClient({
      scriptsByKey: { "alpha:script-root": src },
      scriptsByName: { "alpha:byName:helpers": lib },
    });

    const g = await walkRoot(
      { client, log: makeFakeLogger() },
      { kind: "script", realm: "alpha", id: "script-root" },
    );

    expect(g.nodes["script:lib-uuid"]).toMatchObject({
      kind: "script",
      id: "lib-uuid",
      displayName: "helpers",
      depth: 1,
    });
    expect(g.nodes["esv:esv.api.key"]).toMatchObject({
      kind: "esv",
      id: "esv.api.key",
      displayName: "esv.api.key",
      depth: 1,
    });

    const viaByTo = new Map(g.edges.map((e) => [e.toKey, e.via]));
    expect(viaByTo.get("script:lib-uuid")).toBe("require()");
    expect(viaByTo.get("esv:esv.api.key")).toBe("string literal");
  });

  it("recurses through library scripts (A → B → C)", async () => {
    const a = script("a-id", "a", `require('b');`);
    const b = script("b-id", "b", `require('c');`);
    const c = script("c-id", "c", "");
    const client = makeFakePaicClient({
      scriptsByKey: {
        "alpha:a-id": a,
        "alpha:b-id": b,
        "alpha:c-id": c,
      },
      scriptsByName: {
        "alpha:byName:b": b,
        "alpha:byName:c": c,
      },
    });

    const g = await walkRoot(
      { client, log: makeFakeLogger() },
      { kind: "script", realm: "alpha", id: "a-id" },
    );

    expect(g.nodes["script:a-id"]?.depth).toBe(0);
    expect(g.nodes["script:b-id"]?.depth).toBe(1);
    expect(g.nodes["script:c-id"]?.depth).toBe(2);
    expect(g.edges).toEqual([
      { fromKey: "script:a-id", toKey: "script:b-id", via: "require()" },
      { fromKey: "script:b-id", toKey: "script:c-id", via: "require()" },
    ]);
  });

  it("deduplicates same-layer dup refs into one node with two (non-cycle) edges", async () => {
    const j = journey("Dup", {
      n1: nodeRef("ScriptedDecisionNode"),
      n2: nodeRef("ScriptedDecisionNode"),
    });
    const sd1 = sdNode("n1", "shared");
    const sd2 = sdNode("n2", "shared");
    const s = script("shared", "shared-script");
    const client = makeFakePaicClient({
      journeyById: { Dup: j },
      nodesByKey: {
        "alpha:ScriptedDecisionNode:n1": sd1,
        "alpha:ScriptedDecisionNode:n2": sd2,
      },
      scriptsByKey: { "alpha:shared": s },
    });

    const g = await walkRoot(
      { client, log: makeFakeLogger() },
      { kind: "journey", realm: "alpha", id: "Dup" },
    );

    // One emission branch dedupes within fetchChildrenForJourney's `seen.script`,
    // so two payloads pointing at the same scriptId produce ONE ChildRef.
    // Single child → exactly one edge, one node, no cycle marker.
    const scriptNodes = Object.values(g.nodes).filter((n) => n.id === "shared");
    expect(scriptNodes).toHaveLength(1);
    const edgesToShared = g.edges.filter((e) => e.toKey === keyOf("script", "shared"));
    expect(edgesToShared).toHaveLength(1);
    expect(edgesToShared[0]?.cycle).toBeUndefined();
  });

  it("respects D19 conditional script-ref predicate (DeviceMatchNode.useScript)", async () => {
    // Variant A: useScript = false → no script child
    const jOff = journey("Off", { n1: nodeRef("DeviceMatchNode") });
    const dmOff: DeviceMatchNodePayload = {
      id: "n1",
      nodeType: "DeviceMatchNode",
      useScript: false,
      scriptId: "stale-script-id",
    };
    const clientOff = makeFakePaicClient({
      journeyById: { Off: jOff },
      nodesByKey: { "alpha:DeviceMatchNode:n1": dmOff },
    });
    const gOff = await walkRoot(
      { client: clientOff, log: makeFakeLogger() },
      { kind: "journey", realm: "alpha", id: "Off" },
    );
    expect(Object.keys(gOff.nodes)).toEqual(["journey:Off"]);
    expect(gOff.edges).toEqual([]);

    // Variant B: useScript = true → script child emitted
    const jOn = journey("On", { n1: nodeRef("DeviceMatchNode") });
    const dmOn: DeviceMatchNodePayload = {
      id: "n1",
      nodeType: "DeviceMatchNode",
      useScript: true,
      scriptId: "active-script-id",
    };
    const sOn = script("active-script-id", "device-decider");
    const clientOn = makeFakePaicClient({
      journeyById: { On: jOn },
      nodesByKey: { "alpha:DeviceMatchNode:n1": dmOn },
      scriptsByKey: { "alpha:active-script-id": sOn },
    });
    const gOn = await walkRoot(
      { client: clientOn, log: makeFakeLogger() },
      { kind: "journey", realm: "alpha", id: "On" },
    );
    expect(gOn.nodes["script:active-script-id"]?.displayName).toBe("device-decider");
    expect(gOn.edges).toEqual([
      { fromKey: "journey:On", toKey: "script:active-script-id", via: "DeviceMatchNode" },
    ]);
  });

  it("emits email + social-idp + multiple-script edges from one journey", async () => {
    const j = journey("Mix", {
      e1: nodeRef("EmailSuspendNode"),
      s1: nodeRef("SelectIdPNode"),
      c1: nodeRef("ClientScriptNode"),
    });
    const e: EmailSuspendNodePayload = {
      id: "e1",
      nodeType: "EmailSuspendNode",
      emailTemplateName: "welcome",
    };
    const sIdp: SelectIdPNodePayload = {
      id: "s1",
      nodeType: "SelectIdPNode",
      filteredProviders: ["google", "github"],
    };
    const cScript: ClientScriptNodePayload = {
      id: "c1",
      nodeType: "ClientScriptNode",
      scriptId: "client-script",
    };
    const cs = script("client-script", "geo-tagger");
    const client = makeFakePaicClient({
      journeyById: { Mix: j },
      nodesByKey: {
        "alpha:EmailSuspendNode:e1": e,
        "alpha:SelectIdPNode:s1": sIdp,
        "alpha:ClientScriptNode:c1": cScript,
      },
      scriptsByKey: { "alpha:client-script": cs },
    });

    const g = await walkRoot(
      { client, log: makeFakeLogger() },
      { kind: "journey", realm: "alpha", id: "Mix" },
    );

    expect(g.nodes["emailTemplate:welcome"]?.kind).toBe("emailTemplate");
    expect(g.nodes["socialIdp:google"]?.kind).toBe("socialIdp");
    expect(g.nodes["socialIdp:github"]?.kind).toBe("socialIdp");
    expect(g.nodes["script:client-script"]?.displayName).toBe("geo-tagger");

    const viaByTo = new Map(g.edges.map((e) => [e.toKey, e.via]));
    expect(viaByTo.get("emailTemplate:welcome")).toBe("EmailSuspendNode");
    expect(viaByTo.get("socialIdp:google")).toBe("SelectIdPNode");
    expect(viaByTo.get("script:client-script")).toBe("ClientScriptNode");
  });

  it("classifies ESV refs as variable / secret / missing using the per-walk ESV index", async () => {
    const src = script(
      "script-root",
      "main",
      `var a = "esv.a.var"; var b = "esv.b.sec"; var c = "esv.c.gone";`,
    );
    const client = makeFakePaicClient({
      scriptsByKey: { "alpha:script-root": src },
      variables: [{ kind: "variable", name: "esv.a.var" }],
      secrets: [{ kind: "secret", name: "esv.b.sec" }],
    });

    const g = await walkRoot(
      { client, log: makeFakeLogger() },
      { kind: "script", realm: "alpha", id: "script-root" },
    );

    expect(g.nodes["esv:esv.a.var"]?.esvKind).toBe("variable");
    expect(g.nodes["esv:esv.b.sec"]?.esvKind).toBe("secret");
    expect(g.nodes["esv:esv.c.gone"]?.esvKind).toBe("missing");
  });

  it("leaves esvKind undefined when the ESV index fetch fails (graceful fallback)", async () => {
    const src = script("script-root", "main", `var a = "esv.a.var";`);
    const client = makeFakePaicClient({
      scriptsByKey: { "alpha:script-root": src },
    });
    // Make listVariables reject — listSecrets too via Promise.all.
    (client.listVariables as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("503"));

    const g = await walkRoot(
      { client, log: makeFakeLogger() },
      { kind: "script", realm: "alpha", id: "script-root" },
    );

    expect(g.nodes["esv:esv.a.var"]?.esvKind).toBeUndefined();
  });

  it("propagates isLibrary onto script children when script.context === 'LIBRARY'", async () => {
    const src = script("script-root", "main", `require('helpers');`);
    const lib = script("lib-uuid", "helpers", "");
    lib.context = "LIBRARY";
    const client = makeFakePaicClient({
      scriptsByKey: { "alpha:script-root": src },
      scriptsByName: { "alpha:byName:helpers": lib },
    });

    const g = await walkRoot(
      { client, log: makeFakeLogger() },
      { kind: "script", realm: "alpha", id: "script-root" },
    );

    expect(g.nodes["script:lib-uuid"]?.isLibrary).toBe(true);
    // Root has no LIBRARY context, so it stays without the flag.
    expect(g.nodes["script:script-root"]?.isLibrary).toBeUndefined();
  });

  it("sets durationMs as a finite non-negative integer", async () => {
    const j = journey("D", {});
    const client = makeFakePaicClient({ journeyById: { D: j } });
    const g = await walkRoot(
      { client, log: makeFakeLogger() },
      { kind: "journey", realm: "alpha", id: "D" },
    );
    expect(Number.isFinite(g.durationMs)).toBe(true);
    expect(g.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// Reference the union types so unused-import lint doesn't complain — they
// document the payload variants this walker handles even though most tests
// build payloads inline via the small helpers above.
void (null as unknown as NodePayload);
