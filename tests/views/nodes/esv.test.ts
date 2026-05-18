import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../../util/vscode-mock")).makeVscodeMock());

import { describe, expect, it } from "vitest";
import type { EsvVariable } from "@/domain/types";
import { EsvNode } from "@/views/nodes/esv";

const HOST = "h.example.com";
const REALM = "alpha";

describe("EsvNode", () => {
  it("variable kind sets symbol-variable icon + tooltip carries 'ESV Variable'", () => {
    const resolved: EsvVariable = {
      kind: "variable",
      name: "esv.kyid.portal.name",
      expressionType: "string",
    };
    const node = new EsvNode(HOST, REALM, "esv.kyid.portal.name", undefined, "variable", resolved);
    expect((node.iconPath as { id: string }).id).toBe("symbol-variable");
    expect(node.kind).toBe("variable");
    expect(node.resolved).toBe(resolved);
    expect(node.contextValue).toBe("esv");
    // tooltip is a MarkdownString — its `.value` carries the rendered markdown
    expect((node.tooltip as { value: string }).value).toContain("ESV Variable");
  });

  it("secret kind sets lock icon + tooltip carries 'ESV Secret'", () => {
    const node = new EsvNode(HOST, REALM, "esv.signing.key", undefined, "secret");
    expect((node.iconPath as { id: string }).id).toBe("lock");
    expect(node.contextValue).toBe("esv");
    expect((node.tooltip as { value: string }).value).toContain("ESV Secret");
  });

  it("missing kind sets warning icon + '(not in tenant)' description + esvMissing contextValue", () => {
    const node = new EsvNode(HOST, REALM, "esv.phantom.ref", undefined, "missing");
    expect((node.iconPath as { id: string }).id).toBe("warning");
    expect(node.description).toBe("(not in tenant)");
    expect(node.contextValue).toBe("esvMissing");
    expect((node.tooltip as { value: string }).value).toContain("not in tenant");
  });
});
