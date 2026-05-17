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
});
