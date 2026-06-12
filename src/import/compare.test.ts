import { describe, expect, it } from "vitest";
import { classifyCompare, normalizeForCompare, stableStringify } from "./compare";

describe("classifyCompare", () => {
  it("new when the target is absent", () => {
    expect(classifyCompare("theme", { _id: "t" }, null)).toBe("new");
  });

  it("theme identical despite differing _id / _rev / linkedTrees / isDefault", () => {
    const bundle = { _id: "t1", backgroundColor: "#111", logo: { en: "x" } };
    const target = {
      _id: "t2",
      _rev: "9",
      backgroundColor: "#111",
      logo: { en: "x" },
      linkedTrees: ["A"],
      isDefault: true,
    };
    expect(classifyCompare("theme", bundle, target)).toBe("identical");
  });

  it("theme differs on a real content field", () => {
    expect(classifyCompare("theme", { backgroundColor: "#111" }, { backgroundColor: "#222" })).toBe(
      "differs",
    );
  });

  it("idp identical despite differing clientSecret / _type / _rev", () => {
    const bundle = { _id: "i", clientId: "c", clientSecret: null, _type: { _id: "oidcConfig" } };
    const target = {
      _id: "i",
      _rev: "2",
      clientId: "c",
      clientSecret: "*****",
      _type: { _id: "oidcConfig", name: "OIDC" },
    };
    expect(classifyCompare("socialIdp", bundle, target)).toBe("identical");
  });

  it("idp differs on a real field (clientId)", () => {
    expect(classifyCompare("socialIdp", { clientId: "a" }, { clientId: "b" })).toBe("differs");
  });

  it("email identical despite _id + _rev", () => {
    const bundle = { _id: "emailTemplate/welcome", subject: { en: "Hi" } };
    const target = { _id: "emailTemplate/welcome", _rev: "4", subject: { en: "Hi" } };
    expect(classifyCompare("emailTemplate", bundle, target)).toBe("identical");
  });

  it("existence-only kinds → exists even when content differs", () => {
    for (const k of ["script", "variable", "secret"] as const) {
      expect(classifyCompare(k, { a: 1 }, { a: 2 })).toBe("exists");
    }
  });
});

describe("stableStringify", () => {
  it("is key-order independent", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it("recurses into nested objects (and respects array order)", () => {
    expect(stableStringify({ x: { b: 1, a: 2 }, arr: [3, 1] })).toBe(
      stableStringify({ arr: [3, 1], x: { a: 2, b: 1 } }),
    );
    expect(stableStringify({ arr: [1, 3] })).not.toBe(stableStringify({ arr: [3, 1] }));
  });
});

describe("normalizeForCompare", () => {
  it("drops _id + mask fields for every kind", () => {
    const n = normalizeForCompare("emailTemplate", { _id: "x", _rev: "1", subject: {} });
    expect(n._id).toBeUndefined();
    expect(n._rev).toBeUndefined();
    expect(n).toHaveProperty("subject");
  });

  it("theme drops linkedTrees + isDefault", () => {
    const n = normalizeForCompare("theme", {
      linkedTrees: ["a"],
      isDefault: true,
      primaryColor: "#1",
    });
    expect(n.linkedTrees).toBeUndefined();
    expect(n.isDefault).toBeUndefined();
    expect(n.primaryColor).toBe("#1");
  });

  it("idp drops clientSecret + _type", () => {
    const n = normalizeForCompare("socialIdp", {
      clientSecret: "s",
      _type: { _id: "x" },
      clientId: "c",
    });
    expect(n.clientSecret).toBeUndefined();
    expect(n._type).toBeUndefined();
    expect(n.clientId).toBe("c");
  });

  it("does not mutate the input", () => {
    const input = { _id: "x", linkedTrees: ["a"] };
    normalizeForCompare("theme", input);
    expect(input._id).toBe("x");
    expect(input.linkedTrees).toEqual(["a"]);
  });
});
