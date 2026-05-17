import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../util/vscode-mock")).makeVscodeMock());

// Mock the modules client-cache pulls in so we don't actually mint tokens or
// open axios instances. The cache itself is what we're testing.
vi.mock("@/paic/auth", () => ({
  mintToken: vi.fn(async () => ({
    ok: true,
    accessToken: "fake-token",
    expiresIn: 3600,
    scope: "fr:am:*",
    tokenType: "Bearer",
    grantedScopes: ["fr:am:*"],
    droppedScopes: [],
  })),
}));

vi.mock("@/paic/http", () => ({
  makeHttpClient: vi.fn(() => ({ get: vi.fn(), post: vi.fn() })),
}));

vi.mock("@/paic/client", () => ({
  makePaicClient: vi.fn((opts) => ({
    /** Tag each client so tests can distinguish instances. */
    __http: opts.http,
    listRealms: vi.fn(),
    listJourneys: vi.fn(),
    getJourney: vi.fn(),
    getNode: vi.fn(),
    getScript: vi.fn(),
  })),
}));

import { beforeEach, describe, expect, it } from "vitest";
import type { Connection } from "@/domain/types";
import { makeClientCache } from "@/tenants/client-cache";
import type { TenantsRegistry } from "@/tenants/registry";

function makeFakeRegistry(opts: {
  conns: Connection[];
  jwks: Record<string, string>;
}): TenantsRegistry {
  return {
    list: () => opts.conns,
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    getJwk: (host: string) => Promise.resolve(opts.jwks[host]),
    onDidChange: vi.fn(() => ({ dispose: () => undefined })),
    dispose: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: TenantsRegistry has narrower types
  } as any;
}

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

const HOST = "h.example.com";

describe("ClientCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("get(host) returns the same instance on repeat calls (cache hit)", async () => {
    const cache = makeClientCache({
      registry: makeFakeRegistry({
        conns: [{ host: HOST, saId: "sa-1" }],
        jwks: { [HOST]: '{"kty":"RSA"}' },
      }),
      log: makeFakeLogger(),
    });
    const a = await cache.get(HOST);
    const b = await cache.get(HOST);
    expect(a).toBe(b);
  });

  it("drop(host) evicts — next get(host) mints a new client", async () => {
    const cache = makeClientCache({
      registry: makeFakeRegistry({
        conns: [{ host: HOST, saId: "sa-1" }],
        jwks: { [HOST]: '{"kty":"RSA"}' },
      }),
      log: makeFakeLogger(),
    });
    const a = await cache.get(HOST);
    cache.drop(HOST);
    const b = await cache.get(HOST);
    expect(a).not.toBe(b);
  });

  it("throws a descriptive error when no JWK is in SecretStorage", async () => {
    const cache = makeClientCache({
      registry: makeFakeRegistry({
        conns: [{ host: HOST, saId: "sa-1" }],
        jwks: {},
      }),
      log: makeFakeLogger(),
    });
    await expect(cache.get(HOST)).rejects.toThrow(/No credentials stored/);
  });
});
