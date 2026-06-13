/**
 * Import pre-flight (D42 / TD-6, M9 Phase 4 Batch 1 Slice B2). For each bundle
 * component, fetch the target's current version by identity and classify it.
 * Compat gates the fetch (don't REST-call a target that can't accept the kind).
 * The client is injected → unit-testable. Read-only.
 */

import type { PaicClient } from "../paic/client";
import { type ComponentVerdict, classifyCompare } from "./compare";
import { compatFor } from "./compat";
import type { DiscoveredRef } from "./discover";
import type { ImportComponent } from "./parse";

/** The subset of `PaicClient` the pre-flight reads. */
export type PreflightClient = Pick<
  PaicClient,
  | "getRawTheme"
  | "getRawEmailTemplate"
  | "getRawSocialIdp"
  | "getRawScript"
  | "getRawScriptByName"
  | "findRawScriptsByName"
  | "getRawEsv"
  | "listVariables"
  | "listSecrets"
>;

/** Existence verdict for a discovered (info-only) dependency ref — TD-9. The
 * bundle carries no body/value for these, so they're never written; the Plan
 * shows them as "what this script needs on the target". */
export interface RequiredDepVerdict {
  kind: "script" | "esv";
  name: string;
  status: "present" | "missing";
  /** e.g. "variable" / "secret" for an ESV, or "2 on target" for a dup-name. */
  detail?: string;
}

/**
 * The confirm-modal warning for unmet dependency prerequisites (TD-9). Advisory
 * — the bundle can't supply a missing lib/ESV, and a referenced-but-missing dep
 * means an imported script may fail at runtime until the user adds it. Returns
 * "" when nothing is missing (so the caller can concatenate unconditionally).
 */
export function missingDepsNote(requires: readonly RequiredDepVerdict[]): string {
  const missing = requires.filter((d) => d.status === "missing");
  if (missing.length === 0) return "";
  return (
    ` ⚠ ${missing.length} referenced dependency(ies) are missing on the target ` +
    `(${missing.map((d) => d.name).join(", ")}); imported scripts may fail at runtime ` +
    "until these are added."
  );
}

const asRecord = (o: unknown): Record<string, unknown> | null =>
  o && typeof o === "object" ? (o as Record<string, unknown>) : null;

/** A fetched target version + (scripts only) the cross-env reconcile metadata:
 * the resolved target `_id` to write to and how many same-named hits there were. */
interface TargetFetch {
  raw: Record<string, unknown> | null;
  resolvedTargetId?: string;
  targetMatchCount?: number;
}

/** Fetch the target's current version of one component by identity; `raw` is
 * null when absent (→ "new"). Scripts resolve by NAME (their cross-env identity,
 * TD-9) and also report the matched target's `_id` + same-name count. */
async function fetchTarget(
  client: PreflightClient,
  realm: string,
  comp: ImportComponent,
): Promise<TargetFetch> {
  switch (comp.kind) {
    case "theme":
      return { raw: asRecord(await client.getRawTheme(realm, comp.id)) };
    case "emailTemplate":
      return {
        raw: asRecord(await client.getRawEmailTemplate(comp.id.replace(/^emailTemplate\//, ""))),
      };
    case "socialIdp": {
      // Look up by the raw object's `_id` — `getRawSocialIdp` filters on `_id`,
      // which can differ from the display name.
      const idpId = typeof comp.raw._id === "string" ? comp.raw._id : comp.id;
      return { raw: asRecord(await client.getRawSocialIdp(realm, idpId)) };
    }
    case "script": {
      const name = typeof comp.raw.name === "string" ? comp.raw.name : "";
      if (!name) return { raw: null };
      // Name is the cross-env identity; AM allows dup names so collect all hits.
      const hits = await client.findRawScriptsByName(realm, name);
      const first = hits[0];
      return {
        raw: asRecord(first ?? null),
        resolvedTargetId: typeof first?._id === "string" ? first._id : undefined,
        targetMatchCount: hits.length,
      };
    }
    case "variable":
    case "secret": {
      // `getRawEsv` discovers the kind by which endpoint resolves — only a
      // matching kind counts as the same entity.
      const r = await client.getRawEsv(comp.id);
      return { raw: r && r.kind === comp.kind ? asRecord(r.raw) : null };
    }
    case "journey":
      return { raw: null }; // journeys aren't compared in B2
  }
}

async function verdictFor(
  client: PreflightClient,
  realm: string,
  targetKind: "paic" | "onprem",
  comp: ImportComponent,
): Promise<ComponentVerdict> {
  const base = { kind: comp.kind, id: comp.id, displayName: comp.displayName };
  if (compatFor(comp.kind, targetKind) === "unsupported") {
    return { ...base, status: "unsupported" };
  }
  try {
    const { raw, resolvedTargetId, targetMatchCount } = await fetchTarget(client, realm, comp);
    const status = classifyCompare(comp.kind, comp.raw, raw);
    // Script create path (no name match → `new`): the write would fall back to
    // the bundle UUID, but that UUID may already be held by a DIFFERENTLY-NAMED
    // script (rename-after-copy). AM's PUT-by-id would silently overwrite it, so
    // guard here and block instead (TD-9). Name match (resolvedTargetId set) is
    // already handled by reconciliation — only check on a true create.
    if (comp.kind === "script" && status === "new") {
      const collision = await scriptIdCollision(client, realm, comp);
      if (collision) {
        return { ...base, status: "id-collision", message: collision };
      }
    }
    return {
      ...base,
      status,
      ...(resolvedTargetId ? { resolvedTargetId } : {}),
      ...(targetMatchCount === undefined ? {} : { targetMatchCount }),
    };
  } catch (err) {
    return { ...base, status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/** On a script create, is the bundle UUID already occupied on the target by a
 * differently-named script? Returns a human message naming the occupant, or
 * null when the UUID is free (404) — the safe-to-create case. */
async function scriptIdCollision(
  client: PreflightClient,
  realm: string,
  comp: ImportComponent,
): Promise<string | null> {
  const bundleId = typeof comp.raw._id === "string" ? comp.raw._id : comp.id;
  if (!bundleId) return null;
  let existing: Record<string, unknown> | null;
  try {
    existing = asRecord(await client.getRawScript(realm, bundleId));
  } catch {
    return null; // 404 (or any fetch failure) → treat the UUID as free
  }
  if (!existing) return null;
  const occupantName = typeof existing.name === "string" ? existing.name : "(unnamed)";
  return `UUID ${bundleId} is already used by a different script "${occupantName}" on the target`;
}

/** Run the read-only pre-flight for every component. Each runs independently
 * (one fetch failure → that component's `error`, not a blank plan). */
export function runPreflight(
  client: PreflightClient,
  realm: string,
  targetKind: "paic" | "onprem",
  rawComponents: readonly ImportComponent[],
): Promise<ComponentVerdict[]> {
  return Promise.all(rawComponents.map((c) => verdictFor(client, realm, targetKind, c)));
}

/**
 * Existence-check the discovered (info-only) dependency refs against the target
 * — TD-9. Library refs resolve by name; ESV refs match against the tenant's
 * variable + secret lists fetched ONCE (mirrors `walk.ts:ensureEsvIndex`, never
 * per-ref). Read-only; a fetch failure for one ref yields `missing`, not a throw.
 */
export async function discoverDeps(
  client: PreflightClient,
  realm: string,
  refs: readonly DiscoveredRef[],
): Promise<RequiredDepVerdict[]> {
  if (refs.length === 0) return [];

  // Build the dotted-name → kind ESV index once, only if any ESV ref exists.
  let esvIndex: Map<string, "variable" | "secret"> | null = null;
  const needEsv = refs.some((r) => r.kind === "esv");
  if (needEsv) {
    esvIndex = new Map();
    const [vars, secrets] = await Promise.all([
      client.listVariables(realm).catch(() => []),
      client.listSecrets(realm).catch(() => []),
    ]);
    for (const v of vars) esvIndex.set(v.name, "variable");
    for (const s of secrets) esvIndex.set(s.name, "secret");
  }

  return Promise.all(
    refs.map(async (ref): Promise<RequiredDepVerdict> => {
      if (ref.kind === "esv") {
        const k = esvIndex?.get(ref.name);
        return k
          ? { kind: "esv", name: ref.name, status: "present", detail: k }
          : { kind: "esv", name: ref.name, status: "missing" };
      }
      // Library reference — existence by name (the cross-env identity, TD-9).
      try {
        const hits = await client.findRawScriptsByName(realm, ref.name);
        if (hits.length === 0) return { kind: "script", name: ref.name, status: "missing" };
        return {
          kind: "script",
          name: ref.name,
          status: "present",
          ...(hits.length > 1 ? { detail: `${hits.length} on target` } : {}),
        };
      } catch {
        return { kind: "script", name: ref.name, status: "missing" };
      }
    }),
  );
}
