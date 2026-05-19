import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../../util/vscode-mock")).makeVscodeMock());

import { describe, expect, it } from "vitest";
import { ThemeNode } from "@/views/nodes/theme";
import { makeFakeCache, makeFakeLogger, makeFakePaicClient } from "../fakes";

describe("ThemeNode", () => {
  it("constructor sets uid + contextValue + leaf state; loadChildren returns empty; falls back to themeId as label when not resolved", async () => {
    const node = new ThemeNode(
      "h.example.com",
      "alpha",
      "theme-uuid-1",
      makeFakeCache(makeFakePaicClient({})),
      makeFakeLogger(),
    );
    expect(node.uid).toBe("theme:h.example.com:alpha:theme-uuid-1");
    expect(node.id).toBe(node.uid);
    expect(node.contextValue).toBe("theme");
    expect(node.label).toBe("theme-uuid-1");
    expect(node.description).toBeUndefined();
    expect(node.resolved).toBeUndefined();
    expect(await node.getChildren()).toEqual([]);
  });

  it("uses resolved.name as label + demotes themeId to description", () => {
    const node = new ThemeNode(
      "h.example.com",
      "alpha",
      "theme-uuid-1",
      makeFakeCache(makeFakePaicClient({})),
      makeFakeLogger(),
      undefined,
      { id: "theme-uuid-1", name: "Default Theme", realm: "alpha" },
    );
    expect(node.label).toBe("Default Theme");
    expect(node.description).toBe("theme-uuid-1");
    expect(node.resolved?.name).toBe("Default Theme");
  });

  it("description includes '· default' suffix when isDefault=true", () => {
    const node = new ThemeNode(
      "h.example.com",
      "alpha",
      "theme-uuid-1",
      makeFakeCache(makeFakePaicClient({})),
      makeFakeLogger(),
      undefined,
      { id: "theme-uuid-1", name: "Default", realm: "alpha", isDefault: true },
    );
    expect(node.description).toBe("theme-uuid-1 · default");
  });
});
