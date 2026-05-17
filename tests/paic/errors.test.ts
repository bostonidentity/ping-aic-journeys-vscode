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
