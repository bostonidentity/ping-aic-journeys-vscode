import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import { PaicError } from "@/paic/errors";

function makeAxiosError(opts: {
  message?: string;
  status?: number;
  code?: string;
  data?: unknown;
}): AxiosError {
  const err = new AxiosError(opts.message ?? "axios failed", opts.code);
  if (opts.status !== undefined) {
    err.response = {
      status: opts.status,
      statusText: "",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: opts.data,
    };
  }
  return err;
}

describe("PaicError", () => {
  it("wraps AxiosError with response body, extracting error + error_description", () => {
    const axiosErr = makeAxiosError({
      status: 400,
      message: "Request failed with status code 400",
      data: {
        error: "invalid_scope",
        error_description: "Unsupported scope for service account: fr:foo:*",
      },
    });

    const e = PaicError.from(axiosErr);

    expect(e).toBeInstanceOf(PaicError);
    expect(e.status).toBe(400);
    expect(e.errorText).toBe("invalid_scope");
    expect(e.description).toBe("Unsupported scope for service account: fr:foo:*");
    // description wins over errorText and the raw axios message
    expect(e.message).toBe("Unsupported scope for service account: fr:foo:*");
    expect(e.cause).toBe(axiosErr);
  });

  it("extracts the AM/IDM REST envelope message + detail (no OAuth fields)", () => {
    const axiosErr = makeAxiosError({
      status: 400,
      message: "Request failed with status code 400",
      data: {
        code: 400,
        reason: "Bad Request",
        message: "Data validation failed for the attribute, Script",
        detail: { validAttributes: ["script", "_id"] },
      },
    });

    const e = PaicError.from(axiosErr);

    expect(e.status).toBe(400);
    expect(e.description).toBe("Data validation failed for the attribute, Script");
    // the AM message becomes the actionable Error.message (not axios's generic text)
    expect(e.message).toBe("Data validation failed for the attribute, Script");
    expect(e.errorText).toBeUndefined();
    expect((e.detail as { validAttributes?: string[] }).validAttributes).toEqual(["script", "_id"]);
  });

  it("extracts an AM/IDM conflict (409) message", () => {
    const axiosErr = makeAxiosError({
      status: 409,
      message: "Request failed with status code 409",
      data: {
        code: 409,
        reason: "Conflict",
        message: "Script with name login-decision already exist in realm /alpha",
      },
    });

    const e = PaicError.from(axiosErr);

    expect(e.status).toBe(409);
    expect(e.description).toBe("Script with name login-decision already exist in realm /alpha");
    expect(e.message).toBe("Script with name login-decision already exist in realm /alpha");
  });

  it("prefers the OAuth error_description over an AM message when both are present", () => {
    const axiosErr = makeAxiosError({
      status: 400,
      data: {
        error: "invalid_scope",
        error_description: "Unsupported scope for service account: fr:foo:*",
        message: "some AM-shaped message",
      },
    });

    const e = PaicError.from(axiosErr);

    // OAuth wins → the auth-layer scope fallback (reads `.description`) stays correct
    expect(e.description).toBe("Unsupported scope for service account: fr:foo:*");
    expect(e.message).toBe("Unsupported scope for service account: fr:foo:*");
  });

  it("wraps AxiosError without response (network error) — keeps code, no status", () => {
    const axiosErr = makeAxiosError({ message: "connect ECONNREFUSED", code: "ECONNREFUSED" });

    const e = PaicError.from(axiosErr);

    expect(e.status).toBeUndefined();
    expect(e.code).toBe("ECONNREFUSED");
    expect(e.errorText).toBeUndefined();
    expect(e.description).toBeUndefined();
    expect(e.message).toBe("connect ECONNREFUSED");
  });

  it("wraps non-Axios Error preserving message and cause; no http fields", () => {
    const original = new Error("boom");
    const e = PaicError.from(original);

    expect(e.message).toBe("boom");
    expect(e.cause).toBe(original);
    expect(e.status).toBeUndefined();
    expect(e.code).toBeUndefined();
    expect(e.errorText).toBeUndefined();
    expect(e.description).toBeUndefined();
  });

  it("passes through an existing PaicError unchanged", () => {
    const existing = new PaicError("already wrapped", { status: 401 });
    expect(PaicError.from(existing)).toBe(existing);
  });
});
