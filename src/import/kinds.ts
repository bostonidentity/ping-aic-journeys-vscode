import type { BundleKind } from "./parse";

/**
 * Leaf kinds the import can write — Batch 1 atoms (theme / email template /
 * social IdP) + Batch 2 ESVs (variable / secret) + scripts (decision +
 * library). The **single source of truth**: the panel gates writes and the UI
 * gates the Import button on this set, so they can't drift. Journeys are not
 * writable yet.
 */
export const WRITABLE_KINDS: ReadonlySet<BundleKind> = new Set<BundleKind>([
  "theme",
  "emailTemplate",
  "socialIdp",
  "variable",
  "secret",
  "script",
]);
