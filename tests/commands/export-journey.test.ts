import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { exportJourney } from "@/commands/export-journey";
import { buildJourneyBundle } from "@/export/journey-bundle";

vi.mock("vscode", async () => (await import("../util/vscode-mock")).makeVscodeMock());
vi.mock("@/export/journey-bundle", () => ({ buildJourneyBundle: vi.fn() }));

// biome-ignore lint/suspicious/noExplicitAny: tiny test logger fake
function fakeLogger(): any {
  const noop = () => undefined;
  const self = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };
  return { ...self, child: () => self };
}

function makeDeps() {
  return {
    // biome-ignore lint/suspicious/noExplicitAny: minimal cache fake
    clientCache: { get: vi.fn(async () => ({})) } as any,
    // biome-ignore lint/suspicious/noExplicitAny: minimal registry fake
    registry: { list: () => [{ kind: "paic", host: "h1", saId: "sa" }] } as any,
    log: fakeLogger(),
    extensionVersion: "0.3.0",
  };
}

const ARG = { host: "h1", realm: "alpha", journeyId: "Login" };
const BUNDLE = { meta: { exportTool: "paic-journeys-vscode" }, trees: { Login: { nodes: {} } } };

describe("exportJourney", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(
      vscode.Uri.file("/tmp/Login.journey.json"),
    );
    // biome-ignore lint/suspicious/noExplicitAny: mock return
    vi.mocked(buildJourneyBundle).mockResolvedValue(BUNDLE as any);
  });

  it("picks depth, walks at the chosen depth, and writes the bundle", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: quickpick item carries `mode`
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ mode: "allLevels" } as any);

    await exportJourney(makeDeps(), ARG);

    expect(buildJourneyBundle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ host: "h1" }),
      "alpha",
      "Login",
      "allLevels",
      "0.3.0",
      expect.any(String),
      expect.anything(),
    );
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
    const written = JSON.parse(
      new TextDecoder().decode(vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0][1]),
    );
    expect(written.trees.Login).toBeDefined();
  });

  it("does not walk or write when the depth pick is dismissed", async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    await exportJourney(makeDeps(), ARG);

    expect(buildJourneyBundle).not.toHaveBeenCalled();
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it("does not write when the save dialog is cancelled", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: quickpick item carries `mode`
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ mode: "level1" } as any);
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined);

    await exportJourney(makeDeps(), ARG);

    expect(buildJourneyBundle).not.toHaveBeenCalled();
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });
});
