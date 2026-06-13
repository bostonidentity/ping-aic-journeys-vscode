import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", async () => (await import("../util/vscode-mock")).makeVscodeMock());

import { makeBundleUri, PaicBundleContentProvider } from "@/providers/bundle-content-provider";

describe("PaicBundleContentProvider", () => {
  let provider: PaicBundleContentProvider;

  beforeEach(() => {
    provider = new PaicBundleContentProvider();
  });

  it("serves text registered under a key", () => {
    const uri = provider.set("script:s-1", "// hello\nlogger.message('x');");
    expect(provider.provideTextDocumentContent(uri)).toBe("// hello\nlogger.message('x');");
  });

  it("round-trips a key with special chars (colon/slash) via URI encoding", () => {
    const uri = provider.set("script:alpha/customers:abc", "body");
    expect(provider.provideTextDocumentContent(uri)).toBe("body");
  });

  it("returns empty string for an unknown key", () => {
    expect(provider.provideTextDocumentContent(makeBundleUri("script:never-set"))).toBe("");
  });

  it("overwrites content when the same key is set again", () => {
    provider.set("k", "first");
    const uri = provider.set("k", "second");
    expect(provider.provideTextDocumentContent(uri)).toBe("second");
  });
});
