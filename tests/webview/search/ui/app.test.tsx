// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CacheStatus, SearchPayload, W2E } from "@/webview/search/messages";
import { App } from "@/webview/search/ui/App";

const HOST = "h.example.com";
const REALM = "alpha";

function payload(over: Partial<SearchPayload> = {}): SearchPayload {
  return {
    connections: [{ host: HOST, name: "Sandbox" }],
    selectedHost: null,
    selectedRealm: null,
    prefill: null,
    ...over,
  };
}

function makeVscode() {
  const posts: W2E[] = [];
  return {
    posts,
    vscode: { postMessage: (m: W2E) => posts.push(m) },
  };
}

function emptyCache(): CacheStatus {
  return { builtAt: null, scanDurationMs: null, counts: null };
}

function populatedCache(): CacheStatus {
  return {
    builtAt: 1_700_000_000_000,
    scanDurationMs: 1234,
    counts: { journey: 2, script: 5, esv: 3, theme: 1, emailTemplate: 0, socialIdp: 0 },
  };
}

function dispatch(data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });
}

describe("Search App — scope selection", () => {
  it("posts `ready` on mount", () => {
    const { vscode, posts } = makeVscode();
    render(<App vscode={vscode} payload={payload()} />);
    expect(posts.some((p) => p.type === "ready")).toBe(true);
  });

  it("with no selection shows a hint and no Build button", () => {
    const { vscode } = makeVscode();
    render(<App vscode={vscode} payload={payload()} />);
    expect(screen.getByText(/Pick a connection and realm/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Build index/i })).toBeNull();
  });

  it("with no connections configured shows the no-connections hint", () => {
    const { vscode } = makeVscode();
    render(<App vscode={vscode} payload={payload({ connections: [] })} />);
    expect(screen.getByText(/No connections configured/i)).toBeTruthy();
  });

  it("selecting a connection in the dropdown posts listRealms", () => {
    const { vscode, posts } = makeVscode();
    render(<App vscode={vscode} payload={payload()} />);
    fireEvent.change(screen.getByLabelText(/Connection/i), { target: { value: HOST } });
    const listRealms = posts.find((p) => p.type === "listRealms");
    expect(listRealms).toMatchObject({ type: "listRealms", host: HOST });
  });

  it("a pre-selected host+realm payload posts listRealms + peek on mount", () => {
    const { vscode, posts } = makeVscode();
    render(<App vscode={vscode} payload={payload({ selectedHost: HOST, selectedRealm: REALM })} />);
    expect(posts.find((p) => p.type === "listRealms")).toMatchObject({ host: HOST });
    expect(posts.find((p) => p.type === "peek")).toMatchObject({
      type: "peek",
      host: HOST,
      realm: REALM,
    });
  });

  it("realmsResult populates the realm dropdown options", () => {
    const { vscode } = makeVscode();
    render(<App vscode={vscode} payload={payload({ selectedHost: HOST })} />);
    dispatch({ type: "realmsResult", host: HOST, realms: ["alpha", "beta"] });
    const realmSelect = screen.getByLabelText(/Realm/i) as HTMLSelectElement;
    const opts = [...realmSelect.options].map((o) => o.value);
    expect(opts).toContain("alpha");
    expect(opts).toContain("beta");
  });
});

describe("Search App — query flow once scope is set", () => {
  function renderScoped() {
    const made = makeVscode();
    render(
      <App vscode={made.vscode} payload={payload({ selectedHost: HOST, selectedRealm: REALM })} />,
    );
    return made;
  }

  it("peekResult 'Not built' shows the Build button; clicking posts build with host+realm", () => {
    const { posts } = renderScoped();
    dispatch({ type: "peekResult", host: HOST, realm: REALM, status: emptyCache() });
    fireEvent.click(screen.getByRole("button", { name: /Build index/i }));
    expect(posts.find((p) => p.type === "build")).toMatchObject({
      type: "build",
      host: HOST,
      realm: REALM,
    });
  });

  it("buildDone updates the header counts", () => {
    renderScoped();
    dispatch({ type: "buildDone", host: HOST, realm: REALM, status: populatedCache() });
    expect(screen.getByText(/5 scripts/i)).toBeTruthy();
  });

  it("shows a progress bar with phase label + percentage during build", () => {
    renderScoped();
    dispatch({ type: "buildStart", host: HOST, realm: REALM });
    dispatch({
      type: "buildProgress",
      host: HOST,
      realm: REALM,
      phase: "journeys",
      done: 50,
      total: 100,
    });
    // Label is the determinate journey count; pct = round(5 + 73·0.5) = 42.
    expect(screen.getByText("Scanning journeys — 50 / 100")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
  });

  it("the scripts phase advances the bar too (determinate done/total)", () => {
    renderScoped();
    dispatch({ type: "buildStart", host: HOST, realm: REALM });
    // Scripts phase, half-scanned → pct = round(78 + 20·0.5) = 88.
    dispatch({
      type: "buildProgress",
      host: HOST,
      realm: REALM,
      phase: "scripts",
      done: 100,
      total: 200,
    });
    // Unified `X / Y` label, same shape as the journey phase.
    expect(screen.getByText("Resolving scripts — 100 / 200")).toBeTruthy();
    expect(screen.getByText("88%")).toBeTruthy();
  });

  it("clamps the bar monotonically when the script total grows", () => {
    renderScoped();
    dispatch({ type: "buildStart", host: HOST, realm: REALM });
    // Layer 1 finishes: 200 / 200 → 98%.
    dispatch({
      type: "buildProgress",
      host: HOST,
      realm: REALM,
      phase: "scripts",
      done: 200,
      total: 200,
    });
    expect(screen.getByText("98%")).toBeTruthy();
    // Layer 2 surfaces 20 more library scripts → total grows to 220, done
    // still 200. Raw pct would dip to ~96%; the clamp holds it at 98%.
    dispatch({
      type: "buildProgress",
      host: HOST,
      realm: REALM,
      phase: "scripts",
      done: 200,
      total: 220,
    });
    expect(screen.getByText("98%")).toBeTruthy();
    expect(screen.getByText("Resolving scripts — 200 / 220")).toBeTruthy();
  });

  it("By name query posts query with host+realm; result-row click posts previewByKey", () => {
    const { posts } = renderScoped();
    dispatch({ type: "peekResult", host: HOST, realm: REALM, status: populatedCache() });
    fireEvent.click(screen.getByRole("radio", { name: /By name/i }));
    fireEvent.change(screen.getByLabelText(/Pattern/i), { target: { value: "Login" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));
    const query = posts.find(
      (p): p is Extract<W2E, { type: "query"; mode: "byName" }> =>
        p.type === "query" && (p as { mode?: string }).mode === "byName",
    );
    expect(query).toMatchObject({ host: HOST, realm: REALM, pattern: "Login" });

    dispatch({
      type: "queryResult",
      host: HOST,
      realm: REALM,
      mode: "byName",
      results: [{ key: "script:s1", kind: "script", id: "s1", displayName: "validator" }],
    });
    fireEvent.click(screen.getByRole("button", { name: /validator/i }));
    expect(posts.find((p) => p.type === "previewByKey")).toMatchObject({
      type: "previewByKey",
      host: HOST,
      realm: REALM,
      id: "s1",
    });
  });

  it("drops a stale result whose (host, realm) differs from the current scope", () => {
    renderScoped();
    // A buildDone for a DIFFERENT realm must not update the header.
    dispatch({ type: "buildDone", host: HOST, realm: "beta", status: populatedCache() });
    expect(screen.queryByText(/5 scripts/i)).toBeNull();
    expect(screen.getByText(/Not built/i)).toBeTruthy();
  });

  it("By-name results render kind-grouped `── Kind (N) ──` dividers", () => {
    renderScoped();
    dispatch({ type: "peekResult", host: HOST, realm: REALM, status: populatedCache() });
    dispatch({
      type: "queryResult",
      host: HOST,
      realm: REALM,
      mode: "byName",
      results: [
        { key: "script:s1", kind: "script", id: "s1", displayName: "validator" },
        { key: "theme:t1", kind: "theme", id: "t1", displayName: "corporate" },
      ],
    });
    expect(screen.getByText(/Scripts \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Themes \(1\)/)).toBeTruthy();
  });

  it("Find-usages results show a List | Tree toggle, defaulting to List", () => {
    renderScoped();
    dispatch({ type: "peekResult", host: HOST, realm: REALM, status: populatedCache() });
    dispatch(findUsagesResult());
    const list = screen.getByRole("radio", { name: "List" });
    const tree = screen.getByRole("radio", { name: "Tree" });
    expect(list.getAttribute("aria-checked")).toBe("true");
    expect(tree.getAttribute("aria-checked")).toBe("false");
  });

  it("switching to Tree renders the journey → target path tree", () => {
    renderScoped();
    dispatch({ type: "peekResult", host: HOST, realm: REALM, status: populatedCache() });
    dispatch(findUsagesResult());
    fireEvent.click(screen.getByRole("radio", { name: "Tree" }));
    // The root journey and the leaf target are both rendered as nodes.
    expect(screen.getByRole("button", { name: "Login" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "esv.x" })).toBeTruthy();
  });
});

/** A findUsages `queryResult` — journey `Login` → esv `esv.x`. */
function findUsagesResult() {
  const journey = { key: "journey:Login", kind: "journey", id: "Login", displayName: "Login" };
  const esv = { key: "esv:esv.x", kind: "esv", id: "esv.x", displayName: "esv.x" };
  return {
    type: "queryResult" as const,
    host: HOST,
    realm: REALM,
    mode: "findUsages" as const,
    targetKey: esv.key,
    refs: [{ ref: { fromKey: journey.key, via: "ScriptedDecisionNode" }, entity: journey }],
    paths: {
      targetKey: esv.key,
      roots: [
        {
          key: journey.key,
          entity: journey,
          children: [{ key: esv.key, entity: esv, via: "string literal", children: [] }],
        },
      ],
    },
  };
}
