import { vi } from "vitest";

vi.mock("@/paic/auth", () => ({ mintToken: vi.fn() }));

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePaicAuthStrategy } from "@/auth/paic-strategy";
import { mintToken } from "@/paic/auth";

const mint = vi.mocked(mintToken);

interface LogCall {
  fields: Record<string, unknown>;
  msg: string;
}
function makeCapturingLogger() {
  const calls: LogCall[] = [];
  const rec = (fields: Record<string, unknown>, msg: string) => calls.push({ fields, msg });
  const self = {
    calls,
    trace: rec,
    debug: rec,
    info: rec,
    warn: rec,
    error: rec,
    fatal: rec,
    child: () => self,
    // biome-ignore lint/suspicious/noExplicitAny: pino Logger has many fields we don't exercise
  } as any;
  return self;
}

function mintSuccess(accessToken: string, expiresIn = 3600) {
  return {
    ok: true as const,
    accessToken,
    expiresIn,
    scope: "fr:am:*",
    tokenType: "Bearer",
    grantedScopes: ["fr:am:*"],
    droppedScopes: [],
  };
}

function makeStrategy(log = makeCapturingLogger()) {
  return makePaicAuthStrategy({ host: "openam.example.com", saId: "sa-1", jwk: "{}", log });
}

describe("makePaicAuthStrategy", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it("returns an Authorization Bearer header from a fresh mint", async () => {
    mint.mockResolvedValue(mintSuccess("tok-A"));
    expect(await makeStrategy().getAuthHeaders()).toEqual({ Authorization: "Bearer tok-A" });
  });

  it("caches the token across calls within the TTL", async () => {
    mint.mockResolvedValue(mintSuccess("tok-A"));
    const strategy = makeStrategy();
    await strategy.getAuthHeaders();
    await strategy.getAuthHeaders();
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("re-mints when forceRefresh is set", async () => {
    mint.mockResolvedValueOnce(mintSuccess("tok-A")).mockResolvedValueOnce(mintSuccess("tok-B"));
    const strategy = makeStrategy();
    const h1 = await strategy.getAuthHeaders();
    const h2 = await strategy.getAuthHeaders({ forceRefresh: true });
    expect(h1).toEqual({ Authorization: "Bearer tok-A" });
    expect(h2).toEqual({ Authorization: "Bearer tok-B" });
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it("re-mints when the cached token is within 30s of expiry", async () => {
    vi.useFakeTimers();
    mint
      .mockResolvedValueOnce(mintSuccess("tok-A", 60))
      .mockResolvedValueOnce(mintSuccess("tok-B", 60));
    const strategy = makeStrategy();
    await strategy.getAuthHeaders(); // expiresAt = now + 60s
    vi.advanceTimersByTime(31_000); // now within the 30s margin of expiry
    await strategy.getAuthHeaders();
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it("throws when the mint fails", async () => {
    mint.mockResolvedValue({ ok: false, message: "401 invalid_client" });
    await expect(makeStrategy().getAuthHeaders()).rejects.toThrow(
      /Token mint failed: 401 invalid_client/,
    );
  });

  it("never logs the token", async () => {
    mint.mockResolvedValue(mintSuccess("tok-SECRET-VALUE"));
    const log = makeCapturingLogger();
    await makeStrategy(log).getAuthHeaders();
    const dump = log.calls.map((c: LogCall) => JSON.stringify(c.fields) + c.msg).join("|");
    expect(dump).not.toContain("tok-SECRET-VALUE");
  });
});
