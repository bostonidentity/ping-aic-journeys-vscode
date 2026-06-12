/**
 * ESV apply orchestration (TD-7, M9 Phase 4 Batch 2 Slice 2). The "apply" of an
 * ESV change is a tenant-wide environment **restart**: trigger it, then poll
 * `/environment/startup` until `ready` (~3 min observed, ≤10). Client-injected
 * → unit-testable. Mirrors frodo `StartupOps.applyUpdates`.
 */

import type { EsvRestartStatus, PaicClient } from "../paic/client";

export type ApplyClient = Pick<PaicClient, "getStartupStatus" | "applyEsvUpdates">;

export interface EsvApplyResult {
  ok: boolean;
  finalStatus: EsvRestartStatus;
  elapsedS: number;
}

export interface ApplyOptions {
  pollMs?: number;
  timeoutMs?: number;
  maxErrors?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onProgress?: (status: EsvRestartStatus, elapsedS: number) => void;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runEsvApply(
  client: ApplyClient,
  opts: ApplyOptions = {},
): Promise<EsvApplyResult> {
  const pollMs = opts.pollMs ?? 15_000;
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const maxErrors = opts.maxErrors ?? 4;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? (() => Date.now());
  const start = now();
  const elapsed = (): number => Math.round((now() - start) / 1000);

  // Initiate — unless a restart is already in progress (don't double-POST; the
  // POST requires `ready`). This re-check happens here, after the panel's modal.
  let status = await client.getStartupStatus();
  if (status === "ready") {
    try {
      await client.applyEsvUpdates();
      status = "restarting";
    } catch (err) {
      // The POST isn't retried on 5xx (POST isn't idempotent) — but the restart
      // may have started anyway. Re-check: still `ready` → it genuinely failed.
      status = await client.getStartupStatus();
      if (status === "ready") throw err;
    }
  }
  opts.onProgress?.(status, elapsed());

  // Poll until ready / timeout, tolerating CONSECUTIVE errors (reset on success).
  // A transient error here includes a token re-mint failing against the
  // restarting AM runtime — survivable, not fatal.
  let errors = 0;
  while (status !== "ready" && now() - start < timeoutMs) {
    await sleep(pollMs);
    try {
      status = await client.getStartupStatus();
      errors = 0;
      opts.onProgress?.(status, elapsed());
    } catch (e) {
      errors++;
      if (errors > maxErrors) throw e;
      opts.onProgress?.("restarting", elapsed()); // assume still restarting
    }
  }
  return { ok: status === "ready", finalStatus: status, elapsedS: elapsed() };
}
