import * as vscode from "vscode";
import type { ClientCache } from "../tenants/client-cache";
import type { Logger } from "../util/logger";

/** URI scheme registered by `PaicScriptFileSystemProvider`. */
export const SCRIPT_URI_SCHEME = "paic-script";

/** Window during which a stat-immediately-followed-by-read reuses the
 * `getScript` HTTP result. Long enough for VS Code's open sequence; short
 * enough that a fresh open after a moment re-fetches. */
const STAT_CACHE_TTL_MS = 5_000;

export interface ParsedScriptUri {
  host: string;
  realm: string;
  scriptId: string;
  /** "js" | "groovy" | "" — drives the editor's language id. */
  ext: string;
}

/** Parse a `paic-script://<host>/<realm>/<scriptId>.<ext>` URI.
 *
 * `<realm>` may itself contain slashes for sub-realms
 * (e.g. `paic-script://h/alpha/customers/script.js` → realm = `alpha/customers`). */
export function parseScriptUri(uri: vscode.Uri): ParsedScriptUri {
  if (uri.scheme !== SCRIPT_URI_SCHEME) {
    throw new Error(`Not a ${SCRIPT_URI_SCHEME} URI: ${uri.toString()}`);
  }
  const host = uri.authority;
  if (!host) {
    throw new Error(`Malformed script URI (missing host): ${uri.toString()}`);
  }
  const parts = uri.path.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Malformed script URI (need <realm>/<scriptId.ext>): ${uri.toString()}`);
  }
  const filename = parts.pop() as string;
  const realm = parts.join("/");
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
  const scriptId = dot > 0 ? filename.slice(0, dot) : filename;
  return { host, realm, scriptId, ext };
}

/** Build a canonical `paic-script://` URI for a known script. The language
 * argument picks the file extension so VS Code's tokenizer auto-detects. */
export function makeScriptUri(
  host: string,
  realm: string,
  scriptId: string,
  language?: string,
): vscode.Uri {
  const ext = language?.toUpperCase() === "GROOVY" ? "groovy" : "js";
  return vscode.Uri.parse(`${SCRIPT_URI_SCHEME}://${host}/${realm}/${scriptId}.${ext}`, true);
}

/** `vscode.FileSystemProvider` that surfaces PAIC script bodies as a real
 * editor tab. Read-only at M2: every mutating method throws `NoPermissions`.
 * Architecturally write-capable — flipping the refusal to a PAIC PUT is the
 * full extent of the future edit story (D17). */
export class PaicScriptFileSystemProvider implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  private readonly log;
  /** Dedupe cache for the VS Code stat-then-read pair emitted on open. */
  private readonly bodyCache = new Map<string, { body: string; expiresAt: number }>();

  constructor(
    private readonly clients: ClientCache,
    logger: Logger,
  ) {
    this.log = logger.child({ component: "providers.scriptFs" });
  }

  watch(): vscode.Disposable {
    // Read-only; no external mutation, so we never fire onDidChangeFile.
    return { dispose: () => undefined };
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const body = await this.fetchBody(uri);
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: Buffer.byteLength(body, "utf8"),
      permissions: vscode.FilePermission.Readonly,
    };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const body = await this.fetchBody(uri);
    return new TextEncoder().encode(body);
  }

  writeFile(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  readDirectory(): never {
    throw vscode.FileSystemError.NoPermissions("readDirectory not supported");
  }

  createDirectory(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  rename(oldUri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(oldUri);
  }

  private async fetchBody(uri: vscode.Uri): Promise<string> {
    const key = uri.toString();
    const now = Date.now();
    const hit = this.bodyCache.get(key);
    if (hit && hit.expiresAt > now) return hit.body;

    const { host, realm, scriptId } = parseScriptUri(uri);

    let client;
    try {
      client = await this.clients.get(host);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(
        { event: "scriptFs.clientUnavailable", host, message },
        "ClientCache.get failed",
      );
      throw vscode.FileSystemError.Unavailable(uri);
    }

    try {
      const script = await client.getScript(realm, scriptId);
      this.bodyCache.set(key, { body: script.body, expiresAt: now + STAT_CACHE_TTL_MS });
      return script.body;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(
        { event: "scriptFs.fetchFailed", host, realm, scriptId, message },
        "getScript failed",
      );
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }
}
