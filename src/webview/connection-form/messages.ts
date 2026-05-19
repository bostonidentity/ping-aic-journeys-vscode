/**
 * Typed message protocol between the extension host and the connection-form
 * webview (React). Direction is encoded in the union name:
 *   - `W2E` — webview → extension (form submits / cancels / requests Test Connection)
 *   - `E2W` — extension → webview (Test Connection results)
 *
 * Initial payload (mode + initial values + existingHosts) is embedded in the
 * page via `data-paic-payload` on the mount div — no init message needed.
 */

export interface ConnectionFormData {
  host: string;
  saId: string;
  name?: string;
  jwk?: string;
}

export interface ConnectionFormInitial {
  host: string;
  saId: string;
  name?: string;
}

export interface ConnectionFormPayload {
  mode: "add" | "edit";
  initial: ConnectionFormInitial | null;
  existingHosts: string[];
}

export type W2E =
  | { type: "save"; data: ConnectionFormData }
  | { type: "cancel" }
  | { type: "validate"; data: ConnectionFormData; requestId: number };

export type E2W =
  | {
      type: "validateResult";
      requestId: number;
      ok: true;
      expiresIn: number;
      droppedScopes: string[];
    }
  | { type: "validateResult"; requestId: number; ok: false; message: string };

export function isW2E(m: unknown): m is W2E {
  if (!m || typeof m !== "object") return false;
  const t = (m as { type?: unknown }).type;
  return t === "save" || t === "cancel" || t === "validate";
}
