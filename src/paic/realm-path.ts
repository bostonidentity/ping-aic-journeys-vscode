/**
 * Translate a realm spec into an AM URL path segment.
 *
 *   ""               → "/realms/root"
 *   "/"              → "/realms/root"
 *   "alpha"          → "/realms/root/realms/alpha"
 *   "/alpha"         → "/realms/root/realms/alpha"
 *   "alpha/sub"      → "/realms/root/realms/alpha/realms/sub"
 *
 * Verbatim port of frodo-lib's `getRealmPath` (`utils/ForgeRockUtils.ts`). The
 * leading-slash convention lets callers concatenate `https://host/am/json${realmPath}/...`
 * without thinking about delimiters.
 */
export function getRealmPath(realm: string): string {
  let r = realm || "/";
  if (r.startsWith("/")) r = r.substring(1);
  const segments = ["root", ...r.split("/").filter((s) => s !== "")];
  return `/realms/${segments.join("/realms/")}`;
}
