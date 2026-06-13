import { describe, expect, it } from "vitest";
import { isE2W, isW2E } from "@/webview/transfer/messages";

describe("transfer message guards", () => {
  it("isW2E accepts every W2E variant incl. applyEsv", () => {
    for (const m of [
      { type: "ready" },
      { type: "pickBundle" },
      { type: "listRealms", host: "h" },
      { type: "runPreflight", host: "h", realm: "r" },
      { type: "execute", host: "h", realm: "r", selected: ["theme:t"] },
      { type: "applyEsv", host: "h" },
    ]) {
      expect(isW2E(m)).toBe(true);
    }
  });

  it("isE2W accepts applyProgress + applyResult", () => {
    expect(isE2W({ type: "applyProgress", host: "h", status: "restarting", elapsedS: 1 })).toBe(
      true,
    );
    expect(isE2W({ type: "applyResult", host: "h", ok: true, elapsedS: 1 })).toBe(true);
  });

  it("rejects unknown / malformed messages", () => {
    expect(isW2E({ type: "nope" })).toBe(false);
    expect(isE2W({ type: "nope" })).toBe(false);
    expect(isW2E(null)).toBe(false);
    expect(isE2W("x")).toBe(false);
  });
});
