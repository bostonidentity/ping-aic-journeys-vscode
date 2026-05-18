import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../../util/vscode-mock")).makeVscodeMock());

import { describe, expect, it } from "vitest";
import { ThemeNode } from "@/views/nodes/theme";
import { makeFakeCache, makeFakeLogger, makeFakePaicClient } from "../fakes";

describe("ThemeNode", () => {
  it("constructor sets uid + contextValue + leaf state; loadChildren returns empty", async () => {
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
    expect(await node.getChildren()).toEqual([]);
  });
});
