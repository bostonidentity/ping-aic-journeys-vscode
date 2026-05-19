// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedGraph } from "@/domain/resolved-graph";
import type { ResolveState } from "@/webview/inspector/ui/cards/ResolvedView";
import { ScriptCard } from "@/webview/inspector/ui/cards/ScriptCard";
import type { NodeRef, SelectPayload } from "@/webview/messages";

const baseline: Extract<SelectPayload, { kind: "script" }> = {
  kind: "script",
  uid: "script:h:alpha:s-1",
  host: "openam-tenant.example.forgeblocks.com",
  realmName: "alpha",
  scriptId: "s-1",
};

const noop = () => undefined;
const idle: ResolveState = { status: "idle" };

describe("ScriptCard", () => {
  it("falls back to scriptId in the heading when the script body isn't fetched", () => {
    render(
      <ScriptCard
        payload={baseline}
        resolved={idle}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("s-1");
  });

  it("uses the script name and shows language when present", () => {
    render(
      <ScriptCard
        payload={{
          ...baseline,
          script: { id: "s-1", name: "AuthDecision", language: "JAVASCRIPT", body: "" },
        }}
        resolved={idle}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("AuthDecision");
    expect(screen.getByText("JAVASCRIPT")).toBeTruthy();
  });

  it("renders the new fields (context / description / default / evaluatorVersion / lastModified pair) when present", () => {
    const ts = Date.UTC(2025, 0, 15, 12, 30, 0);
    render(
      <ScriptCard
        payload={{
          ...baseline,
          script: {
            id: "s-1",
            name: "AuthDecision",
            language: "JAVASCRIPT",
            body: "",
            context: "AUTHENTICATION_TREE_DECISION_NODE",
            description: "Sets session assurance",
            isDefault: false,
            evaluatorVersion: "2.0",
            lastModifiedBy: "id=admin,ou=user,ou=am-config",
            lastModifiedDate: ts,
          },
        }}
        resolved={idle}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.getByText("AUTHENTICATION_TREE_DECISION_NODE")).toBeTruthy();
    expect(screen.getByText("Sets session assurance")).toBeTruthy();
    expect(screen.getByText("false")).toBeTruthy(); // isDefault
    expect(screen.getByText("2.0")).toBeTruthy();
    expect(screen.getByText("id=admin,ou=user,ou=am-config")).toBeTruthy();
    expect(screen.getByText(new Date(ts).toISOString())).toBeTruthy();
  });

  it("skips new-field rows when the values are undefined", () => {
    render(
      <ScriptCard
        payload={{
          ...baseline,
          script: { id: "s-1", name: "Minimal", language: "JAVASCRIPT", body: "" },
        }}
        resolved={idle}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.queryByText("Context")).toBeNull();
    expect(screen.queryByText("Default (OOTB)")).toBeNull();
    expect(screen.queryByText("Evaluator version")).toBeNull();
    expect(screen.queryByText("Last modified by")).toBeNull();
    expect(screen.queryByText("Last modified")).toBeNull();
  });

  it("renders no Open-body action when onOpenBody is not provided", () => {
    render(
      <ScriptCard
        payload={baseline}
        resolved={idle}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.queryByRole("button", { name: /Open body in editor/ })).toBeNull();
  });

  it("calls onOpenBody with host / realm / scriptId / language when the button is clicked", () => {
    const onOpenBody = vi.fn();
    render(
      <ScriptCard
        payload={{
          ...baseline,
          script: { id: "s-1", name: "AuthDecision", language: "JAVASCRIPT", body: "" },
        }}
        resolved={idle}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
        onOpenBody={onOpenBody}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Open body in editor/ }));
    expect(onOpenBody).toHaveBeenCalledWith(
      "openam-tenant.example.forgeblocks.com",
      "alpha",
      "s-1",
      "JAVASCRIPT",
    );
  });

  it("renders the script-deps block with library + ESV links and fires onPreview on click", () => {
    const onPreview = vi.fn();
    const libs: NodeRef[] = [
      { uid: "library-script:h:alpha:helpers:s-1", label: "helpers", kind: "libraryScript" },
    ];
    const esvs: NodeRef[] = [{ uid: "esv:h:alpha:PUBLIC_URL", label: "PUBLIC_URL", kind: "esv" }];
    render(
      <ScriptCard
        payload={baseline}
        deps={{ libraryScripts: libs, esvs }}
        resolved={idle}
        onPreview={onPreview}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "helpers" }));
    expect(onPreview).toHaveBeenLastCalledWith(libs[0].uid);
    fireEvent.click(screen.getByRole("button", { name: "PUBLIC_URL" }));
    expect(onPreview).toHaveBeenLastCalledWith(esvs[0].uid);
  });

  // ─── D35 — Dependencies segmented control ─────────────────────────────

  it("renders the Direct / Full tree / Flat segmented control", () => {
    render(
      <ScriptCard
        payload={baseline}
        resolved={idle}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.getByRole("radio", { name: "Direct" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Full tree" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Flat" })).toBeTruthy();
  });

  it("renders the resolved tree when status is ok and the user switches to Full tree", () => {
    const graph: ResolvedGraph = {
      rootKey: "script:s-1",
      nodes: {
        "script:s-1": {
          key: "script:s-1",
          kind: "script",
          id: "s-1",
          displayName: "validator",
          depth: 0,
        },
        "script:lib-1": {
          key: "script:lib-1",
          kind: "script",
          id: "lib-1",
          displayName: "helpers",
          depth: 1,
        },
      },
      edges: [{ fromKey: "script:s-1", toKey: "script:lib-1", via: "require()" }],
      durationMs: 9,
    };
    render(
      <ScriptCard
        payload={baseline}
        resolved={{ status: "ok", graph }}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Full tree" }));
    expect(screen.getByText("helpers")).toBeTruthy();
    expect(screen.getByText(/Resolved in 9 ms/)).toBeTruthy();
  });
});
