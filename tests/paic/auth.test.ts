import { exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { mintToken } from "@/paic/auth";

const HOST = "openam-tenant.example.forgeblocks.com";
const SA_ID = "00000000-0000-0000-0000-000000000000";

// Real RSA JWK shared by every test in this file — generated once because
// keygen is slow (~150 ms).
let JWK_JSON: string;

beforeAll(async () => {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(privateKey);
  jwk.alg = "RS256";
  jwk.use = "sig";
  JWK_JSON = JSON.stringify(jwk);
});

function mockFetch(...responses: Array<{ status: number; body: unknown }>) {
  const queue = [...responses];
  return vi.fn((_url: string | URL | Request, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) return Promise.reject(new Error("fetchImpl called more times than queued"));
    return Promise.resolve(
      new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

describe("mintToken", () => {
  it("returns the access token on a successful mint", async () => {
    const fetchImpl = mockFetch({
      status: 200,
      body: {
        access_token: "fake-bearer",
        expires_in: 899,
        scope: "fr:am:* fr:idm:*",
        token_type: "Bearer",
      },
    });

    const result = await mintToken({ host: HOST, saId: SA_ID, jwk: JWK_JSON, fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accessToken).toBe("fake-bearer");
      expect(result.expiresIn).toBe(899);
      expect(result.tokenType).toBe("Bearer");
      expect(result.droppedScopes).toEqual([]);
    }
  });

  it("retries with a reduced scope set on 400 invalid_scope and records dropped scopes", async () => {
    const fetchImpl = mockFetch(
      {
        status: 400,
        body: {
          error: "invalid_scope",
          error_description:
            "Unsupported scope for service account: fr:idc:promotion:*,fr:idc:sso-cookie:*",
        },
      },
      {
        status: 200,
        body: {
          access_token: "fake-bearer-2",
          expires_in: 900,
          scope: "fr:am:* fr:idm:*",
          token_type: "Bearer",
        },
      },
    );

    const result = await mintToken({ host: HOST, saId: SA_ID, jwk: JWK_JSON, fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accessToken).toBe("fake-bearer-2");
      expect(result.droppedScopes).toEqual(["fr:idc:promotion:*", "fr:idc:sso-cookie:*"]);
      expect(result.grantedScopes).not.toContain("fr:idc:promotion:*");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns the original failure when scope-fallback would leave nothing", async () => {
    // Tenant rejects every scope we asked for.
    const fetchImpl = mockFetch({
      status: 400,
      body: {
        error: "invalid_scope",
        error_description:
          "Unsupported scope for service account: fr:am:*,fr:idm:*,fr:idc:esv:*,fr:idc:certificate:*,fr:idc:cookie-domain:*,fr:idc:custom-domain:*,fr:idc:content-security-policy:*,fr:idc:promotion:*,fr:idc:sso-cookie:*",
      },
    });

    const result = await mintToken({ host: HOST, saId: SA_ID, jwk: JWK_JSON, fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("invalid_scope");
      expect(result.status).toBe(400);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns a failure when the JWK isn't valid JSON", async () => {
    const fetchImpl = vi.fn();
    const result = await mintToken({
      host: HOST,
      saId: SA_ID,
      jwk: "{not-json",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/JWK is not valid JSON/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a failure when the JWK is missing required field 'kty'", async () => {
    const fetchImpl = vi.fn();
    const result = await mintToken({
      host: HOST,
      saId: SA_ID,
      jwk: JSON.stringify({ alg: "RS256" }),
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/missing required field 'kty'/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a failure on a 401 invalid_client", async () => {
    const fetchImpl = mockFetch({
      status: 401,
      body: { error: "invalid_client", error_description: "Client authentication failed" },
    });
    const result = await mintToken({ host: HOST, saId: SA_ID, jwk: JWK_JSON, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toBe("invalid_client");
      expect(result.description).toBe("Client authentication failed");
    }
  });

  it("falls back to status-code message when the response body isn't JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("Service Unavailable", { status: 503 }));
    const result = await mintToken({ host: HOST, saId: SA_ID, jwk: JWK_JSON, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.message).toMatch(/HTTP 503/);
    }
  });

  it("wraps a fetch network error as a failure with a descriptive message", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
    const result = await mintToken({ host: HOST, saId: SA_ID, jwk: JWK_JSON, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Network error reaching/);
  });

  it("treats a host without scheme as https://", async () => {
    const fetchImpl = mockFetch({
      status: 200,
      body: { access_token: "tok", expires_in: 60, scope: "", token_type: "Bearer" },
    });
    await mintToken({ host: HOST, saId: SA_ID, jwk: JWK_JSON, fetchImpl });
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toBe(`https://${HOST}/am/oauth2/access_token`);
  });
});
