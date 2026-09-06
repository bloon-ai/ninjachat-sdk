import { NinjaChatError } from "./errors.js";

export const DEFAULT_BASE_URL = "https://www.ninjachat.ai/api/v1";

export interface NinjaChatOptions {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  /** Deadline per attempt, including reading its response body. */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
  /** Exposes your secret key to users. Prefer a server-side proxy. */
  dangerouslyAllowBrowser?: boolean;
}

export interface RequestOptions {
  idempotencyKey?: string;
  maxRetries?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface TransportRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  supportsIdempotency?: boolean;
  idempotentMethod?: boolean;
  stream?: boolean;
  options?: RequestOptions;
  timeoutMs?: number;
}

export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch {
    throw new NinjaChatError({ message: "baseUrl must be an absolute URL.", status: 0, code: "invalid_base_url" });
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new NinjaChatError({ message: "baseUrl must use HTTPS, except on localhost.", status: 0, code: "insecure_base_url" });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new NinjaChatError({ message: "baseUrl cannot contain credentials, a query, or a fragment.", status: 0, code: "invalid_base_url" });
  }
  return url.toString().replace(/\/+$/, "");
}

function abortError(timeout = false): NinjaChatError {
  return new NinjaChatError({ message: timeout ? "Request timed out." : "Request aborted.", status: 0, code: timeout ? "timeout" : "aborted" });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const finish = () => { signal?.removeEventListener("abort", cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); reject(abortError()); };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

function retryDelay(response: Response | null, attempt: number): number {
  const value = response?.headers.get("retry-after");
  if (value) {
    const seconds = Number(value);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
    if (Number.isFinite(ms)) return Math.min(30_000, Math.max(0, ms));
  }
  return Math.min(30_000, 500 * 2 ** attempt * (1 + Math.random()));
}

async function newIdempotencyKey(): Promise<string> {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Node 18 exposes randomUUID through its module but not global Web Crypto.
  // Keep this fallback lazy so browser/edge bundles use their native crypto.
  const nodeCrypto = "node:crypto";
  const { randomUUID } = await import(nodeCrypto);
  return randomUUID();
}

/** Shared HTTP transport. Adapters should translate protocols, not retry billing independently. */
export async function parseJsonResponse<T>(response: Response): Promise<T> {
  try { return await response.json() as T; } catch (error) {
    if (error instanceof NinjaChatError) throw error;
    throw new NinjaChatError({ message: "The API returned an invalid JSON response.", status: response.status, code: "invalid_response", requestId: response.headers.get("x-request-id") ?? undefined });
  }
}

export class NinjaChatTransport {
  readonly #apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly headers: Record<string, string>;

  constructor(options: NinjaChatOptions) {
    if (!options?.apiKey) throw new NinjaChatError({ message: "Missing apiKey. Create one at https://www.ninjachat.ai/developers/keys", status: 0, code: "missing_api_key" });
    if (typeof window !== "undefined" && typeof document !== "undefined" && !options.dangerouslyAllowBrowser) {
      throw new NinjaChatError({ message: "Secret NinjaChat API keys must not be used in browser code. Use a server-side proxy.", status: 0, code: "browser_api_key_forbidden" });
    }
    this.#apiKey = options.apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.maxRetries = options.maxRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.headers = options.headers ?? {};
  }

  async requestJson<T>(request: TransportRequest): Promise<T> {
    return parseJsonResponse<T>(await this.requestRaw(request));
  }

  async requestRaw(request: TransportRequest): Promise<Response> {
    const options = request.options ?? {};
    if (options.signal?.aborted) throw abortError();
    const retries = options.maxRetries ?? this.maxRetries;
    const timeoutMs = options.timeoutMs ?? request.timeoutMs ?? this.timeoutMs;
    if (!Number.isInteger(retries) || retries < 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new NinjaChatError({ message: "maxRetries must be a nonnegative integer and timeoutMs must be positive.", status: 0, code: "invalid_options" });
    }
    if (!request.path.startsWith("/") || request.path.startsWith("//")) {
      throw new NinjaChatError({ message: "Request path must be relative to the API base URL.", status: 0, code: "invalid_path" });
    }
    const url = new URL(this.baseUrl + request.path);
    for (const [key, value] of Object.entries(request.query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
    const headers = new Headers({ ...this.headers, ...options.headers });
    headers.set("authorization", `Bearer ${this.#apiKey}`);
    headers.set("accept", request.stream ? "text/event-stream" : "application/json");
    if (request.body !== undefined) headers.set("content-type", "application/json");
    const idempotencyKey = options.idempotencyKey ?? headers.get("idempotency-key") ?? (request.supportsIdempotency && retries > 0 ? await newIdempotencyKey() : undefined);
    if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
    const retrySafe = request.idempotentMethod || (request.supportsIdempotency && Boolean(idempotencyKey));
    const attempts = retrySafe ? retries + 1 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (options.signal?.aborted) throw abortError();
      const controller = new AbortController();
      let timedOut = false;
      const cancel = () => controller.abort(abortError(timedOut));
      const timer = setTimeout(() => { timedOut = true; cancel(); }, timeoutMs);
      options.signal?.addEventListener("abort", cancel, { once: true });
      const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", cancel); };
      let response: Response;
      try {
        const pending = Promise.resolve(this.fetchFn(url.toString(), {
          method: request.method, headers: Object.fromEntries(headers),
          body: request.body === undefined ? undefined : JSON.stringify(request.body), signal: controller.signal,
        })).then(result => {
          if (controller.signal.aborted) {
            void result.body?.cancel().catch(() => {});
            throw abortError(timedOut);
          }
          return result;
        });
        let onAbort: (() => void) | undefined;
        try {
          response = await Promise.race([pending, new Promise<never>((_, reject) => {
            onAbort = () => reject(abortError(timedOut));
            controller.signal.addEventListener("abort", onAbort, {once:true});
            if (controller.signal.aborted) onAbort();
          })]);
        } finally {
          if (onAbort) controller.signal.removeEventListener("abort", onAbort);
        }
      } catch (cause) {
        cleanup();
        const error = controller.signal.aborted ? abortError(timedOut) : new NinjaChatError({ message: cause instanceof Error ? cause.message : "Network error.", status: 0, code: "network_error" });
        if (options.signal?.aborted || attempt + 1 === attempts) throw error;
        await delay(retryDelay(null, attempt), options.signal);
        continue;
      }
      // Keep cancellation/deadline active through body consumption, not just headers.
      const reader = response.body?.getReader();
      if (reader) {
        const original = response;
        let ended = false;
        let abortBody: () => void;
        const finish = () => { ended = true; cleanup(); controller.signal.removeEventListener("abort", abortBody); };
        const body = new ReadableStream<Uint8Array>({
          start(stream) {
            abortBody = () => {
              if (ended) return;
              finish();
              stream.error(abortError(timedOut));
              void reader.cancel().catch(() => {});
            };
            controller.signal.addEventListener("abort", abortBody, { once: true });
            if (controller.signal.aborted) abortBody();
          },
          async pull(stream) {
            try {
              const { done, value } = await reader.read();
              if (ended) return;
              if (done) { finish(); stream.close(); }
              else stream.enqueue(value);
            } catch (error) {
              if (!ended) { finish(); stream.error(error); }
            }
          },
          async cancel(reason) { finish(); controller.abort(reason); await reader.cancel(reason).catch(() => {}); },
        }, { highWaterMark: 0 });
        response = new Response(body, { status: original.status, statusText: original.statusText, headers: original.headers });
      } else cleanup();
      if (response.ok) return response;
      let body: unknown;
      try { body = await response.json(); } catch (error) {
        if (error instanceof NinjaChatError) throw error;
      }
      const error = NinjaChatError.fromResponse(response.status, body, response.headers.get("x-request-id"), Object.fromEntries(response.headers));
      const inFlight = response.status === 409 && error.code === "request_in_flight";
      if (attempt + 1 === attempts || error.retryable === false || !([429, 500, 502, 503, 504].includes(response.status) || inFlight)) throw error;
      await delay(retryDelay(response, attempt), options.signal);
    }
    throw new NinjaChatError({ message: "Request failed.", status: 0, code: "unknown" });
  }
}
