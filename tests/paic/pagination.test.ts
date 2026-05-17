import { describe, expect, it, vi } from "vitest";
import { listAllPaged, type PagedResponse } from "@/paic/pagination";

describe("listAllPaged", () => {
  it("returns the result array directly when there is only one page", async () => {
    const fetchPage = vi.fn(
      async (_c: string | null): Promise<PagedResponse<number>> => ({
        result: [1, 2],
        pagedResultsCookie: null,
      }),
    );

    const out = await listAllPaged(fetchPage);

    expect(out).toEqual([1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(null);
  });

  it("follows pagedResultsCookie across multiple pages and concatenates results", async () => {
    const pages: PagedResponse<number>[] = [
      { result: [1, 2], pagedResultsCookie: "a" },
      { result: [3, 4], pagedResultsCookie: "b" },
      { result: [5], pagedResultsCookie: null },
    ];
    let i = 0;
    const fetchPage = vi.fn(async (_c: string | null) => pages[i++]);

    const out = await listAllPaged(fetchPage);

    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    // First call carries null; subsequent calls pass the prior page's cookie.
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([null, "a", "b"]);
  });

  it("exits cleanly on an empty single page", async () => {
    const fetchPage = vi.fn(
      async (_c: string | null): Promise<PagedResponse<number>> => ({
        result: [],
        pagedResultsCookie: null,
      }),
    );

    const out = await listAllPaged(fetchPage);

    expect(out).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
