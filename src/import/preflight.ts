/**
 * Import pre-flight (D42 / TD-6, M9 Phase 4 Batch 1 Slice B2). For each bundle
 * component, fetch the target's current version by identity and classify it.
 * Compat gates the fetch (don't REST-call a target that can't accept the kind).
 * The client is injected → unit-testable. Read-only.
 */

import type { PaicClient } from "../paic/client";
import { type ComponentVerdict, classifyCompare } from "./compare";
import { compatFor } from "./compat";
import type { ImportComponent } from "./parse";

/** The subset of `PaicClient` the pre-flight reads. */
export type PreflightClient = Pick<
  PaicClient,
  "getRawTheme" | "getRawEmailTemplate" | "getRawSocialIdp" | "getRawScriptByName" | "getRawEsv"
>;

const asRecord = (o: unknown): Record<string, unknown> | null =>
  o && typeof o === "object" ? (o as Record<string, unknown>) : null;

/** Fetch the target's current version of one component by identity; null when
 * absent (→ "new"). All accessors are null-on-absence except scripts, which
 * resolve by name (`getRawScript` throws on 404). */
async function fetchTarget(
  client: PreflightClient,
  realm: string,
  comp: ImportComponent,
): Promise<Record<string, unknown> | null> {
  switch (comp.kind) {
    case "theme":
      return asRecord(await client.getRawTheme(realm, comp.id));
    case "emailTemplate":
      return asRecord(await client.getRawEmailTemplate(comp.id.replace(/^emailTemplate\//, "")));
    case "socialIdp": {
      // Look up by the raw object's `_id` — `getRawSocialIdp` filters on `_id`,
      // which can differ from the display name.
      const idpId = typeof comp.raw._id === "string" ? comp.raw._id : comp.id;
      return asRecord(await client.getRawSocialIdp(realm, idpId));
    }
    case "script": {
      const name = typeof comp.raw.name === "string" ? comp.raw.name : "";
      return name ? asRecord(await client.getRawScriptByName(realm, name)) : null;
    }
    case "variable":
    case "secret": {
      // `getRawEsv` discovers the kind by which endpoint resolves — only a
      // matching kind counts as the same entity.
      const r = await client.getRawEsv(comp.id);
      return r && r.kind === comp.kind ? asRecord(r.raw) : null;
    }
    case "journey":
      return null; // journeys aren't compared in B2
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
    const targetRaw = await fetchTarget(client, realm, comp);
    return { ...base, status: classifyCompare(comp.kind, comp.raw, targetRaw) };
  } catch (err) {
    return { ...base, status: "error", message: err instanceof Error ? err.message : String(err) };
  }
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
