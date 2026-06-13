/**
 * Import execute (D43, M9 Phase 4 Batch 1 Slice C) — the only code that writes
 * to a tenant. Writes each atom-leaf component (verdict New/Differs) through
 * the injected client and reports a per-component result. **Sequential** (theme
 * writes splice the same `themerealm` doc, so parallel would self-race);
 * attempt-all (one failure doesn't stop the rest; there is no rollback).
 */

import type { PaicClient, WriteOutcome } from "../paic/client";
import { PaicError } from "../paic/errors";
import type { BundleKind, ImportComponent } from "./parse";
import {
  idpNeedsSecret,
  toEmailWrite,
  toIdpWrite,
  toScriptWrite,
  toSecretWrite,
  toThemeWrite,
  toVariableWrite,
} from "./write";

export type WriteStatus = "created" | "overwritten" | "skipped" | "failed";

export interface WriteResult {
  kind: BundleKind;
  id: string;
  displayName: string;
  status: WriteStatus;
  message?: string;
}

export interface WritePlanItem {
  component: ImportComponent;
  /** From the fresh pre-flight — New → create, Differs → overwrite. */
  verdict: "new" | "differs";
  /** Re-supplied secret — idp `clientSecret` (plaintext) or an ESV secret's
   * value (plaintext, base64-encoded by the transform). Collected via
   * `showInputBox`. */
  secret?: string;
  /** Scripts only — the name-matched target's `_id` (TD-9). When set, the write
   * reconciles to this UUID (overwrite in place) instead of the bundle's, so a
   * same-named/different-UUID target isn't duplicated. */
  resolvedTargetId?: string;
}

/** The subset of `PaicClient` the executor writes through. */
export type ExecuteClient = Pick<
  PaicClient,
  | "writeTheme"
  | "writeEmailTemplate"
  | "writeSocialIdp"
  | "writeEsvVariable"
  | "writeEsvSecret"
  | "writeScript"
>;

async function writeOne(
  client: ExecuteClient,
  realm: string,
  item: WritePlanItem,
): Promise<WriteResult> {
  const { component } = item;
  const base = { kind: component.kind, id: component.id, displayName: component.displayName };
  try {
    let outcome: WriteOutcome;
    switch (component.kind) {
      case "theme":
        outcome = await client.writeTheme(realm, toThemeWrite(component.raw));
        break;
      case "emailTemplate": {
        const { name, body } = toEmailWrite(component.raw);
        outcome = await client.writeEmailTemplate(name, body);
        break;
      }
      case "socialIdp": {
        if (idpNeedsSecret(component.raw) && !item.secret) {
          // Never PUT a blank secret over a working one.
          return { ...base, status: "skipped", message: "no client secret supplied" };
        }
        const { typeId, id, body } = toIdpWrite(component.raw, item.secret);
        outcome = await client.writeSocialIdp(realm, typeId, id, body);
        break;
      }
      case "variable":
        // The variable's value is in the bundle (`valueBase64`) — written directly.
        outcome = await client.writeEsvVariable(component.id, toVariableWrite(component.raw));
        break;
      case "script":
        // Body is in the bundle (no secret prompt). Reconcile to the target's
        // own UUID when the name-match resolved one (TD-9) so a same-named/
        // different-UUID target is overwritten in place; fall back to the bundle
        // UUID only on a true create. Name is the cross-env identity.
        outcome = await client.writeScript(
          realm,
          item.resolvedTargetId ?? component.id,
          toScriptWrite(component.raw),
        );
        break;
      case "secret": {
        if (!item.secret) {
          return { ...base, status: "skipped", message: "no value supplied" };
        }
        try {
          outcome = await client.writeEsvSecret(
            component.id,
            toSecretWrite(component.raw, item.secret),
          );
        } catch (err) {
          // Create-only + a TOCTOU race → 400 "already exists". That satisfies
          // intent (the secret is present); report it skipped, not failed. Real
          // validation 400s (bad base64/encoding) fall through to `failed`.
          if (
            err instanceof PaicError &&
            err.status === 400 &&
            /already exists/i.test(err.description ?? err.message)
          ) {
            return {
              ...base,
              status: "skipped",
              message: "already present (created concurrently)",
            };
          }
          throw err;
        }
        break;
      }
      default:
        return {
          ...base,
          status: "skipped",
          message: `import not supported for ${component.kind}`,
        };
    }
    return { ...base, status: outcome };
  } catch (err) {
    return { ...base, status: "failed", message: err instanceof Error ? err.message : String(err) };
  }
}

export async function runExecute(
  client: ExecuteClient,
  realm: string,
  items: readonly WritePlanItem[],
): Promise<WriteResult[]> {
  const results: WriteResult[] = [];
  for (const item of items) {
    results.push(await writeOne(client, realm, item));
  }
  return results;
}
