import * as vscode from "vscode";

/** URI scheme registered by `PaicBundleContentProvider`. */
export const BUNDLE_URI_SCHEME = "paic-bundle";

/** Build a `paic-bundle://<key>.<ext>` URI for content registered via
 * `PaicBundleContentProvider.set(key, text)`. The key is opaque (a bundle
 * component key like `script:<uuid>`); it's URI-encoded into a single path
 * segment so slashes/colons survive. */
export function makeBundleUri(key: string, ext = "js"): vscode.Uri {
  return vscode.Uri.parse(`${BUNDLE_URI_SCHEME}://content/${encodeURIComponent(key)}.${ext}`, true);
}

/**
 * Serves arbitrary in-memory text as a read-only editor document (TD-11) — used
 * as the RIGHT side of the import Diff (the uploaded bundle component's source),
 * paired with the live target on the LEFT via `paic-script://`. The bundle is
 * extension-side only, so the transfer panel `set()`s the component's source
 * keyed by its bundle key, then opens `makeBundleUri(key)` in `vscode.diff`.
 *
 * Read-only by construction (a `TextDocumentContentProvider` only ever provides
 * content; VS Code can't write back through it).
 */
export class PaicBundleContentProvider implements vscode.TextDocumentContentProvider {
  private readonly byKey = new Map<string, string>();

  /** Register content under a key; returns the URI to open. */
  set(key: string, text: string, ext = "js"): vscode.Uri {
    this.byKey.set(key, text);
    return makeBundleUri(key, ext);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    // Path is `/<encodedKey>.<ext>` — strip the leading slash + extension.
    const seg = uri.path.replace(/^\//, "").replace(/\.[^.]+$/, "");
    const key = decodeURIComponent(seg);
    return this.byKey.get(key) ?? "";
  }
}
