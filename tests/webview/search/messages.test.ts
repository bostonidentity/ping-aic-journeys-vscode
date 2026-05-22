import { describe, expect, it } from "vitest";
import { isE2W, isW2E } from "@/webview/search/messages";

describe("isW2E", () => {
  it("returns true for every W2E discriminant", () => {
    expect(isW2E({ type: "ready" })).toBe(true);
    expect(isW2E({ type: "listRealms", host: "h" })).toBe(true);
    expect(isW2E({ type: "peek", host: "h", realm: "alpha" })).toBe(true);
    expect(isW2E({ type: "build", host: "h", realm: "alpha" })).toBe(true);
    expect(isW2E({ type: "rescan", host: "h", realm: "alpha" })).toBe(true);
    expect(isW2E({ type: "listEntities", host: "h", realm: "alpha" })).toBe(true);
    expect(
      isW2E({ type: "query", host: "h", realm: "alpha", mode: "findUsages", targetKey: "k" }),
    ).toBe(true);
    expect(
      isW2E({ type: "query", host: "h", realm: "alpha", mode: "byName", pattern: "x", kinds: [] }),
    ).toBe(true);
    expect(isW2E({ type: "query", host: "h", realm: "alpha", mode: "unused", kinds: [] })).toBe(
      true,
    );
    expect(
      isW2E({
        type: "previewByKey",
        host: "h",
        realm: "alpha",
        kind: "script",
        id: "s",
        displayName: "S",
      }),
    ).toBe(true);
  });

  it("returns false for malformed messages", () => {
    expect(isW2E(null)).toBe(false);
    expect(isW2E(undefined)).toBe(false);
    expect(isW2E("string")).toBe(false);
    expect(isW2E(42)).toBe(false);
    expect(isW2E({})).toBe(false);
    expect(isW2E({ type: "unknown" })).toBe(false);
  });

  it("does not accept E2W message types", () => {
    expect(isW2E({ type: "peekResult" })).toBe(false);
    expect(isW2E({ type: "buildStart" })).toBe(false);
    expect(isW2E({ type: "realmsResult" })).toBe(false);
  });
});

describe("isE2W", () => {
  it("returns true for every E2W discriminant", () => {
    expect(isE2W({ type: "realmsResult", host: "h", realms: [] })).toBe(true);
    expect(isE2W({ type: "realmsError", host: "h", message: "x" })).toBe(true);
    expect(
      isE2W({
        type: "peekResult",
        host: "h",
        realm: "alpha",
        status: { builtAt: null, scanDurationMs: null, counts: null },
      }),
    ).toBe(true);
    expect(isE2W({ type: "buildStart", host: "h", realm: "alpha" })).toBe(true);
    expect(
      isE2W({
        type: "buildDone",
        host: "h",
        realm: "alpha",
        status: { builtAt: 1, scanDurationMs: 1, counts: {} },
      }),
    ).toBe(true);
    expect(isE2W({ type: "buildError", host: "h", realm: "alpha", message: "x" })).toBe(true);
    expect(
      isE2W({
        type: "listEntitiesResult",
        host: "h",
        realm: "alpha",
        entitiesByKind: {
          journey: [],
          script: [],
          esv: [],
          theme: [],
          emailTemplate: [],
          socialIdp: [],
        },
      }),
    ).toBe(true);
    expect(
      isE2W({
        type: "queryResult",
        host: "h",
        realm: "alpha",
        mode: "findUsages",
        targetKey: "k",
        refs: [],
        paths: { targetKey: "k", roots: [] },
      }),
    ).toBe(true);
    expect(
      isE2W({ type: "queryResult", host: "h", realm: "alpha", mode: "byName", results: [] }),
    ).toBe(true);
    expect(
      isE2W({ type: "queryResult", host: "h", realm: "alpha", mode: "unused", results: [] }),
    ).toBe(true);
    expect(isE2W({ type: "queryError", host: "h", realm: "alpha", message: "x" })).toBe(true);
  });

  it("returns false for inspector E2W types + W2E types + malformed", () => {
    expect(isE2W({ type: "select", payload: {} })).toBe(false);
    expect(isE2W({ type: "peek", host: "h", realm: "alpha" })).toBe(false);
    expect(isE2W(null)).toBe(false);
    expect(isE2W({})).toBe(false);
  });
});
