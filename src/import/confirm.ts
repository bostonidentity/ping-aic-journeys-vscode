/**
 * Import confirm-modal detail text (M9 Phase 4 Batch 3, S9a). Pure. One builder
 * for BOTH the leaf and journey paths so the modal restates the same count
 * vocabulary (`create · overwrite · keep`) the plan's count-summary header shows
 * (D44 — the confirm echoes the plan). No vscode.
 */

export interface ConfirmDetailOpts {
  host: string;
  realm: string;
  create: number;
  overwrite: number;
  /** Journeys only — Keep'd inner journeys (omitted from the text when 0). */
  keep?: number;
  /** Components that couldn't be checked at pre-flight (will be skipped). */
  errorN?: number;
  /** The plan writes an ESV (variable/secret) → mention the separate Apply step. */
  hasEsv?: boolean;
  /** Advisory missing-deps note (from `missingDepsNote`); "" when none. */
  missingNote?: string;
}

/**
 * Build the confirm-modal detail string — the same wording + count vocabulary
 * for leaf and journey imports.
 */
export function buildImportConfirmDetail(opts: ConfirmDetailOpts): string {
  const { host, realm, create, overwrite, keep = 0, errorN = 0, hasEsv = false } = opts;
  const counts = [`create ${create}`, `overwrite ${overwrite}`];
  if (keep > 0) counts.push(`keep ${keep}`);
  return (
    `Import to ${host} / realm ${realm} — ${counts.join(" · ")}. ` +
    "Overwrite replaces the target's current version entirely; this is not transactional " +
    "and cannot be undone." +
    (errorN > 0 ? ` ${errorN} component(s) couldn't be checked and will be skipped.` : "") +
    (hasEsv ? " ESV changes require a separate Apply step before they take effect." : "") +
    (opts.missingNote ?? "")
  );
}
