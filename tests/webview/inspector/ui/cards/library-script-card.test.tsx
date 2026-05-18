// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LibraryScriptCard } from "@/webview/inspector/ui/cards/LibraryScriptCard";
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

describe("LibraryScriptCard", () => {
  it("renders the library script name as the heading", () => {
    render(<LibraryScriptCard payload={payload} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("helpers");
  });

  it("invokes onOpenBody with the right args when the button is clicked", () => {
    const onOpenBody = vi.fn();
    render(<LibraryScriptCard payload={payload} onOpenBody={onOpenBody} />);
    fireEvent.click(screen.getByRole("button", { name: /Open body in editor/ }));
    expect(onOpenBody).toHaveBeenCalledWith(
      "openam-tenant.example.forgeblocks.com",
      "alpha",
      "s-lib-helpers",
      "JAVASCRIPT",
    );
  });

  it("renders deps and fires onNavigate when a library / ESV link is clicked", () => {
    const onNavigate = vi.fn();
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
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "nested" }));
    expect(onNavigate).toHaveBeenLastCalledWith(libs[0].uid);
    fireEvent.click(screen.getByRole("button", { name: "PUBLIC_URL" }));
    expect(onNavigate).toHaveBeenLastCalledWith(esvs[0].uid);
  });
});
