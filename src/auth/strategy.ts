/**
 * D41 — auth-strategy seam. An `AuthStrategy` answers one question for the
 * transport: "what HTTP headers authenticate this request, and how do I get
 * fresh ones?" It hides Bearer-vs-Cookie (PAIC vs on-prem AM) from
 * `src/paic/http.ts`, which stays a dumb header-merger.
 *
 * Pure TS — no `vscode`, no `axios`. Implementations use `fetch` (they run
 * before the authenticated HTTP client exists), mirroring `src/paic/auth.ts`.
 */
export interface AuthStrategy {
  /**
   * Resolve the auth header(s) to merge onto an outgoing request. The transport
   * merges the returned map verbatim — it never interprets the scheme.
   *
   * `forceRefresh: true` is the transport's 401 self-heal signal: the strategy
   * MUST discard any cached credential and obtain a fresh one.
   */
  getAuthHeaders(opts?: { forceRefresh?: boolean }): Promise<Record<string, string>>;
}
