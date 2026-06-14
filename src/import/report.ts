/**
 * Import result report (M9 Phase 4 Batch 3, S11 / PD-17). Pure. Builds the
 * structured JSON the panel offers as a "Download report" download after a run —
 * a per-item audit (outcome + pre-write `before`) for success or partial runs.
 *
 * `before` is the frozen-snapshot verdict captured at pre-flight (PD-11), never
 * reconstructed (the target may have drifted since). It's an object so a future
 * quick-rollback can grow it to carry the prior content without a format change.
 * Pure: the clock is passed in (`startedAt`/`finishedAt`).
 */

import type { WriteResult, WriteStatus } from "./execute";
import type { BundleKind } from "./parse";

export interface ReportItem {
  type: BundleKind;
  id: string;
  name: string;
  /** What happened to this item. */
  action: WriteStatus;
  /** The target's state at freeze — verdict only today; shaped for rollback. */
  before: { verdict: string } | null;
  message?: string;
}

export interface ImportReport {
  meta: {
    host: string;
    realm: string;
    bundle: string;
    startedAt: string;
    finishedAt: string;
    overallStatus: "success" | "partial" | "failed";
  };
  summary: { created: number; overwritten: number; skipped: number; failed: number };
  items: ReportItem[];
}

export interface BuildReportInput {
  host: string;
  realm: string;
  /** The source bundle file name (provenance). */
  bundle: string;
  startedAt: string;
  finishedAt: string;
  results: readonly WriteResult[];
  /** The frozen pre-flight snapshot (`${kind}:${id}` → verdict). */
  beforeSnapshot: ReadonlyMap<string, string>;
}

/** Build the downloadable import report from the run's results + the frozen
 * target snapshot. */
export function buildImportReport(input: BuildReportInput): ImportReport {
  const items: ReportItem[] = input.results.map((r) => {
    const verdict = input.beforeSnapshot.get(`${r.kind}:${r.id}`);
    return {
      type: r.kind,
      id: r.id,
      name: r.displayName,
      action: r.status,
      before: verdict === undefined ? null : { verdict },
      ...(r.message ? { message: r.message } : {}),
    };
  });
  const count = (s: WriteStatus): number => input.results.filter((r) => r.status === s).length;
  const summary = {
    created: count("created"),
    overwritten: count("overwritten"),
    skipped: count("skipped"),
    failed: count("failed"),
  };
  const succeeded = summary.created + summary.overwritten;
  const overallStatus = summary.failed > 0 ? (succeeded > 0 ? "partial" : "failed") : "success";
  return {
    meta: {
      host: input.host,
      realm: input.realm,
      bundle: input.bundle,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      overallStatus,
    },
    summary,
    items,
  };
}
