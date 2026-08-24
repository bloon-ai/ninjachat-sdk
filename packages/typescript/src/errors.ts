/**
 * Typed errors for the NinjaChat SDK.
 *
 * The API returns an OpenAI-compatible envelope:
 *   { error: { message, type, code, param } }
 */

export class NinjaChatError extends Error {
  /** HTTP status (0 for network/timeout errors raised before a response). */
  readonly status: number;
  /** Machine-readable error code (e.g. "insufficient_credits", "rate_limit_exceeded"). */
  readonly code: string;
  /** The X-Request-ID / request_id, when the server produced one. */
  readonly requestId?: string;
  /** OpenAI-style error type (e.g. "invalid_request_error"). */
  readonly type?: string;
  /** The offending parameter, when reported. */
  readonly param?: string | null;
  /** The full parsed error body, for extra fields (balance, retry_after, ...). */
  readonly body?: Record<string, unknown>;

  constructor(opts: {
    message: string;
    status: number;
    code: string;
    requestId?: string;
    type?: string;
    param?: string | null;
    body?: Record<string, unknown>;
  }) {
    super(opts.message);
    this.name = "NinjaChatError";
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId;
    this.type = opts.type;
    this.param = opts.param;
    this.body = opts.body;
  }

  static fromResponse(
    status: number,
    body: unknown,
    headerRequestId?: string | null
  ): NinjaChatError {
    const b = (body ?? {}) as Record<string, unknown>;
    const nested = (b.error ?? {}) as Record<string, unknown>;
    const message =
      (typeof nested.message === "string" && nested.message) ||
      `HTTP ${status}`;
    const code =
      (typeof nested.code === "string" && nested.code) ||
      `http_${status}`;
    const requestId = headerRequestId || undefined;
    return new NinjaChatError({
      message,
      status,
      code,
      requestId,
      type: typeof nested.type === "string" ? nested.type : undefined,
      param: (nested.param as string | null | undefined) ?? null,
      body: b,
    });
  }
}
