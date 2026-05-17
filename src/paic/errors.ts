import axios, { type AxiosError } from "axios";

export interface PaicErrorFields {
  /** HTTP status (set when the upstream returned a response). */
  status?: number;
  /** Axios code for transport-level failures, e.g. `ECONNREFUSED`, `ETIMEDOUT`. */
  code?: string;
  /** `body.error` from a PAIC OAuth/AM error envelope (e.g. `"invalid_scope"`). */
  errorText?: string;
  /** `body.error_description` from a PAIC OAuth/AM error envelope. */
  description?: string;
}

/**
 * Single error type surfaced from the PAIC transport layer. Callers should
 * never see a raw AxiosError — everything funnels through `PaicError.from()`.
 */
export class PaicError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly errorText?: string;
  readonly description?: string;
  override readonly cause?: unknown;

  constructor(message: string, fields: PaicErrorFields = {}, cause?: unknown) {
    super(message);
    this.name = "PaicError";
    this.status = fields.status;
    this.code = fields.code;
    this.errorText = fields.errorText;
    this.description = fields.description;
    this.cause = cause;
  }

  /**
   * Flatten an unknown error into a `PaicError`. AxiosError fields are
   * extracted into the structured shape; non-Axios errors are wrapped without
   * losing the original (kept on `.cause`).
   */
  static from(err: unknown, fallbackMessage = "PAIC request failed"): PaicError {
    if (err instanceof PaicError) return err;
    // Use the duck-type helper rather than `instanceof AxiosError` — when axios
    // is loaded via multiple module paths (e.g. through axios-mock-adapter in
    // tests) the constructor identity check can be unreliable.
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError;
      const body = axiosErr.response?.data as
        | { error?: unknown; error_description?: unknown }
        | undefined;
      const errorText = typeof body?.error === "string" ? body.error : undefined;
      const description =
        typeof body?.error_description === "string" ? body.error_description : undefined;
      const message = description ?? errorText ?? axiosErr.message ?? fallbackMessage;
      return new PaicError(
        message,
        { status: axiosErr.response?.status, code: axiosErr.code, errorText, description },
        axiosErr,
      );
    }
    if (err instanceof Error) {
      return new PaicError(err.message || fallbackMessage, {}, err);
    }
    return new PaicError(fallbackMessage, {}, err);
  }
}
