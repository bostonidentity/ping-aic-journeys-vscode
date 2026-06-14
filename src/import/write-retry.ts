/**
 * Shared write retry: frodo's `400 "Invalid attribute specified."`
 * strip-and-retry (G2, M9 Phase 4). AM config endpoints (authentication-tree
 * nodes/trees, social IdP) reject an unknown attribute with this envelope +
 * `detail.validAttributes`; the fix is to drop the attributes AM didn't list
 * (keeping `_id`) and retry once. Used by both the journey writer (nodes/tree)
 * and the leaf executor (socialIdp is the one leaf kind that can hit it; the
 * wrap is a harmless no-op for endpoints that never emit the envelope).
 *
 * Pure: no vscode, no axios. The AM `message` arrives on `description` (PD-14).
 */

import type { WriteOutcome } from "../paic/client";
import { PaicError } from "../paic/errors";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * When a PUT fails with AM's `400 "Invalid attribute specified."`, return a copy
 * of `body` keeping only the attributes AM listed as valid (plus `_id`, always
 * preserved). Returns null when the error is anything else — the caller rethrows.
 */
export function stripInvalidAttributes(
  err: unknown,
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!(err instanceof PaicError) || err.status !== 400) return null;
  if (err.description !== "Invalid attribute specified.") return null;
  const valid = isRecord(err.detail) ? err.detail.validAttributes : undefined;
  if (!Array.isArray(valid) || !valid.every((v) => typeof v === "string")) return null;
  const keep = new Set<string>([...(valid as string[]), "_id"]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (keep.has(k)) out[k] = v;
  }
  return out;
}

/** Run a PUT, retrying once on a G2 "Invalid attribute specified." 400 with the
 * invalid attributes stripped; any other error propagates. */
export async function putWithRetry(
  put: (body: Record<string, unknown>) => Promise<WriteOutcome>,
  body: Record<string, unknown>,
): Promise<WriteOutcome> {
  try {
    return await put(body);
  } catch (err) {
    const stripped = stripInvalidAttributes(err, body);
    if (!stripped) throw err;
    return await put(stripped);
  }
}
