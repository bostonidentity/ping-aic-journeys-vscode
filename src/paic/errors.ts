import axios, { type AxiosError } from "axios";

export interface PaicErrorFields {
  /** HTTP status (set when the upstream returned a response). */
  status?: number;
  /** Axios code for transport-level failures, e.g. `ECONNREFUSED`, `ETIMEDOUT`. */
  code?: string;
  /** `body.error` from a PAIC OAuth error envelope (e.g. `"invalid_scope"`). */
  errorText?: string;
  /** Human-readable detail: OAuth `error_description`, else the AM/IDM REST
   * `message` (e.g. "Data validation failed for the attribute, Script"). */
  description?: string;
  /** AM/IDM REST `detail` object when present (e.g. `{ validAttributes }` for an
   * "Invalid attribute specified" 400 — readies the future strip-and-retry). */
  detail?: unknown;
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
  readonly detail?: unknown;
  override readonly cause?: unknown;

  constructor(message: string, fields: PaicErrorFields = {}, cause?: unknown) {
    super(message);
    this.name = "PaicError";
    this.status = fields.status;
    this.code = fields.code;
    this.errorText = fields.errorText;
    this.description = fields.description;
    this.detail = fields.detail;
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
      // Two error envelopes funnel through here: the OAuth/token envelope
      // (`{ error, error_description }`) and the AM/IDM REST envelope
      // (`{ code, reason, message, detail }`). Extract both; OAuth wins so the
      // auth-layer scope fallback (which reads `.description`) is unaffected.
      const body = axiosErr.response?.data as
        | { error?: unknown; error_description?: unknown; message?: unknown; detail?: unknown }
        | undefined;
      const errorText = typeof body?.error === "string" ? body.error : undefined;
      const oauthDescription =
        typeof body?.error_description === "string" ? body.error_description : undefined;
      const amMessage = typeof body?.message === "string" ? body.message : undefined;
      const description = oauthDescription ?? amMessage;
      const message = description ?? errorText ?? axiosErr.message ?? fallbackMessage;
      return new PaicError(
        message,
        {
          status: axiosErr.response?.status,
          code: axiosErr.code,
          errorText,
          description,
          detail: body?.detail,
        },
        axiosErr,
      );
    }
    if (err instanceof Error) {
      return new PaicError(err.message || fallbackMessage, {}, err);
    }
    return new PaicError(fallbackMessage, {}, err);
  }
}
