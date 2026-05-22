import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../../util/vscode-mock")).makeVscodeMock());

import { beforeEach, describe, expect, it } from "vitest";
import type * as vscode from "vscode";
import type { RealmIndexEntity, RealmIndexEntry } from "@/domain/realm-index";
import { entityKeyOf } from "@/domain/realm-index";
import type { Realm } from "@/domain/types";
import type { BuildProgress, RealmIndexBuildDeps } from "@/realm-index/build";
import type { RealmIndexCache } from "@/realm-index/cache";
import { InspectorFactory } from "@/webview/inspector/panel";
import type { ConnectionInfo } from "@/webview/search/messages";
import { SearchFactory } from "@/webview/search/panel";
import {
  makeFakeCache,
  makeFakeLogger,
  makeFakePaicClient,
  makeFakeResolverCache,
} from "../../views/fakes";

interface VscodeMockState {
  createWebviewPanel: ReturnType<typeof vi.fn>;
  createdPanels: Array<{
    webview: {
      postMessage: ReturnType<typeof vi.fn>;
      __fireReceive: (msg: unknown) => void;
    };
    reveal: ReturnType<typeof vi.fn>;
    __fireDispose: () => void;
  }>;
}

async function getVscodeMockState(): Promise<VscodeMockState> {
  const mod = (await import("vscode")) as unknown as { __mockState: VscodeMockState };
  return mod.__mockState;
}

function makeMockContext(): vscode.ExtensionContext {
  return {
    extensionUri: { path: "/ext" },
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

function realm(name: string, isRoot = false): Realm {
  return { name, active: true, parentPath: "/", isRoot };
}

function makeFakeRealmIndexCache(
  data: Partial<{
    entry: RealmIndexEntry | null;
    buildResult: RealmIndexEntry;
    buildError: Error;
    /** Progress events the fake builder emits via `deps.onProgress`
     * before resolving — drives the `buildProgress` roundtrip test. */
    progressEvents: BuildProgress[];
  }> = {},
): { cache: RealmIndexCache; spies: Record<string, ReturnType<typeof vi.fn>> } {
  let stored = data.entry ?? null;
  const peek = vi.fn(() => stored);
  const build = vi.fn((_host: string, _realm: string, buildDeps: RealmIndexBuildDeps) => {
    for (const p of data.progressEvents ?? []) buildDeps.onProgress?.(p);
    if (data.buildError) return Promise.reject(data.buildError);
    stored = data.buildResult ?? null;
    if (!stored) return Promise.reject(new Error("no buildResult configured"));
    return Promise.resolve(stored);
  });
  const dropOne = vi.fn(() => {
    stored = null;
  });
  const dropAllForHost = vi.fn();
  const dispose = vi.fn();
  return {
    cache: { peek, build, dropOne, dropAllForHost, dispose },
    spies: { peek, build, dropOne, dropAllForHost, dispose },
  };
}

function makeInspectorFactory(): InspectorFactory {
  return new InspectorFactory({
    context: makeMockContext(),
    cache: makeFakeCache(makeFakePaicClient({})),
    resolverCache: makeFakeResolverCache(),
    log: makeFakeLogger(),
  });
}

function entity(kind: RealmIndexEntity["kind"], id: string, displayName: string): RealmIndexEntity {
  return { key: entityKeyOf(kind, id), kind, id, displayName };
}

function entryWith(
  host: string,
  realmName: string,
  entitiesArr: RealmIndexEntity[],
  inboundRefs: RealmIndexEntry["inboundRefs"] = {},
): RealmIndexEntry {
  const entities: Record<string, RealmIndexEntity> = {};
  const counts: Record<RealmIndexEntity["kind"], number> = {
    journey: 0,
    script: 0,
    esv: 0,
    theme: 0,
    emailTemplate: 0,
    socialIdp: 0,
  };
  for (const e of entitiesArr) {
    entities[e.key] = e;
    counts[e.kind]++;
  }
  return {
    host,
    realm: realmName,
    entities,
    inboundRefs,
    counts,
    builtAt: 1_700_000_000_000,
    scanDurationMs: 1234,
  };
}

const HOST = "h.example.com";
const REALM = "alpha";
const CONNECTIONS: ConnectionInfo[] = [{ host: HOST, name: "Sandbox" }];

interface FactoryBuild {
  factory: SearchFactory;
  realmIndexSpies: Record<string, ReturnType<typeof vi.fn>>;
  inspectorFactory: InspectorFactory;
}

function makeFactory(
  data: Parameters<typeof makeFakeRealmIndexCache>[0] = {},
  paicClientData: Parameters<typeof makeFakePaicClient>[0] = {},
): FactoryBuild {
  const { cache: realmIndexCache, spies: realmIndexSpies } = makeFakeRealmIndexCache(data);
  const inspectorFactory = makeInspectorFactory();
  const factory = new SearchFactory({
    context: makeMockContext(),
    cache: makeFakeCache(makeFakePaicClient(paicClientData)),
    realmIndexCache,
    inspectorFactory,
    listConnections: () => CONNECTIONS,
    log: makeFakeLogger(),
  });
  return { factory, realmIndexSpies, inspectorFactory };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(async () => {
  const state = await getVscodeMockState();
  state.createWebviewPanel.mockClear();
  state.createdPanels.length = 0;
});

describe("SearchFactory — singleton Search webview", () => {
  it("spawn() opens a Search webview panel", async () => {
    const state = await getVscodeMockState();
    const { factory } = makeFactory();
    factory.spawn();
    expect(state.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(state.createWebviewPanel.mock.calls[0][0]).toBe("paicJourneys.search");
  });

  it("spawn() twice reuses the singleton tab — second call reveals, no new panel", async () => {
    const state = await getVscodeMockState();
    const { factory } = makeFactory();
    factory.spawn();
    factory.spawn({ selectedHost: HOST });
    expect(state.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(state.createdPanels[0].reveal).toHaveBeenCalledTimes(1);
  });

  it("spawn() after the tab is disposed creates a fresh panel", async () => {
    const state = await getVscodeMockState();
    const { factory } = makeFactory();
    factory.spawn();
    state.createdPanels[0].__fireDispose();
    factory.spawn();
    expect(state.createWebviewPanel).toHaveBeenCalledTimes(2);
  });
});

describe("SearchTab onMessage roundtrips", () => {
  it("listRealms posts realmsResult with the non-root realms", async () => {
    const state = await getVscodeMockState();
    const { factory } = makeFactory(
      {},
      { realms: [realm("Top Level Realm", true), realm("alpha"), realm("beta")] },
    );
    factory.spawn();
    const panel = state.createdPanels[0];
    panel.webview.__fireReceive({ type: "listRealms", host: HOST });
    await flush();
    const last = panel.webview.postMessage.mock.calls.at(-1)?.[0] as {
      type: string;
      host: string;
      realms: string[];
    };
    expect(last.type).toBe("realmsResult");
    expect(last.host).toBe(HOST);
    expect(last.realms).toEqual(["alpha", "beta"]); // root realm filtered (D25)
  });

  it("peek with no entry posts peekResult with null status", async () => {
    const state = await getVscodeMockState();
    const { factory } = makeFactory({ entry: null });
    factory.spawn();
    const panel = state.createdPanels[0];
    panel.webview.__fireReceive({ type: "peek", host: HOST, realm: REALM });
    await flush();
    const last = panel.webview.postMessage.mock.calls.at(-1)?.[0];
    expect(last).toMatchObject({
      type: "peekResult",
      host: HOST,
      realm: REALM,
      status: { builtAt: null, counts: null },
    });
  });

  it("peek with a cached entry posts peekResult with counts", async () => {
    const state = await getVscodeMockState();
    const entry = entryWith(HOST, REALM, [entity("script", "s1", "validator")]);
    const { factory } = makeFactory({ entry });
    factory.spawn();
    const panel = state.createdPanels[0];
    panel.webview.__fireReceive({ type: "peek", host: HOST, realm: REALM });
    await flush();
    const last = panel.webview.postMessage.mock.calls.at(-1)?.[0];
    expect(last).toMatchObject({
      type: "peekResult",
      host: HOST,
      realm: REALM,
      status: { builtAt: entry.builtAt, counts: { script: 1 } },
    });
  });

  it("build calls realmIndexCache.build and posts buildStart + buildDone", async () => {
    const state = await getVscodeMockState();
    const entry = entryWith(HOST, REALM, [entity("script", "s1", "v")]);
    const { factory, realmIndexSpies } = makeFactory({ buildResult: entry });
    factory.spawn();
    const panel = state.createdPanels[0];
    panel.webview.__fireReceive({ type: "build", host: HOST, realm: REALM });
    await flush();
    expect(realmIndexSpies.build).toHaveBeenCalledTimes(1);
    const types = panel.webview.postMessage.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toContain("buildStart");
    expect(types).toContain("buildDone");
  });

  it("build error posts buildError with the rejection message", async () => {
    const state = await getVscodeMockState();
    const { factory } = makeFactory({ buildError: new Error("tenant 401") });
    factory.spawn();
    const panel = state.createdPanels[0];
    panel.webview.__fireReceive({ type: "build", host: HOST, realm: REALM });
    await flush();
    const last = panel.webview.postMessage.mock.calls.at(-1)?.[0];
    expect(last).toMatchObject({
      type: "buildError",
      host: HOST,
      realm: REALM,
      message: "tenant 401",
    });
  });

  it("build relays a buildProgress message from the builder's onProgress", async () => {
    const state = await getVscodeMockState();
    const entry = entryWith(HOST, REALM, [entity("script", "s1", "v")]);
    const { factory } = makeFactory({
      buildResult: entry,
      // A phase-change event (journeys) always flushes immediately.
      progressEvents: [{ phase: "journeys", done: 3, total: 10 }],
    });
    factory.spawn();
    const panel = state.createdPanels[0];
    panel.webview.__fireReceive({ type: "build", host: HOST, realm: REALM });
    await flush();
    const progress = panel.webview.postMessage.mock.calls
      .map((c) => c[0] as { type: string })
      .find((m) => m.type === "buildProgress");
    expect(progress).toMatchObject({
      type: "buildProgress",
      host: HOST,
      realm: REALM,
      phase: "journeys",
      done: 3,
      total: 10,
    });
  });

  it("rescan calls dropOne then build", async () => {
    const state = await getVscodeMockState();
    const entry = entryWith(HOST, REALM, [entity("script", "s1", "v")]);
    const { factory, realmIndexSpies } = makeFactory({ buildResult: entry });
    factory.spawn();
    const panel = state.createdPanels[0];
    panel.webview.__fireReceive({ type: "rescan", host: HOST, realm: REALM });
    await flush();
    expect(realmIndexSpies.dropOne).toHaveBeenCalledWith(HOST, REALM);
    expect(realmIndexSpies.build).toHaveBeenCalledTimes(1);
  });

  it("query findUsages posts queryResult with hydrated entities", async () => {
    const state = await getVscodeMockState();
    const fromJourney = entity("journey", "Login", "Login");
    const targetScript = entity("script", "s1", "validator");
    const entry = entryWith(HOST, REALM, [fromJourney, targetScript], {
      [targetScript.key]: [{ fromKey: fromJourney.key, via: "ScriptedDecisionNode" }],
    });
    const { factory } = makeFactory({ entry });
    factory.spawn();
    const panel = state.createdPanels[0];
    panel.webview.__fireReceive({
      type: "query",
      host: HOST,
      realm: REALM,
      mode: "findUsages",
      targetKey: targetScript.key,
    });
    await flush();
    const last = panel.webview.postMessage.mock.calls.at(-1)?.[0] as {
      type: string;
      refs: Array<{ ref: { via: string }; entity: RealmIndexEntity | null }>;
      paths: { roots: Array<{ entity: { id: string }; children: unknown[] }> };
    };
    expect(last.type).toBe("queryResult");
    expect(last.refs).toHaveLength(1);
    expect(last.refs[0].entity).toMatchObject({ id: "Login" });
    // The findUsages result also carries the journey → … → target tree.
    expect(last.paths.roots).toHaveLength(1);
    expect(last.paths.roots[0].entity.id).toBe("Login");
    expect(last.paths.roots[0].children).toHaveLength(1);
  });

  it("query byName posts queryResult with the matches", async () => {
    const state = await getVscodeMockState();
    const entry = entryWith(HOST, REALM, [
      entity("script", "s1", "validator"),
      entity("script", "s2", "helpers"),
    ]);
    const { factory } = makeFactory({ entry });
    factory.spawn();
    const panel = state.createdPanels[0];
    panel.webview.__fireReceive({
      type: "query",
      host: HOST,
      realm: REALM,
      mode: "byName",
      pattern: "valid",
      kinds: ["script"],
    });
    await flush();
    const last = panel.webview.postMessage.mock.calls.at(-1)?.[0] as {
      results: RealmIndexEntity[];
    };
    expect(last.results.map((e) => e.id)).toEqual(["s1"]);
  });

  it("query unused posts queryResult with orphans", async () => {
    const state = await getVscodeMockState();
    const orphan = entity("script", "s-orphan", "orphan");
    const used = entity("script", "s-used", "used");
    const entry = entryWith(HOST, REALM, [orphan, used], {
      [used.key]: [{ fromKey: entityKeyOf("journey", "Login"), via: "ScriptedDecisionNode" }],
    });
    const { factory } = makeFactory({ entry });
    factory.spawn();
    const panel = state.createdPanels[0];
    panel.webview.__fireReceive({
      type: "query",
      host: HOST,
      realm: REALM,
      mode: "unused",
      kinds: ["script"],
    });
    await flush();
    const last = panel.webview.postMessage.mock.calls.at(-1)?.[0] as {
      results: RealmIndexEntity[];
    };
    expect(last.results.map((e) => e.id)).toEqual(["s-orphan"]);
  });

  it("query when no entry exists posts queryError", async () => {
    const state = await getVscodeMockState();
    const { factory } = makeFactory({ entry: null });
    factory.spawn();
    const panel = state.createdPanels[0];
    panel.webview.__fireReceive({
      type: "query",
      host: HOST,
      realm: REALM,
      mode: "byName",
      pattern: "x",
      kinds: ["script"],
    });
    await flush();
    const last = panel.webview.postMessage.mock.calls.at(-1)?.[0];
    expect(last).toMatchObject({
      type: "queryError",
      message: expect.stringContaining("not built"),
    });
  });

  it("listEntities posts grouped entities from the cached entry", async () => {
    const state = await getVscodeMockState();
    const entry = entryWith(HOST, REALM, [
      entity("script", "s1", "alpha"),
      entity("script", "s2", "bravo"),
      entity("theme", "t1", "default"),
    ]);
    const { factory } = makeFactory({ entry });
    factory.spawn();
    const panel = state.createdPanels[0];
    panel.webview.__fireReceive({ type: "listEntities", host: HOST, realm: REALM });
    await flush();
    const last = panel.webview.postMessage.mock.calls.at(-1)?.[0] as {
      type: string;
      entitiesByKind: Record<string, RealmIndexEntity[]>;
    };
    expect(last.type).toBe("listEntitiesResult");
    expect(last.entitiesByKind.script.map((e) => e.id)).toEqual(["s1", "s2"]);
    expect(last.entitiesByKind.theme.map((e) => e.id)).toEqual(["t1"]);
  });

  it("previewByKey delegates to inspectorFactory.spawnByDescriptor", async () => {
    const state = await getVscodeMockState();
    const { factory, inspectorFactory } = makeFactory();
    const spawnByDescriptor = vi.spyOn(inspectorFactory, "spawnByDescriptor");
    factory.spawn();
    const panel = state.createdPanels[0];
    panel.webview.__fireReceive({
      type: "previewByKey",
      host: HOST,
      realm: REALM,
      kind: "script",
      id: "s1",
      displayName: "validator",
    });
    await flush();
    expect(spawnByDescriptor).toHaveBeenCalledWith(HOST, REALM, {
      kind: "script",
      id: "s1",
      displayName: "validator",
    });
  });
});
