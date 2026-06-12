import { describe, expect, it, vi } from "vitest";
import type { ImportComponent } from "./parse";
import { type PreflightClient, runPreflight } from "./preflight";

/** A fake `PreflightClient` — all accessors return `null` (absent) unless
 * overridden. Overrides return plain objects (cast through `unknown`). */
function client(over: Record<string, () => Promise<unknown>> = {}): PreflightClient {
  return {
    getRawTheme: async () => null,
    getRawEmailTemplate: async () => null,
    getRawSocialIdp: async () => null,
    getRawScriptByName: async () => null,
    getRawEsv: async () => null,
    ...over,
  } as unknown as PreflightClient;
}

const comp = (over: Partial<ImportComponent>): ImportComponent => ({
  kind: "theme",
  id: "t",
  displayName: "T",
  raw: {},
  ...over,
});

describe("runPreflight", () => {
  it("unsupported (and no fetch) for an IDM leaf on an on-prem target", async () => {
    const getRawTheme = vi.fn(async () => null);
    const v = await runPreflight(client({ getRawTheme }), "root", "onprem", [
      comp({ kind: "theme" }),
    ]);
    expect(v[0].status).toBe("unsupported");
    expect(getRawTheme).not.toHaveBeenCalled();
  });

  it("new when the accessor returns null", async () => {
    const v = await runPreflight(client(), "alpha", "paic", [
      comp({ kind: "theme", raw: { backgroundColor: "#1" } }),
    ]);
    expect(v[0].status).toBe("new");
  });

  it("identical / differs for a value-compared theme", async () => {
    const same = await runPreflight(
      client({ getRawTheme: async () => ({ _id: "z", _rev: "9", backgroundColor: "#1" }) }),
      "alpha",
      "paic",
      [comp({ kind: "theme", id: "t", raw: { _id: "t", backgroundColor: "#1" } })],
    );
    expect(same[0].status).toBe("identical");

    const diff = await runPreflight(
      client({ getRawTheme: async () => ({ backgroundColor: "#2" }) }),
      "alpha",
      "paic",
      [comp({ kind: "theme", raw: { backgroundColor: "#1" } })],
    );
    expect(diff[0].status).toBe("differs");
  });

  it("script existence via getRawScriptByName → exists", async () => {
    const getRawScriptByName = vi.fn(async () => ({ _id: "s", name: "lib" }));
    const v = await runPreflight(client({ getRawScriptByName }), "alpha", "paic", [
      comp({ kind: "script", id: "s", raw: { name: "lib" } }),
    ]);
    expect(v[0].status).toBe("exists");
    expect(getRawScriptByName).toHaveBeenCalledWith("alpha", "lib");
  });

  it("variable/secret discovered-kind mismatch → new", async () => {
    // The bundle is a secret, but getRawEsv discovers a variable of that name.
    const v = await runPreflight(
      client({ getRawEsv: async () => ({ kind: "variable", raw: { _id: "esv-x" } }) }),
      "alpha",
      "paic",
      [comp({ kind: "secret", id: "esv-x", raw: {} })],
    );
    expect(v[0].status).toBe("new");
  });

  it("variable existence when the discovered kind matches → exists", async () => {
    const v = await runPreflight(
      client({ getRawEsv: async () => ({ kind: "variable", raw: { _id: "esv-x" } }) }),
      "alpha",
      "paic",
      [comp({ kind: "variable", id: "esv-x", raw: {} })],
    );
    expect(v[0].status).toBe("exists");
  });

  it("a throwing accessor → error verdict (not a blank plan)", async () => {
    const v = await runPreflight(
      client({ getRawTheme: () => Promise.reject(new Error("boom")) }),
      "alpha",
      "paic",
      [comp({ kind: "theme" })],
    );
    expect(v[0].status).toBe("error");
    expect(v[0].message).toContain("boom");
  });

  it("multi-component bundle → one verdict per component", async () => {
    const v = await runPreflight(client(), "alpha", "paic", [comp({ id: "a" }), comp({ id: "b" })]);
    expect(v).toHaveLength(2);
  });
});
