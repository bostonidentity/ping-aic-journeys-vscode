/**
 * Transfer-UI per-kind presentation metadata (TD-8). Keyed on the transfer
 * `BundleKind` vocabulary — the inspector's `grouping.ts` can't be reused here
 * (it keys on a different `DisplayKind` set and imports extension-domain types,
 * which the React sandbox must not pull in — D21). The codicon names mirror the
 * inspector's icon choices so the two surfaces stay visually consistent.
 *
 * Pure: imports only the `BundleKind` type from the message module.
 */

import type { BundleKind } from "../messages";

interface KindMeta {
  /** Codicon name (the font is loaded in the panel HTML). */
  icon: string;
  /** Short type word shown next to the icon in the Type column. */
  word: string;
  /** Sort rank — mirrors the flat-view KIND_ORDER concept. */
  order: number;
}

const KIND_META: Record<BundleKind, KindMeta> = {
  journey: { icon: "type-hierarchy", word: "Journey", order: 0 },
  script: { icon: "symbol-method", word: "Script", order: 1 },
  theme: { icon: "paintcan", word: "Theme", order: 3 },
  emailTemplate: { icon: "mail", word: "Email template", order: 4 },
  socialIdp: { icon: "link-external", word: "Social IdP", order: 5 },
  variable: { icon: "symbol-variable", word: "ESV var", order: 6 },
  secret: { icon: "lock", word: "ESV secret", order: 7 },
};

export function kindMeta(kind: BundleKind): KindMeta {
  return KIND_META[kind] ?? { icon: "circle-outline", word: kind, order: 99 };
}

/**
 * Sort verdicts by kind (KIND_ORDER), then by display name (case-insensitive).
 * Status does NOT affect order — an Identical row sits in its kind bucket where
 * its name sorts, not floated away. Non-mutating.
 */
export function sortByKindThenName<T extends { kind: BundleKind; displayName: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      kindMeta(a.kind).order - kindMeta(b.kind).order ||
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
  );
}
