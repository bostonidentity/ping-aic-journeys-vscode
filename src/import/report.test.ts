import { describe, expect, it } from "vitest";
import type { WriteResult } from "./execute";
import { buildImportReport } from "./report";

const result = (
  kind: WriteResult["kind"],
  id: string,
  status: WriteResult["status"],
  message?: string,
): WriteResult => ({ kind, id, displayName: id, status, ...(message ? { message } : {}) });

const base = {
  host: "h",
  realm: "alpha",
  bundle: "Login.journey.json",
  startedAt: "2026-06-14T00:00:00.000Z",
  finishedAt: "2026-06-14T00:00:05.000Z",
};

describe("buildImportReport", () => {
  it("maps each result to an item with before-verdict from the snapshot (null when absent)", () => {
    const report = buildImportReport({
      ...base,
      results: [result("script", "s1", "overwritten"), result("theme", "t1", "created")],
      beforeSnapshot: new Map([["script:s1", "differs"]]), // theme:t1 absent
    });
    expect(report.items).toEqual([
      {
        type: "script",
        id: "s1",
        name: "s1",
        action: "overwritten",
        before: { verdict: "differs" },
      },
      { type: "theme", id: "t1", name: "t1", action: "created", before: null },
    ]);
  });

  it("carries a per-item message when present", () => {
    const report = buildImportReport({
      ...base,
      results: [result("journey", "MFA", "skipped", 'prerequisite "DeviceCheck" failed')],
      beforeSnapshot: new Map(),
    });
    expect(report.items[0].message).toBe('prerequisite "DeviceCheck" failed');
  });

  it("counts the summary per status", () => {
    const report = buildImportReport({
      ...base,
      results: [
        result("theme", "a", "created"),
        result("theme", "b", "overwritten"),
        result("journey", "c", "skipped"),
        result("script", "d", "failed"),
      ],
      beforeSnapshot: new Map(),
    });
    expect(report.summary).toEqual({ created: 1, overwritten: 1, skipped: 1, failed: 1 });
  });

  it("derives overallStatus: success / partial / failed", () => {
    const of = (results: WriteResult[]) =>
      buildImportReport({ ...base, results, beforeSnapshot: new Map() }).meta.overallStatus;
    expect(of([result("theme", "a", "created")])).toBe("success");
    expect(of([result("theme", "a", "created"), result("theme", "b", "failed")])).toBe("partial");
    expect(of([result("theme", "a", "failed")])).toBe("failed");
    // skipped-only (e.g. all kept-deps) is not a failure → success.
    expect(of([result("journey", "a", "skipped")])).toBe("success");
  });
});
