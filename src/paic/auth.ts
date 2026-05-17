import { randomUUID } from "node:crypto";
import { importJWK, type JWK, SignJWT } from "jose";

// Default scope set matches frodo-lib's SERVICE_ACCOUNT_DEFAULT_SCOPES intent
// (broad enough that any usable SA will mint a token; we apply scope-fallback
// retry if the tenant rejects a subset).
const DEFAULT_SCOPES = [
  "fr:am:*",
  "fr:idm:*",
  "fr:idc:esv:*",
  "fr:idc:certificate:*",
  "fr:idc:cookie-domain:*",
  "fr:idc:custom-domain:*",
  "fr:idc:content-security-policy:*",
  "fr:idc:promotion:*",
  "fr:idc:sso-cookie:*",
].join(" ");

export interface MintTokenInput {
  host: string;
  saId: string;
  jwk: string;
  scope?: string;
  fetchImpl?: typeof fetch;
}

export interface MintTokenSuccess {
  ok: true;
  /** Bearer token to send as `Authorization: Bearer <accessToken>`. */
  accessToken: string;
  expiresIn: number;
  scope: string;
  tokenType: string;
  grantedScopes: string[];
  droppedScopes: string[];
}

export interface MintTokenFailure {
  ok: false;
  status?: number;
  error?: string;
  description?: string;
  message: string;
}

export type MintTokenResult = MintTokenSuccess | MintTokenFailure;

export async function mintToken(input: MintTokenInput): Promise<MintTokenResult> {
  const { host, saId, jwk: jwkRaw, scope = DEFAULT_SCOPES } = input;
  const fetchFn = input.fetchImpl ?? fetch;

  let jwk: JWK;
  try {
    jwk = JSON.parse(jwkRaw) as JWK;
  } catch {
    return { ok: false, message: "JWK is not valid JSON." };
  }
  if (!jwk.kty) {
    return { ok: false, message: "JWK is missing required field 'kty'." };
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(host.startsWith("http") ? host : `https://${host}`);
  } catch {
    return { ok: false, message: "Host is not a valid URL." };
  }
  const tokenUrl = `${baseUrl.origin}/am/oauth2/access_token`;

  // PAIC service-account JWKs are RSA; if alg is missing default to RS256 (frodo behavior).
  const alg = jwk.alg ?? "RS256";

  let signedJwt: string;
  try {
    const privateKey = await importJWK(jwk, alg);
    signedJwt = await new SignJWT({})
      .setProtectedHeader({ alg, typ: "JWT" })
      .setIssuer(saId)
      .setSubject(saId)
      .setAudience(tokenUrl)
      .setJti(randomUUID())
      .setExpirationTime("3m")
      .sign(privateKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to sign JWT: ${msg}` };
  }

  const requestedScopes = scope.split(" ").filter(Boolean);
  const first = await postToken(tokenUrl, signedJwt, scope, fetchFn);

  // Scope-fallback retry, matching frodo: on invalid_scope describing
  // "Unsupported scope for service account: <csv>", drop those scopes and retry.
  if (
    !first.ok &&
    first.status === 400 &&
    first.error === "invalid_scope" &&
    first.description?.startsWith("Unsupported scope for service account: ")
  ) {
    const dropped = first.description
      .substring("Unsupported scope for service account: ".length)
      .split(",")
      .map((s) => s.trim());
    const remaining = requestedScopes.filter((s) => !dropped.includes(s));
    if (remaining.length === 0) {
      return first;
    }
    const retry = await postToken(tokenUrl, signedJwt, remaining.join(" "), fetchFn);
    if (retry.ok) {
      retry.droppedScopes = dropped;
      retry.grantedScopes = remaining;
    }
    return retry;
  }

  if (first.ok) {
    first.grantedScopes = requestedScopes;
    first.droppedScopes = [];
  }
  return first;
}

async function postToken(
  url: string,
  jwt: string,
  scope: string,
  fetchFn: typeof fetch,
): Promise<MintTokenResult> {
  const body = new URLSearchParams({
    assertion: jwt,
    client_id: "service-account",
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    scope,
  });

  let resp: Response;
  try {
    resp = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Network error reaching ${url}: ${msg}` };
  }

  const text = await resp.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // body wasn't JSON — leave parsed empty, fall back to status code in message
  }

  if (resp.ok && typeof parsed.access_token === "string") {
    return {
      ok: true,
      accessToken: parsed.access_token,
      expiresIn: typeof parsed.expires_in === "number" ? parsed.expires_in : 0,
      scope: typeof parsed.scope === "string" ? parsed.scope : "",
      tokenType: typeof parsed.token_type === "string" ? parsed.token_type : "Bearer",
      grantedScopes: [],
      droppedScopes: [],
    };
  }

  const errorCode = typeof parsed.error === "string" ? parsed.error : undefined;
  const description =
    typeof parsed.error_description === "string" ? parsed.error_description : undefined;
  return {
    ok: false,
    status: resp.status,
    error: errorCode,
    description,
    message: description
      ? `${errorCode ?? "error"}: ${description}`
      : `HTTP ${resp.status}${errorCode ? ` ${errorCode}` : ""}`,
  };
}
