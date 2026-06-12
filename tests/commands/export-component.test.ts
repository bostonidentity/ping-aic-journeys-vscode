import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { exportComponent } from "@/commands/export-component";

vi.mock("vscode", async () => (await import("../util/vscode-mock")).makeVscodeMock());

// biome-ignore lint/suspicious/noExplicitAny: tiny test logger fake
function fakeLogger(): any {
  const noop = () => undefined;
  const self = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };
  return { ...self, child: () => self };
}

const SCRIPT_RAW = {
  _id: "uuid-1",
  name: "my-script",
  language: "JAVASCRIPT",
  script: Buffer.from("var x=1;", "utf8").toString("base64"),
  context: "AUTHENTICATION_TREE_DECISION_NODE",
  _rev: "9",
};

function makeClient(over: Record<string, unknown> = {}) {
  return {
    getRawScript: vi.fn(async () => SCRIPT_RAW),
    getRawTheme: vi.fn(async () => null),
    getRawEmailTemplate: vi.fn(async () => null),
    getRawSocialIdp: vi.fn(async () => null),
    getRawEsv: vi.fn(async () => null),
    ...over,
  };
}

function makeDeps(client = makeClient()) {
  return {
    deps: {
      // biome-ignore lint/suspicious/noExplicitAny: minimal cache fake
      clientCache: { get: vi.fn(async () => client) } as any,
      // biome-ignore lint/suspicious/noExplicitAny: minimal registry fake
      registry: { list: () => [{ kind: "paic", host: "h1", saId: "sa-123" }] } as any,
      log: fakeLogger(),
      extensionVersion: "0.2.0",
    },
    client,
  };
}

function writtenBundle() {
  return JSON.parse(
    new TextDecoder().decode(vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0][1]),
  );
}

const SCRIPT_ARG = { host: "h1", realm: "alpha", kind: "script", id: "uuid-1", name: "my-script" };

describe("exportComponent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(vscode.Uri.file("/tmp/out.json"));
  });

  it("fetches, serializes, and writes a script bundle when a save target is chosen", async () => {
    const { deps, client } = makeDeps();
    await exportComponent(deps, SCRIPT_ARG);
    expect(client.getRawScript).toHaveBeenCalledWith("alpha", "uuid-1");
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
    const b = writtenBundle();
    expect(b.meta.exportTool).toBe("paic-journeys-vscode");
    expect(b.meta.connectionType).toBe("paic");
    expect(b.script["uuid-1"]._id).toBe("uuid-1");
    expect(b.script["uuid-1"]).not.toHaveProperty("_rev");
    expect(b.script["uuid-1"].script).toBe(JSON.stringify("var x=1;"));
  });

  it("exports a theme into the frodo `theme` per-type bundle", async () => {
    const themeRaw = { _id: "theme-1", name: "Corp", backgroundColor: "#fff", _rev: "3" };
    const { deps, client } = makeDeps(makeClient({ getRawTheme: vi.fn(async () => themeRaw) }));
    await exportComponent(deps, {
      host: "h1",
      realm: "alpha",
      kind: "theme",
      id: "theme-1",
      name: "Corp",
    });
    expect(client.getRawTheme).toHaveBeenCalledWith("alpha", "theme-1");
    const b = writtenBundle();
    expect(b.theme["theme-1"].name).toBe("Corp");
    expect(b.theme["theme-1"]).not.toHaveProperty("_rev");
  });

  it("routes an esv to variable/secret per the accessor's discovered kind", async () => {
    const { deps } = makeDeps(
      makeClient({
        getRawEsv: vi.fn(async () => ({
          kind: "secret",
          raw: { _id: "esv-a-b", encoding: "generic" },
        })),
      }),
    );
    await exportComponent(deps, {
      host: "h1",
      realm: "alpha",
      kind: "esv",
      id: "esv.a.b",
      name: "esv.a.b",
    });
    const b = writtenBundle();
    expect(b.secret["esv-a-b"].encoding).toBe("generic");
    expect(b.variable).toBeUndefined();
  });

  it("shows an error and does not write when the entity isn't found", async () => {
    const { deps } = makeDeps(makeClient({ getRawTheme: vi.fn(async () => null) }));
    await exportComponent(deps, {
      host: "h1",
      realm: "alpha",
      kind: "theme",
      id: "missing",
      name: "x",
    });
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it("does not write when the user cancels the save dialog", async () => {
    const { deps } = makeDeps();
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined);
    await exportComponent(deps, SCRIPT_ARG);
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it("ignores invalid args without fetching or prompting", async () => {
    const { deps, client } = makeDeps();
    await exportComponent(deps, { host: "h1" });
    expect(client.getRawScript).not.toHaveBeenCalled();
    expect(vscode.window.showSaveDialog).not.toHaveBeenCalled();
  });
});
