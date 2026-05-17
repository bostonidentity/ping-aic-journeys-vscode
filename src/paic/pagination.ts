export interface PagedResponse<T> {
  result: T[];
  pagedResultsCookie?: string | null;
}

/**
 * Drain a PAIC `?_queryFilter=true` endpoint to a single array, transparently
 * following `pagedResultsCookie`. The caller supplies one fetch function that
 * returns a page given a cookie (`null` for the first request).
 *
 *   const all = await listAllPaged((cookie) => client.listJourneysPage(realm, cookie));
 */
export async function listAllPaged<T>(
  fetchPage: (cookie: string | null) => Promise<PagedResponse<T>>,
): Promise<T[]> {
  const out: T[] = [];
  let cookie: string | null = null;
  do {
    const page = await fetchPage(cookie);
    out.push(...page.result);
    cookie = page.pagedResultsCookie ?? null;
  } while (cookie);
  return out;
}
