import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { chooseModal, confirm } from "@/util/dialogs";

vi.mock("vscode", async () => (await import("./vscode-mock")).makeVscodeMock());

describe("confirm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a modal with the title, detail, and verb button", async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue("Remove" as never);
    const ok = await confirm("Remove connection?", "This deletes its credentials.", "Remove");
    expect(ok).toBe(true);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      "Remove connection?",
      { modal: true, detail: "This deletes its credentials." },
      "Remove",
    );
  });

  it("returns false when the user dismisses (Escape / Cancel → undefined)", async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
    expect(await confirm("t", "d", "Go")).toBe(false);
  });

  it("returns false if some other value comes back", async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue("Cancel" as never);
    expect(await confirm("t", "d", "Go")).toBe(false);
  });
});

describe("chooseModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes every verb as a modal button and returns the chosen one", async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue("All levels" as never);
    const pick = await chooseModal("Depth?", "explain both", "Level 1 only", "All levels");
    expect(pick).toBe("All levels");
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      "Depth?",
      { modal: true, detail: "explain both" },
      "Level 1 only",
      "All levels",
    );
  });

  it("returns undefined when dismissed", async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
    expect(await chooseModal("t", "d", "A", "B")).toBeUndefined();
  });
});
