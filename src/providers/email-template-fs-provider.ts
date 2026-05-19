import * as vscode from "vscode";
import type { ClientCache } from "../tenants/client-cache";
import type { Logger } from "../util/logger";

/** URI scheme registered by `PaicEmailTemplateFileSystemProvider`. */
export const EMAIL_TEMPLATE_URI_SCHEME = "paic-email-template";

/** Stat-then-read dedupe window (same shape as scriptFs's 5s). */
const STAT_CACHE_TTL_MS = 5_000;

export interface ParsedEmailTemplateUri {
  host: string;
  /** Template slug, e.g. `resetPassword`. */
  name: string;
  /** Locale code, e.g. `en`, `fr`. */
  locale: string;
}

/** Parse a `paic-email-template://<host>/<name>/<locale>.html` URI. */
export function parseEmailTemplateUri(uri: vscode.Uri): ParsedEmailTemplateUri {
  if (uri.scheme !== EMAIL_TEMPLATE_URI_SCHEME) {
    throw new Error(`Not a ${EMAIL_TEMPLATE_URI_SCHEME} URI: ${uri.toString()}`);
  }
  const host = uri.authority;
  if (!host) {
    throw new Error(`Malformed email-template URI (missing host): ${uri.toString()}`);
  }
  const parts = uri.path.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Malformed email-template URI (need <name>/<locale.html>): ${uri.toString()}`);
  }
  const filename = parts.pop() as string;
  const name = parts.join("/");
  const dot = filename.lastIndexOf(".");
  const locale = dot > 0 ? filename.slice(0, dot) : filename;
  return { host, name, locale };
}

/** Build a canonical `paic-email-template://` URI. The filename ends in
 * `.html` so VS Code's HTML language mode kicks in for syntax highlight,
 * folding, find/replace. */
export function makeEmailTemplateUri(host: string, name: string, locale: string): vscode.Uri {
  return vscode.Uri.parse(
    `${EMAIL_TEMPLATE_URI_SCHEME}://${host}/${encodeURIComponent(name)}/${encodeURIComponent(locale)}.html`,
    true,
  );
}

/** `vscode.FileSystemProvider` that surfaces PAIC email-template bodies as a
 * real editor tab. Read-only — every mutating method throws `NoPermissions`.
 * Mirrors `PaicScriptFileSystemProvider`. */
export class PaicEmailTemplateFileSystemProvider implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  private readonly log;
  private readonly bodyCache = new Map<string, { body: string; expiresAt: number }>();

  constructor(
    private readonly clients: ClientCache,
    logger: Logger,
  ) {
    this.log = logger.child({ component: "providers.emailTemplateFs" });
  }

  watch(): vscode.Disposable {
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

    const { host, name, locale } = parseEmailTemplateUri(uri);

    let client: Awaited<ReturnType<ClientCache["get"]>>;
    try {
      client = await this.clients.get(host);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(
        { event: "emailTemplateFs.clientUnavailable", host, message },
        "ClientCache.get failed",
      );
      throw vscode.FileSystemError.Unavailable(uri);
    }

    try {
      const tpl = await client.getEmailTemplate(name);
      if (!tpl) {
        this.log.warn(
          { event: "emailTemplateFs.notFound", host, name },
          "Email template not found",
        );
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      const body = tpl.message?.[locale];
      if (body === undefined) {
        this.log.warn(
          {
            event: "emailTemplateFs.localeMissing",
            host,
            name,
            locale,
            availableLocales: Object.keys(tpl.message ?? {}),
          },
          "Locale not present in email template",
        );
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      this.bodyCache.set(key, { body, expiresAt: now + STAT_CACHE_TTL_MS });
      return body;
    } catch (err) {
      // Re-throw FileSystemError untouched (preserves NoPermissions/FileNotFound).
      if (err && typeof err === "object" && "code" in err) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(
        { event: "emailTemplateFs.fetchFailed", host, name, locale, message },
        "getEmailTemplate failed",
      );
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }
}
