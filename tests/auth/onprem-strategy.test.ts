import { describe, expect, it, vi } from "vitest";
import { makeOnpremAuthStrategy } from "@/auth/onprem-strategy";

function makeFakeLogger() {
  const noop = () => undefined;
  const self = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => self,
    // biome-ignore lint/suspicious/noExplicitAny: pino Logger has many fields we don't exercise
  } as any;
  return self;
}

/** Queue of responses + a record of each fetch call (url + init) so tests can
 * assert request shape and call counts. */
function mockFetch(...responses: Array<{ status: number; body: unknown }>) {
  const queue = [...responses];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = queue.shift();
    if (!next) return Promise.reject(new Error("fetchImpl called more times than queued"));
    return Promise.resolve(
      new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  return { fn, calls };
}

const HOST = "http://openam.example.com:8080";

describe("makeOnpremAuthStrategy", () => {
  it("discovers the cookie name, authenticates, and returns a Cookie header", async () => {
    const { fn, calls } = mockFetch(
      { status: 200, body: { cookieName: "iPlanetDirectoryPro" } },
      { status: 200, body: { tokenId: "AAA", successUrl: "/am/console", realm: "/" } },
    );
    const strategy = makeOnpremAuthStrategy({
      host: HOST,
      username: "amadmin",
      password: "pw",
      log: makeFakeLogger(),
      fetchImpl: fn,
    });

    const headers = await strategy.getAuthHeaders();

    expect(headers).toEqual({ Cookie: "iPlanetDirectoryPro=AAA" });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(calls[0].url).toBe(`${HOST}/am/json/serverinfo/*`);
    expect(calls[1].url).toBe(`${HOST}/am/json/realms/root/authenticate`);
  });

  it("sends X-OpenAM-Username / X-OpenAM-Password on the authenticate call", async () => {
    const { fn, calls } = mockFetch(
      { status: 200, body: { cookieName: "c" } },
      { status: 200, body: { tokenId: "T" } },
    );
    await makeOnpremAuthStrategy({
      host: HOST,
      username: "amadmin",
      password: "s3cr3t",
      log: makeFakeLogger(),
      fetchImpl: fn,
    }).getAuthHeaders();

    const authInit = calls[1].init ?? {};
    const h = authInit.headers as Record<string, string>;
    expect(authInit.method).toBe("POST");
    expect(h["X-OpenAM-Username"]).toBe("amadmin");
    expect(h["X-OpenAM-Password"]).toBe("s3cr3t");
  });

  it("caches the session — a second getAuthHeaders does not re-authenticate", async () => {
    const { fn } = mockFetch(
      { status: 200, body: { cookieName: "c" } },
      { status: 200, body: { tokenId: "T" } },
    );
    const strategy = makeOnpremAuthStrategy({
      host: HOST,
      username: "amadmin",
      password: "pw",
      log: makeFakeLogger(),
      fetchImpl: fn,
    });

    await strategy.getAuthHeaders();
    await strategy.getAuthHeaders();

    expect(fn).toHaveBeenCalledTimes(2); // one serverinfo + one authenticate, no more
  });

  it("re-authenticates on forceRefresh but reuses the cached cookie name", async () => {
    const { fn, calls } = mockFetch(
      { status: 200, body: { cookieName: "c" } },
      { status: 200, body: { tokenId: "T1" } },
      { status: 200, body: { tokenId: "T2" } },
    );
    const strategy = makeOnpremAuthStrategy({
      host: HOST,
      username: "amadmin",
      password: "pw",
      log: makeFakeLogger(),
      fetchImpl: fn,
    });

    const first = await strategy.getAuthHeaders();
    const second = await strategy.getAuthHeaders({ forceRefresh: true });

    expect(first).toEqual({ Cookie: "c=T1" });
    expect(second).toEqual({ Cookie: "c=T2" });
    expect(fn).toHaveBeenCalledTimes(3); // serverinfo once + authenticate twice
    expect(calls.filter((c) => c.url.includes("/serverinfo/"))).toHaveLength(1);
  });

  it("throws when serverinfo omits the cookie name", async () => {
    const { fn } = mockFetch({ status: 200, body: {} });
    const strategy = makeOnpremAuthStrategy({
      host: HOST,
      username: "amadmin",
      password: "pw",
      log: makeFakeLogger(),
      fetchImpl: fn,
    });
    await expect(strategy.getAuthHeaders()).rejects.toThrow(/cookie name/i);
  });

  it("throws when authenticate returns no tokenId, and the error excludes the password", async () => {
    const { fn } = mockFetch(
      { status: 200, body: { cookieName: "c" } },
      { status: 401, body: { code: 401, message: "Authentication Failed" } },
    );
    const strategy = makeOnpremAuthStrategy({
      host: HOST,
      username: "amadmin",
      password: "super-secret-pw",
      log: makeFakeLogger(),
      fetchImpl: fn,
    });

    let caught: unknown;
    try {
      await strategy.getAuthHeaders();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/authentication failed/i);
    expect((caught as Error).message).not.toContain("super-secret-pw");
  });

  it("uses an injected amPath for the serverinfo + authenticate URLs (D41 Slice 3)", async () => {
    const { fn, calls } = mockFetch(
      { status: 200, body: { cookieName: "c" } },
      { status: 200, body: { tokenId: "T" } },
    );
    await makeOnpremAuthStrategy({
      host: "http://openam.example.com:8080/openam",
      username: "amadmin",
      password: "pw",
      amPath: "/openam",
      log: makeFakeLogger(),
      fetchImpl: fn,
    }).getAuthHeaders();

    expect(calls[0].url).toBe("http://openam.example.com:8080/openam/json/serverinfo/*");
    expect(calls[1].url).toBe(
      "http://openam.example.com:8080/openam/json/realms/root/authenticate",
    );
  });
});
