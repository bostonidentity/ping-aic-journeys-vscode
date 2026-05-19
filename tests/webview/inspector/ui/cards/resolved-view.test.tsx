// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedGraph } from "@/domain/resolved-graph";
import { ResolvedView, type ResolveState } from "@/webview/inspector/ui/cards/ResolvedView";

const idle: ResolveState = { status: "idle" };

function graphWithDeps(): ResolvedGraph {
  return {
    rootKey: "journey:Login",
    nodes: {
      "journey:Login": {
        key: "journey:Login",
        kind: "journey",
        id: "Login",
        displayName: "Login",
        depth: 0,
      },
      "script:s-1": {
        key: "script:s-1",
        kind: "script",
        id: "s-1",
        displayName: "validator",
        depth: 1,
      },
      "script:s-2": {
        key: "script:s-2",
        kind: "script",
        id: "s-2",
        displayName: "helper",
        depth: 2,
      },
    },
    edges: [
      { fromKey: "journey:Login", toKey: "script:s-1", via: "ScriptedDecisionNode" },
      { fromKey: "script:s-1", toKey: "script:s-2", via: "require()" },
    ],
    durationMs: 17,
  };
}

function graphWithCycle(): ResolvedGraph {
  return {
    rootKey: "journey:Login",
    nodes: {
      "journey:Login": {
        key: "journey:Login",
        kind: "journey",
        id: "Login",
        displayName: "Login",
        depth: 0,
      },
      "journey:Inner": {
        key: "journey:Inner",
        kind: "journey",
        id: "Inner",
        displayName: "Inner",
        depth: 1,
      },
    },
    edges: [
      { fromKey: "journey:Login", toKey: "journey:Inner", via: "InnerTreeEvaluatorNode" },
      {
        fromKey: "journey:Inner",
        toKey: "journey:Login",
        via: "InnerTreeEvaluatorNode",
        cycle: true,
      },
    ],
    durationMs: 5,
  };
}

const noop = () => undefined;

describe("ResolvedView", () => {
  it("renders the Direct content by default", () => {
    render(
      <ResolvedView
        directContent={<p>level-1-deps-go-here</p>}
        resolved={idle}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.getByText("level-1-deps-go-here")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Direct" }).getAttribute("aria-checked")).toBe("true");
  });

  it("clicking Full tree fires onResolve when status is idle", () => {
    const onResolve = vi.fn();
    render(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={idle}
        onResolve={onResolve}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Full tree" }));
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it("clicking Full tree does NOT fire onResolve when status is already ok", () => {
    const onResolve = vi.fn();
    render(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={{ status: "ok", graph: graphWithDeps() }}
        onResolve={onResolve}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Full tree" }));
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("renders the summary 'N unique · M refs' only when status is ok", () => {
    const { rerender } = render(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={idle}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.queryByText(/unique · /)).toBeNull();

    rerender(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={{ status: "ok", graph: graphWithDeps() }}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.getByText(/2 unique · 2 refs/)).toBeTruthy();
  });

  it("shows 'Resolving…' when status is loading and Full mode is selected", () => {
    render(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={{ status: "loading" }}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Full tree" }));
    expect(screen.getByText("Resolving…")).toBeTruthy();
  });

  it("shows error banner when status is err and Full mode is selected", () => {
    render(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={{ status: "err", message: "tenant 503" }}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Full tree" }));
    expect(screen.getByText(/Resolve failed: tenant 503/)).toBeTruthy();
  });
});

describe("ResolvedView — Full tree mode", () => {
  it("renders the tree from root with nested children + footer", () => {
    render(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={{ status: "ok", graph: graphWithDeps() }}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Full tree" }));
    // Both child nodes render — script:s-1 and its nested script:s-2.
    expect(screen.getByText("validator")).toBeTruthy();
    expect(screen.getByText("helper")).toBeTruthy();
    expect(screen.getByText(/Resolved in 17 ms/)).toBeTruthy();
    expect(screen.getByText(/Cycles: none/)).toBeTruthy();
  });

  it("marks the rendered-LATER occurrence as (dup) — first-in-render-order wins, independent of walker discovery", () => {
    // Two parent scripts both reference the same library, and the walker's
    // BFS discovery happens to add the library via the alphabetically-later
    // parent first (so its `edge.cycle` flag is on the alphabetically-FIRST
    // parent's edge, contradicting render order). The render layer should
    // override and mark whichever edge renders SECOND as (dup).
    const graph: ResolvedGraph = {
      rootKey: "journey:Root",
      nodes: {
        "journey:Root": {
          key: "journey:Root",
          kind: "journey",
          id: "Root",
          displayName: "Root",
          depth: 0,
        },
        // Two regular scripts under the root — same kind, so alpha sort
        // decides render order.
        "script:zParent": {
          key: "script:zParent",
          kind: "script",
          id: "zParent",
          displayName: "ZParent", // renders SECOND (alpha later)
          depth: 1,
        },
        "script:aParent": {
          key: "script:aParent",
          kind: "script",
          id: "aParent",
          displayName: "AParent", // renders FIRST (alpha earlier)
          depth: 1,
        },
        "script:shared": {
          key: "script:shared",
          kind: "script",
          id: "shared",
          displayName: "shared-lib",
          depth: 2,
          isLibrary: true,
        },
      },
      edges: [
        { fromKey: "journey:Root", toKey: "script:zParent", via: "ScriptedDecisionNode" },
        { fromKey: "journey:Root", toKey: "script:aParent", via: "ScriptedDecisionNode" },
        // Walker discovered via zParent first (no cycle flag on this edge):
        { fromKey: "script:zParent", toKey: "script:shared", via: "require()" },
        // ...so the alphabetically-EARLIER parent's edge got marked cycle:
        {
          fromKey: "script:aParent",
          toKey: "script:shared",
          via: "require()",
          cycle: true,
        },
      ],
      durationMs: 5,
    };
    const { container } = render(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={{ status: "ok", graph }}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Full tree" }));

    // Read every `<li class="deps-tree-row">` in document order.
    const rows = [...container.querySelectorAll(".deps-tree-row")].map(
      (li) => li.textContent ?? "",
    );
    // AParent's row comes before ZParent's row (alphabetical kind-group sort).
    const aIdx = rows.findIndex((t) => t.startsWith(" AParent") || t.startsWith("AParent"));
    const zIdx = rows.findIndex((t) => t.startsWith(" ZParent") || t.startsWith("ZParent"));
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(aIdx).toBeLessThan(zIdx);

    // The FIRST AParent → shared-lib edge renders with subtree (no `(dup)`
    // text within AParent's row context). The LATER ZParent → shared-lib
    // edge gets the `(dup)` marker — even though the walker marked the
    // OPPOSITE edge as cycle.
    const aRow = rows[aIdx];
    const zRow = rows[zIdx];
    expect(aRow).toContain("shared-lib"); // AParent expanded its subtree
    expect(aRow).not.toContain("(dup)"); // AParent's link to shared-lib is NOT dup
    expect(zRow).toContain("(dup)"); // ZParent's link to shared-lib IS dup
  });

  it("renders a `(dup)` marker for cycle edges and does NOT recurse into them", () => {
    render(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={{ status: "ok", graph: graphWithCycle() }}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Full tree" }));
    // Login appears once as root (not rendered as a row), Inner appears as
    // a child row, AND the back-edge to Login appears as `(dup)`.
    expect(screen.getByText("(dup)").textContent).toContain("(dup)");
    // The cycle edge surfaces Login's displayName under Inner as a clickable
    // link but doesn't recurse further.
    expect(screen.getAllByText("Login")).toHaveLength(1); // only as dup target's text
    expect(screen.getByText(/Cycles: 1/)).toBeTruthy();
  });

  it("clicking a tree node row fires onPreviewResolved with the child's ResolvedNode", () => {
    const onPreview = vi.fn();
    render(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={{ status: "ok", graph: graphWithDeps() }}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={onPreview}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Full tree" }));
    fireEvent.click(screen.getByRole("button", { name: /validator/ }));
    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({ key: "script:s-1", kind: "script", id: "s-1" }),
    );
  });
});

describe("ResolvedView — Flat mode", () => {
  it("lists unique non-root nodes with ref counts + shortest depth", () => {
    render(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={{ status: "ok", graph: graphWithDeps() }}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Flat" }));
    expect(screen.getByText("validator")).toBeTruthy();
    expect(screen.getByText("helper")).toBeTruthy();
    // Two flat rows — each has its own meta line ending in " refs · depth N".
    expect(screen.getAllByText(/refs · depth/)).toHaveLength(2);
  });

  it("shows the empty-state when no transitive deps", () => {
    const lonely: ResolvedGraph = {
      rootKey: "journey:Login",
      nodes: {
        "journey:Login": {
          key: "journey:Login",
          kind: "journey",
          id: "Login",
          displayName: "Login",
          depth: 0,
        },
      },
      edges: [],
      durationMs: 1,
    };
    render(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={{ status: "ok", graph: lonely }}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Flat" }));
    expect(screen.getByText(/No transitive dependencies/)).toBeTruthy();
  });
});

describe("ResolvedView — per-card refresh button (D35)", () => {
  it("hides the refresh button when status is idle or loading", () => {
    const { rerender } = render(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={idle}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.queryByRole("button", { name: /Refresh dependencies/ })).toBeNull();

    rerender(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={{ status: "loading" }}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.queryByRole("button", { name: /Refresh dependencies/ })).toBeNull();
  });

  it("shows the refresh button when status is ok or err", () => {
    const { rerender } = render(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={{ status: "ok", graph: graphWithDeps() }}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /Refresh dependencies/ })).toBeTruthy();

    rerender(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={{ status: "err", message: "tenant 503" }}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /Refresh dependencies/ })).toBeTruthy();
  });

  it("Full mode renders kind dividers + alphabetical sort + per-kind codicon class", () => {
    const graph: ResolvedGraph = {
      rootKey: "journey:Login",
      nodes: {
        "journey:Login": {
          key: "journey:Login",
          kind: "journey",
          id: "Login",
          displayName: "Login",
          depth: 0,
        },
        "script:s-1": {
          key: "script:s-1",
          kind: "script",
          id: "s-1",
          displayName: "Bravo",
          depth: 1,
        },
        "script:s-2": {
          key: "script:s-2",
          kind: "script",
          id: "s-2",
          displayName: "alpha",
          depth: 1,
        },
        "script:lib-1": {
          key: "script:lib-1",
          kind: "script",
          id: "lib-1",
          displayName: "helpers",
          depth: 1,
          isLibrary: true,
        },
        "esv:esv.api.key": {
          key: "esv:esv.api.key",
          kind: "esv",
          id: "esv.api.key",
          displayName: "esv.api.key",
          depth: 1,
        },
      },
      edges: [
        { fromKey: "journey:Login", toKey: "script:s-1", via: "ScriptedDecisionNode" },
        { fromKey: "journey:Login", toKey: "script:s-2", via: "ClientScriptNode" },
        { fromKey: "journey:Login", toKey: "script:lib-1", via: "require()" },
        { fromKey: "journey:Login", toKey: "esv:esv.api.key", via: "string literal" },
      ],
      durationMs: 12,
    };
    const { container } = render(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={{ status: "ok", graph }}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Full tree" }));

    // Three kind dividers (Scripts / Library scripts / ESVs) appear in canonical order.
    const dividers = container.querySelectorAll(".deps-tree-divider");
    const dividerLabels = [...dividers].map((d) => d.textContent?.trim());
    expect(dividerLabels).toEqual([
      "── Scripts (2, depth 1) ──",
      "── Library scripts (1, depth 1) ──",
      "── ESVs (1, depth 1) ──",
    ]);

    // Within Scripts: alpha (case-insensitive sort) appears before Bravo.
    const order = [...container.querySelectorAll(".deps-tree-row .link span.deps-name")].map((s) =>
      s.textContent?.trim(),
    );
    const alphaIdx = order.findIndex((t) => t === "alpha");
    const bravoIdx = order.findIndex((t) => t === "Bravo");
    expect(alphaIdx).toBeGreaterThanOrEqual(0);
    expect(alphaIdx).toBeLessThan(bravoIdx);

    // Codicons render with the per-kind class.
    expect(container.querySelector(".codicon-symbol-method")).toBeTruthy(); // script
    expect(container.querySelector(".codicon-library")).toBeTruthy(); // library script
    expect(container.querySelector(".codicon-symbol-variable")).toBeTruthy(); // esv
  });

  it("clicking the refresh button fires onRefresh", () => {
    const onRefresh = vi.fn();
    render(
      <ResolvedView
        directContent={<p>direct</p>}
        resolved={{ status: "ok", graph: graphWithDeps() }}
        onResolve={noop}
        onRefresh={onRefresh}
        onPreviewResolved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Refresh dependencies/ }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
