import { vi } from "vitest";

vi.mock("vscode", async () => (await import("../util/vscode-mock")).makeVscodeMock());

// Mock the auth-strategy factories so client-cache's job — selecting the right
// strategy by connection kind and wiring the HTTP client — is what's tested,
// without minting tokens or authenticating.
vi.mock("@/auth/paic-strategy", () => ({
  makePaicAuthStrategy: vi.fn(() => ({ getAuthHeaders: vi.fn() })),
}));
vi.mock("@/auth/onprem-strategy", () => ({
  makeOnpremAuthStrategy: vi.fn(() => ({ getAuthHeaders: vi.fn() })),
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
import { makeOnpremAuthStrategy } from "@/auth/onprem-strategy";
import { makePaicAuthStrategy } from "@/auth/paic-strategy";
import type { Connection } from "@/domain/types";
import { makePaicClient } from "@/paic/client";
import { makeHttpClient } from "@/paic/http";
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
const ONPREM_HOST = "http://openam.example.com:8080";

describe("ClientCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("get(host) returns the same instance on repeat calls (cache hit)", async () => {
    const cache = makeClientCache({
      registry: makeFakeRegistry({
        conns: [{ kind: "paic", host: HOST, saId: "sa-1" }],
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
        conns: [{ kind: "paic", host: HOST, saId: "sa-1" }],
        jwks: { [HOST]: '{"kty":"RSA"}' },
      }),
      log: makeFakeLogger(),
    });
    const a = await cache.get(HOST);
    cache.drop(HOST);
    const b = await cache.get(HOST);
    expect(a).not.toBe(b);
  });

  it("throws a descriptive error when no credentials are in SecretStorage", async () => {
    const cache = makeClientCache({
      registry: makeFakeRegistry({
        conns: [{ kind: "paic", host: HOST, saId: "sa-1" }],
        jwks: {},
      }),
      log: makeFakeLogger(),
    });
    await expect(cache.get(HOST)).rejects.toThrow(/No credentials stored/);
  });

  it("builds a paic auth strategy for kind=paic connections", async () => {
    const cache = makeClientCache({
      registry: makeFakeRegistry({
        conns: [{ kind: "paic", host: HOST, saId: "sa-1" }],
        jwks: { [HOST]: "jwk-string" },
      }),
      log: makeFakeLogger(),
    });
    await cache.get(HOST);
    expect(makePaicAuthStrategy).toHaveBeenCalledWith(
      expect.objectContaining({ host: HOST, saId: "sa-1", jwk: "jwk-string" }),
    );
    expect(makeOnpremAuthStrategy).not.toHaveBeenCalled();
    // paic → /am context path, all platform capabilities, https origin baseURL.
    expect(makePaicClient).toHaveBeenCalledWith(
      expect.objectContaining({
        amPath: "/am",
        capabilities: { themes: true, emailTemplates: true, esvs: true },
      }),
    );
    expect(makeHttpClient).toHaveBeenCalledWith(
      expect.objectContaining({ host: "https://h.example.com" }),
    );
  });

  it("builds an onprem auth strategy for kind=onprem connections", async () => {
    const cache = makeClientCache({
      registry: makeFakeRegistry({
        conns: [{ kind: "onprem", host: ONPREM_HOST, username: "amadmin" }],
        jwks: { [ONPREM_HOST]: "admin-pw" },
      }),
      log: makeFakeLogger(),
    });
    await cache.get(ONPREM_HOST);
    expect(makeOnpremAuthStrategy).toHaveBeenCalledWith(
      expect.objectContaining({
        host: ONPREM_HOST,
        username: "amadmin",
        password: "admin-pw",
        amPath: "/am",
      }),
    );
    expect(makePaicAuthStrategy).not.toHaveBeenCalled();
    // onprem → no IDM/IDC, so all platform capabilities disabled; origin baseURL.
    expect(makePaicClient).toHaveBeenCalledWith(
      expect.objectContaining({
        amPath: "/am",
        capabilities: { themes: false, emailTemplates: false, esvs: false },
      }),
    );
    expect(makeHttpClient).toHaveBeenCalledWith(expect.objectContaining({ host: ONPREM_HOST }));
  });

  it("derives a custom AM context path from an onprem base URL with a path", async () => {
    const HOST_WITH_PATH = "http://onprem.example.com:8080/openam";
    const cache = makeClientCache({
      registry: makeFakeRegistry({
        conns: [{ kind: "onprem", host: HOST_WITH_PATH, username: "amadmin" }],
        jwks: { [HOST_WITH_PATH]: "pw" },
      }),
      log: makeFakeLogger(),
    });
    await cache.get(HOST_WITH_PATH);
    // amPath = the URL path; baseURL = the origin (path stripped, no double).
    expect(makeOnpremAuthStrategy).toHaveBeenCalledWith(
      expect.objectContaining({ amPath: "/openam" }),
    );
    expect(makePaicClient).toHaveBeenCalledWith(expect.objectContaining({ amPath: "/openam" }));
    expect(makeHttpClient).toHaveBeenCalledWith(
      expect.objectContaining({ host: "http://onprem.example.com:8080" }),
    );
  });
});
