import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../../util/vscode-mock")).makeVscodeMock());

import { beforeEach, describe, expect, it } from "vitest";
import type * as vscode from "vscode";
import type { Connection, Journey } from "@/domain/types";
import type { PaicNode } from "@/views/nodes/base";
import { ConnectionNode } from "@/views/nodes/connection";
import { JourneyNode } from "@/views/nodes/journey";
import { ScriptNode } from "@/views/nodes/script";
import { InspectorPanel } from "@/webview/inspector/panel";
import { makeFakeCache, makeFakeLogger, makeFakePaicClient } from "../../views/fakes";

const CONN: Connection = { host: "h.example.com", saId: "sa-1" };

interface VscodeMockState {
  createWebviewPanel: ReturnType<typeof vi.fn>;
  createTreeView: ReturnType<typeof vi.fn>;
  createdPanels: Array<{
    webview: {
      postMessage: ReturnType<typeof vi.fn>;
      __fireReceive: (msg: unknown) => void;
    };
  }>;
}

async function getVscodeMockState(): Promise<VscodeMockState> {
  const mod = (await import("vscode")) as unknown as { __mockState: VscodeMockState };
  return mod.__mockState;
}

function makeMockContext() {
  return {
    extensionUri: { path: "/ext" },
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

function makeTreeView() {
  const reveal = vi.fn(() => Promise.resolve());
  return {
    treeView: { reveal } as unknown as vscode.TreeView<PaicNode>,
    revealFn: reveal,
  };
}

beforeEach(async () => {
  const state = await getVscodeMockState();
  state.createWebviewPanel.mockClear();
  state.createdPanels.length = 0;
});

describe("InspectorPanel", () => {
  it("creates the webview panel lazily on first show() and reuses it", async () => {
    const state = await getVscodeMockState();
    const fake = makeFakeCache(makeFakePaicClient({}));
    const log = makeFakeLogger();
    const { treeView } = makeTreeView();
    const panel = new InspectorPanel({
      context: makeMockContext(),
      cache: fake,
      log,
      treeView,
    });
    const node = new ConnectionNode(CONN, fake, log);

    await panel.show(node);
    expect(state.createWebviewPanel).toHaveBeenCalledTimes(1);

    await panel.show(node);
    expect(state.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("routes a connection node to a select message with the connection payload", async () => {
    const state = await getVscodeMockState();
    const fake = makeFakeCache(makeFakePaicClient({}));
    const log = makeFakeLogger();
    const { treeView } = makeTreeView();
    const panel = new InspectorPanel({
      context: makeMockContext(),
      cache: fake,
      log,
      treeView,
    });
    const node = new ConnectionNode(CONN, fake, log);

    await panel.show(node);

    const post = state.createdPanels[0].webview.postMessage;
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "select",
        payload: expect.objectContaining({ kind: "connection", connection: CONN }),
      }),
    );
  });

  it("fetches and posts journeyDeps when a journey node is selected", async () => {
    const state = await getVscodeMockState();
    const journey: Journey = {
      id: "Login",
      enabled: true,
      entryNodeId: "n1",
      nodes: { n1: { nodeType: "ScriptedDecisionNode", connections: {} } },
    };
    const client = makeFakePaicClient({
      nodesByKey: {
        "alpha:ScriptedDecisionNode:n1": {
          id: "n1",
          nodeType: "ScriptedDecisionNode",
          scriptId: "s-1",
          outcomes: [],
          inputs: [],
          outputs: [],
        },
      },
    });
    const cache = makeFakeCache(client);
    const log = makeFakeLogger();
    const { treeView } = makeTreeView();
    const panel = new InspectorPanel({
      context: makeMockContext(),
      cache,
      log,
      treeView,
    });
    const node = new JourneyNode("h.example.com", "alpha", journey, cache, log);

    await panel.show(node);

    const post = state.createdPanels[0].webview.postMessage;
    const calls = post.mock.calls.map((c: unknown[]) => c[0]);
    const depsMsg = calls.find(
      (
        m,
      ): m is {
        type: "journeyDeps";
        uid: string;
        scripts: unknown[];
        nodeIndex: Record<string, { kind: string; scriptId?: string; uid?: string }>;
      } => Boolean(m) && (m as { type?: unknown }).type === "journeyDeps",
    );
    expect(depsMsg).toBeDefined();
    expect(depsMsg?.scripts).toHaveLength(1);
    // The nodeIndex maps the original nodeId ("n1") to its discovered script.
    expect(depsMsg?.nodeIndex.n1?.kind).toBe("script");
    expect(depsMsg?.nodeIndex.n1?.scriptId).toBe("s-1");
    expect(depsMsg?.nodeIndex.n1?.uid).toBe("script:h.example.com:alpha:s-1");
  });

  it("journeyDeps uses the resolved script NAME (not the UUID) for the scripts deps list label + the nodeIndex entry", async () => {
    const state = await getVscodeMockState();
    const journey: Journey = {
      id: "Login",
      enabled: true,
      entryNodeId: "n1",
      nodes: { n1: { nodeType: "ScriptedDecisionNode", connections: {} } },
    };
    const client = makeFakePaicClient({
      nodesByKey: {
        "alpha:ScriptedDecisionNode:n1": {
          id: "n1",
          nodeType: "ScriptedDecisionNode",
          scriptId: "s-1",
          outcomes: [],
          inputs: [],
          outputs: [],
        },
      },
      scriptsByKey: {
        "alpha:s-1": { id: "s-1", name: "AuthHelper", language: "JAVASCRIPT", body: "" },
      },
    });
    const cache = makeFakeCache(client);
    const log = makeFakeLogger();
    const { treeView } = makeTreeView();
    const panel = new InspectorPanel({
      context: makeMockContext(),
      cache,
      log,
      treeView,
    });
    const node = new JourneyNode("h.example.com", "alpha", journey, cache, log);

    await panel.show(node);

    const post = state.createdPanels[0].webview.postMessage;
    const calls = post.mock.calls.map((c: unknown[]) => c[0]);
    const depsMsg = calls.find(
      (
        m,
      ): m is {
        type: "journeyDeps";
        scripts: Array<{ label: string; uid: string }>;
        nodeIndex: Record<string, { kind: string; scriptName?: string; scriptId?: string }>;
      } => Boolean(m) && (m as { type?: unknown }).type === "journeyDeps",
    );
    expect(depsMsg).toBeDefined();
    expect(depsMsg?.scripts[0].label).toBe("AuthHelper");
    expect(depsMsg?.nodeIndex.n1?.scriptName).toBe("AuthHelper");
    expect(depsMsg?.nodeIndex.n1?.scriptId).toBe("s-1");
  });

  it("on `navigate` message reveals the cached node in the tree view", async () => {
    const state = await getVscodeMockState();
    const fake = makeFakeCache(makeFakePaicClient({}));
    const log = makeFakeLogger();
    const { treeView, revealFn } = makeTreeView();
    const panel = new InspectorPanel({
      context: makeMockContext(),
      cache: fake,
      log,
      treeView,
    });
    const node = new ConnectionNode(CONN, fake, log);

    await panel.show(node);

    const mockPanel = state.createdPanels[0];
    mockPanel.webview.__fireReceive({ type: "navigate", uid: node.uid });

    // The reveal call is async; wait a microtask for it to land.
    await Promise.resolve();
    expect(revealFn).toHaveBeenCalledWith(node, expect.objectContaining({ select: true }));
  });

  it("ignores `navigate` for an unknown uid", async () => {
    const state = await getVscodeMockState();
    const fake = makeFakeCache(makeFakePaicClient({}));
    const log = makeFakeLogger();
    const { treeView, revealFn } = makeTreeView();
    const panel = new InspectorPanel({
      context: makeMockContext(),
      cache: fake,
      log,
      treeView,
    });
    const node = new ConnectionNode(CONN, fake, log);

    await panel.show(node);

    const mockPanel = state.createdPanels[0];
    mockPanel.webview.__fireReceive({ type: "navigate", uid: "script:unknown" });
    await Promise.resolve();
    expect(revealFn).not.toHaveBeenCalled();

    // Silence unused import — ScriptNode is referenced via the import to assert
    // the module compiles, but isn't directly used here.
    void ScriptNode;
  });

  it("show(scriptNode) posts a scriptDeps message derived from its expanded children", async () => {
    const state = await getVscodeMockState();
    const client = makeFakePaicClient({
      scriptsByKey: {
        "alpha:s-1": {
          id: "s-1",
          name: "Auth",
          language: "JAVASCRIPT",
          body: `require('helpers'); var x = "&{esv.PUBLIC_URL}";`,
        },
      },
      scriptsByName: {
        "alpha:byName:helpers": {
          id: "s-lib-h",
          name: "helpers",
          language: "JAVASCRIPT",
          body: "",
        },
      },
    });
    const cache = makeFakeCache(client);
    const log = makeFakeLogger();
    const { treeView } = makeTreeView();
    const panel = new InspectorPanel({
      context: makeMockContext(),
      cache,
      log,
      treeView,
    });
    const node = new ScriptNode("h.example.com", "alpha", "s-1", cache, log);

    await panel.show(node);

    const post = state.createdPanels[0].webview.postMessage;
    const calls = post.mock.calls.map((c: unknown[]) => c[0]);
    const depsMsg = calls.find(
      (
        m,
      ): m is {
        type: "scriptDeps";
        uid: string;
        libraryScripts: Array<{ uid: string; label: string; kind: string }>;
        esvs: Array<{ uid: string; label: string; kind: string }>;
      } => Boolean(m) && (m as { type?: unknown }).type === "scriptDeps",
    );
    expect(depsMsg).toBeDefined();
    expect(depsMsg?.libraryScripts.map((l) => l.label)).toEqual(["helpers"]);
    expect(depsMsg?.esvs.map((e) => e.label)).toEqual(["PUBLIC_URL"]);
  });

  it("journeyDeps carries themes / emailTemplates / socialIdps arrays from new payload kinds", async () => {
    const state = await getVscodeMockState();
    const journey: Journey = {
      id: "Login",
      enabled: true,
      entryNodeId: "n1",
      nodes: {
        n1: { nodeType: "PageNode", connections: {} },
        n2: { nodeType: "EmailSuspendNode", connections: {} },
        n3: { nodeType: "SocialProviderHandlerNode", connections: {} },
      },
    };
    const client = makeFakePaicClient({
      nodesByKey: {
        "alpha:PageNode:n1": {
          id: "n1",
          nodeType: "PageNode",
          themeId: "theme-1",
          childRefs: [],
        },
        "alpha:EmailSuspendNode:n2": {
          id: "n2",
          nodeType: "EmailSuspendNode",
          emailTemplateName: "Welcome",
        },
        "alpha:SocialProviderHandlerNode:n3": {
          id: "n3",
          nodeType: "SocialProviderHandlerNode",
          scriptId: "s-social",
          filteredProviders: ["google-oidc"],
        },
      },
    });
    const cache = makeFakeCache(client);
    const log = makeFakeLogger();
    const { treeView } = makeTreeView();
    const panel = new InspectorPanel({
      context: makeMockContext(),
      cache,
      log,
      treeView,
    });
    const node = new JourneyNode("h.example.com", "alpha", journey, cache, log);

    await panel.show(node);

    const post = state.createdPanels[0].webview.postMessage;
    const calls = post.mock.calls.map((c: unknown[]) => c[0]);
    const depsMsg = calls.find(
      (
        m,
      ): m is {
        type: "journeyDeps";
        themes: Array<{ label: string; kind: string }>;
        emailTemplates: Array<{ label: string; kind: string }>;
        socialIdps: Array<{ label: string; kind: string }>;
      } => Boolean(m) && (m as { type?: unknown }).type === "journeyDeps",
    );
    expect(depsMsg).toBeDefined();
    expect(depsMsg?.themes.map((t) => t.label)).toEqual(["theme-1"]);
    expect(depsMsg?.emailTemplates.map((e) => e.label)).toEqual(["Welcome"]);
    expect(depsMsg?.socialIdps.map((s) => s.label)).toEqual(["google-oidc"]);
  });

  it("nodeIndex carries the new typed fields per Slice 4 NodeInfo widening", async () => {
    const state = await getVscodeMockState();
    const journey: Journey = {
      id: "Login",
      enabled: true,
      entryNodeId: "p1",
      nodes: {
        p1: { nodeType: "PageNode", connections: {} },
        e1: { nodeType: "EmailSuspendNode", connections: {} },
        s1: { nodeType: "SocialProviderHandlerNode", connections: {} },
        i1: { nodeType: "SelectIdPNode", connections: {} },
        d1: { nodeType: "DeviceMatchNode", connections: {} },
      },
    };
    const client = makeFakePaicClient({
      nodesByKey: {
        "alpha:PageNode:p1": {
          id: "p1",
          nodeType: "PageNode",
          themeId: "theme-1",
          childRefs: [],
        },
        "alpha:EmailSuspendNode:e1": {
          id: "e1",
          nodeType: "EmailSuspendNode",
          emailTemplateName: "Welcome",
        },
        "alpha:SocialProviderHandlerNode:s1": {
          id: "s1",
          nodeType: "SocialProviderHandlerNode",
          scriptId: "s-social",
          filteredProviders: ["google-oidc"],
        },
        "alpha:SelectIdPNode:i1": {
          id: "i1",
          nodeType: "SelectIdPNode",
          filteredProviders: ["apple-oidc"],
        },
        "alpha:DeviceMatchNode:d1": {
          id: "d1",
          nodeType: "DeviceMatchNode",
          useScript: false,
        },
      },
    });
    const cache = makeFakeCache(client);
    const log = makeFakeLogger();
    const { treeView } = makeTreeView();
    const panel = new InspectorPanel({
      context: makeMockContext(),
      cache,
      log,
      treeView,
    });
    const node = new JourneyNode("h.example.com", "alpha", journey, cache, log);

    await panel.show(node);

    const post = state.createdPanels[0].webview.postMessage;
    const calls = post.mock.calls.map((c: unknown[]) => c[0]);
    const depsMsg = calls.find(
      (
        m,
      ): m is {
        type: "journeyDeps";
        nodeIndex: Record<
          string,
          {
            kind: string;
            uid?: string;
            scriptId?: string;
            themeId?: string;
            emailTemplateName?: string;
            socialIdpNames?: string[];
            useScript?: boolean;
            rawNodeType?: string;
          }
        >;
      } => Boolean(m) && (m as { type?: unknown }).type === "journeyDeps",
    );
    expect(depsMsg).toBeDefined();
    const idx = depsMsg!.nodeIndex;
    expect(idx.p1.kind).toBe("theme");
    expect(idx.p1.themeId).toBe("theme-1");
    expect(idx.p1.uid).toBe("theme:h.example.com:alpha:theme-1");
    expect(idx.e1.kind).toBe("emailTemplate");
    expect(idx.e1.emailTemplateName).toBe("Welcome");
    expect(idx.e1.uid).toBe("email-template:h.example.com:alpha:Welcome");
    // SocialProviderHandlerNode w/ scriptId → script wins for click; socialIdpNames decorate.
    expect(idx.s1.kind).toBe("script");
    expect(idx.s1.scriptId).toBe("s-social");
    expect(idx.s1.socialIdpNames).toEqual(["google-oidc"]);
    // SelectIdPNode → socialIdp; uid points to first IdP leaf.
    expect(idx.i1.kind).toBe("socialIdp");
    expect(idx.i1.socialIdpNames).toEqual(["apple-oidc"]);
    expect(idx.i1.uid).toBe("social-idp:h.example.com:alpha:apple-oidc");
    // DeviceMatchNode w/ useScript=false → other + useScript false propagates.
    expect(idx.d1.kind).toBe("other");
    expect(idx.d1.useScript).toBe(false);
  });
});
