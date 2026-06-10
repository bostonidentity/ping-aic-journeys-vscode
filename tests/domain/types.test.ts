import { describe, expect, it } from "vitest";
import { type Connection, normalizeConnection } from "@/domain/types";

describe("normalizeConnection", () => {
  it("defaults a legacy config with no kind to paic", () => {
    // Stored before D41 — no `kind` field. Cast through Connection since the
    // type now requires `kind`, but runtime data from old settings lacks it.
    const legacy = {
      host: "openam.example.com",
      saId: "sa-1",
      name: "Prod",
    } as unknown as Connection;
    expect(normalizeConnection(legacy)).toEqual({
      kind: "paic",
      host: "openam.example.com",
      saId: "sa-1",
      name: "Prod",
    });
  });

  it("omits name when the legacy config had none", () => {
    const legacy = { host: "openam.example.com", saId: "sa-1" } as unknown as Connection;
    const result = normalizeConnection(legacy);
    expect(result).toEqual({ kind: "paic", host: "openam.example.com", saId: "sa-1" });
    expect("name" in result).toBe(false);
  });

  it("passes an explicit paic connection through unchanged", () => {
    const conn: Connection = { kind: "paic", host: "h", saId: "sa-1" };
    expect(normalizeConnection(conn)).toEqual(conn);
  });

  it("passes an onprem connection through unchanged", () => {
    const conn: Connection = {
      kind: "onprem",
      host: "http://openam.example.com:8080",
      username: "amadmin",
      name: "Lab",
    };
    expect(normalizeConnection(conn)).toBe(conn);
  });
});
