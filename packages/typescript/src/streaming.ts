/**
 * SSE parsing for streamed responses — chat, responses, compare, batch.
 *
 * Buffers across network chunk boundaries: an event is only dispatched once the
 * blank-line terminator arrives, so a JSON payload split across two reads never
 * produces a parse error.
 */

import { NinjaChatError } from "./errors.js";
import type {
  BatchStreamEvent,
  ChatCompletionChunk,
  CompareStreamEvent,
  ResponseStreamEvent,
} from "./types.js";

/** Split accumulated text into complete SSE events, returning the unconsumed tail. */
function drainEvents(buffer: string): { events: string[]; rest: string } {
  const events: string[] = [];
  // Normalize CRLF so "\r\n\r\n" terminators match too.
  let rest = buffer;
  for (;;) {
    const norm = rest.replace(/\r\n/g, "\n");
    const idx = norm.indexOf("\n\n");
    if (idx === -1) return { events, rest: norm };
    events.push(norm.slice(0, idx));
    rest = norm.slice(idx + 2);
  }
}

/** Extract the concatenated `data:` payload of one SSE event (per the SSE spec). */
function eventData(rawEvent: string): string | null {
  const dataLines = rawEvent
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).replace(/^ /, ""));
  if (dataLines.length === 0) return null;
  return dataLines.join("\n");
}

function nestedError(parsed: Record<string, unknown>): Record<string, unknown> | null {
  return parsed.error && typeof parsed.error === "object" ? (parsed.error as Record<string, unknown>) : null;
}

/** A single-result stream: any `error` on an event ends it. */
function isFatalOnSingleStream(parsed: Record<string, unknown>): boolean {
  return Boolean(nestedError(parsed)) || typeof parsed.error === "string" || parsed.type === "error";
}

/**
 * A fan-out stream (/compare, /batch) reports per-item failures AS DATA — a
 * `model_error` event or a failed `result` carries a string `error` while the
 * stream stays healthy and the other models keep producing. Only a structured
 * error event ends one.
 */
function isFatalOnFanoutStream(parsed: Record<string, unknown>): boolean {
  return Boolean(nestedError(parsed)) || parsed.type === "error";
}

export async function* readSseJson(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const drained = drainEvents(buffer);
      buffer = drained.rest;
      for (const rawEvent of drained.events) {
        const data = eventData(rawEvent);
        if (data === null || data === "[DONE]") {
          if (data === "[DONE]") return;
          continue;
        }
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(data) as Record<string, unknown>; } catch {
          throw new NinjaChatError({ message: "Stream contained invalid JSON.", status: 0, code: "invalid_stream" });
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new NinjaChatError({ message: "Stream event must be a JSON object.", status: 0, code: "invalid_stream" });
        yield parsed;
      }
    }
    buffer += decoder.decode();
    if (eventData(buffer) !== null)
      throw new NinjaChatError({ message: "Stream ended inside an event.", status: 0, code: "stream_truncated" });
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
}

async function* iterateJsonEvents<T>(response: Response, isFatal = isFatalOnSingleStream): AsyncGenerator<T> {
  if (!response.body) throw new NinjaChatError({ message: "Streaming response had no body.", status: response.status, code: "stream_error" });
  for await (const parsed of readSseJson(response.body)) {
    if (isFatal(parsed)) {
      const error = nestedError(parsed) ?? parsed;
      throw new NinjaChatError({
        message: typeof error.message === "string" ? error.message : "Stream failed.", status: response.status,
        code: typeof error.code === "string" ? error.code : typeof parsed.error === "string" ? parsed.error : "stream_error",
        type: typeof error.type === "string" ? error.type : undefined,
        requestId: typeof parsed.request_id === "string" ? parsed.request_id : response.headers.get("x-request-id") ?? undefined,
        body: parsed,
      });
    }
    yield parsed as T;
  }
}

export async function* iterateChatStream(
  response: Response
): AsyncGenerator<ChatCompletionChunk, void, undefined> {
  let finished = false;
  for await (const event of iterateJsonEvents<ChatCompletionChunk>(response)) {
    if (event.choices?.some(choice => choice.finish_reason != null)) finished = true;
    yield event;
  }
  if (!finished) throw new NinjaChatError({ message: "Chat stream ended without a finish reason.", status: 0, code: "stream_truncated", requestId: response.headers.get("x-request-id") ?? undefined });
}

export async function* iterateResponseStream(response: Response): AsyncGenerator<ResponseStreamEvent, void, undefined> {
  let finished = false;
  for await (const event of iterateJsonEvents<ResponseStreamEvent>(response)) {
    if (["response.completed", "response.incomplete", "response.failed"].includes(event.type)) finished = true;
    yield event;
  }
  if (!finished) throw new NinjaChatError({ message: "Responses stream ended without a terminal event.", status: 0, code: "stream_truncated", requestId: response.headers.get("x-request-id") ?? undefined });
}

export async function* iterateCompareStream(response: Response): AsyncGenerator<CompareStreamEvent, void, undefined> {
  yield* iterateJsonEvents<CompareStreamEvent>(response, isFatalOnFanoutStream);
}

export async function* iterateBatchStream(response: Response): AsyncGenerator<BatchStreamEvent, void, undefined> {
  yield* iterateJsonEvents<BatchStreamEvent>(response, isFatalOnFanoutStream);
}

export async function* iterateMessagesStream(response: Response): AsyncGenerator<import("./types.js").MessageStreamEvent, void, undefined> {
  let finished = false;
  for await (const event of iterateJsonEvents<import("./types.js").MessageStreamEvent>(response)) {
    if (event.type === "message_stop") finished = true;
    yield event;
  }
  if (!finished) throw new NinjaChatError({message:"Messages stream ended without message_stop.",status:0,code:"stream_truncated"});
}
