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
  readonly retryable?: boolean;
  readonly responseHeaders?: Record<string, string>;

  constructor(opts: {
    message: string;
    status: number;
    code: string;
    requestId?: string;
    type?: string;
    param?: string | null;
    body?: Record<string, unknown>;
    retryable?: boolean;
    responseHeaders?: Record<string, string>;
  }) {
    super(opts.message);
    this.name = "NinjaChatError";
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId;
    this.type = opts.type;
    this.param = opts.param;
    this.body = opts.body;
    this.retryable = opts.retryable;
    this.responseHeaders = opts.responseHeaders;
  }

  static fromResponse(
    status: number,
    body: unknown,
    headerRequestId?: string | null,
    responseHeaders?: Record<string, string>,
  ): NinjaChatError {
    const b = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const nested = b.error && typeof b.error === "object" ? b.error as Record<string, unknown> : b;
    const message =
      (typeof nested.message === "string" && nested.message) ||
      `HTTP ${status}`;
    const code =
      (typeof nested.code === "string" && nested.code) ||
      `http_${status}`;
    const requestId = headerRequestId || (typeof b.request_id === "string" ? b.request_id : undefined);
    return new NinjaChatError({
      message,
      status,
      code,
      requestId,
      type: typeof nested.type === "string" ? nested.type : undefined,
      param: (nested.param as string | null | undefined) ?? null,
      body: b,
      responseHeaders,
      retryable: typeof nested.retryable === "boolean" ? nested.retryable : typeof b.retryable === "boolean" ? b.retryable : undefined,
    });
  }
}
