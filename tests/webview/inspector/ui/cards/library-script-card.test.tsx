// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LibraryScriptCard } from "@/webview/inspector/ui/cards/LibraryScriptCard";
import type { ResolveState } from "@/webview/inspector/ui/cards/ResolvedView";
import type { NodeRef, SelectPayload } from "@/webview/messages";

const payload: Extract<SelectPayload, { kind: "libraryScript" }> = {
  kind: "libraryScript",
  uid: "library-script:h:alpha:helpers:parent",
  host: "openam-tenant.example.forgeblocks.com",
  realmName: "alpha",
  scriptId: "s-lib-helpers",
  name: "helpers",
  script: { id: "s-lib-helpers", name: "helpers", language: "JAVASCRIPT", body: "" },
};

const noop = () => undefined;
const idle: ResolveState = { status: "idle" };

describe("LibraryScriptCard", () => {
  it("renders the library script name as the heading", () => {
    render(
      <LibraryScriptCard
        payload={payload}
        resolved={idle}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("helpers");
  });

  it("invokes onOpenBody with the right args when the button is clicked", () => {
    const onOpenBody = vi.fn();
    render(
      <LibraryScriptCard
        payload={payload}
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
      "s-lib-helpers",
      "JAVASCRIPT",
    );
  });

  it("renders deps and fires onPreview when a library / ESV link is clicked", () => {
    const onPreview = vi.fn();
    const libs: NodeRef[] = [
      {
        uid: "library-script:h:alpha:nested:helpers,parent",
        label: "nested",
        kind: "libraryScript",
      },
    ];
    const esvs: NodeRef[] = [{ uid: "esv:h:alpha:PUBLIC_URL", label: "PUBLIC_URL", kind: "esv" }];
    render(
      <LibraryScriptCard
        payload={payload}
        deps={{ libraryScripts: libs, esvs }}
        resolved={idle}
        onPreview={onPreview}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "nested" }));
    expect(onPreview).toHaveBeenLastCalledWith(libs[0].uid);
    fireEvent.click(screen.getByRole("button", { name: "PUBLIC_URL" }));
    expect(onPreview).toHaveBeenLastCalledWith(esvs[0].uid);
  });

  // ─── D35 — Dependencies segmented control ──────────────────────────────

  it("renders the Direct / Full tree / Flat segmented control", () => {
    render(
      <LibraryScriptCard
        payload={payload}
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

  it("clicking Full tree fires onResolve when status is idle", () => {
    const onResolve = vi.fn();
    render(
      <LibraryScriptCard
        payload={payload}
        resolved={idle}
        onResolve={onResolve}
        onRefresh={noop}
        onPreviewResolved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Full tree" }));
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it("Find usages button fires onFindUsages with isLibrary: true (M5 Slice 3)", () => {
    const onFindUsages = vi.fn();
    render(
      <LibraryScriptCard
        payload={payload}
        resolved={idle}
        onResolve={noop}
        onRefresh={noop}
        onPreviewResolved={noop}
        onFindUsages={onFindUsages}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Find usages/i }));
    expect(onFindUsages).toHaveBeenCalledWith({
      type: "findUsages",
      host: payload.host,
      realm: "alpha",
      kind: "script",
      id: "s-lib-helpers",
      displayName: "helpers",
      isLibrary: true,
    });
  });
});
