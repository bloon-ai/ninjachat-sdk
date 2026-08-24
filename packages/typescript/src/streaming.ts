/**
 * SSE parsing for streamed chat completions.
 *
 * Buffers across network chunk boundaries: an event is only dispatched once the
 * blank-line terminator arrives, so a JSON payload split across two reads never
 * produces a parse error.
 */

import { NinjaChatError } from "./errors.js";
import type { ChatCompletionChunk, ResponseStreamEvent } from "./types.js";

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

async function* iterateJsonEvents<T>(response: Response): AsyncGenerator<T, void, undefined> {
  const body = response.body;
  if (!body) {
    throw new NinjaChatError({ message: "Streaming response had no body.", status: response.status, code: "stream_error" });
  }
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
        try { parsed = JSON.parse(data) as Record<string, unknown>; } catch { continue; }
        const nested = parsed.error && typeof parsed.error === "object" ? parsed.error as Record<string, unknown> : null;
        if (nested || typeof parsed.error === "string" || parsed.type === "error") {
          const error = nested ?? parsed;
          throw new NinjaChatError({
            message: typeof error.message === "string" ? error.message : "Stream failed.",
            status: response.status,
            code: typeof error.code === "string" ? error.code : typeof parsed.error === "string" ? parsed.error : "stream_error",
            type: typeof error.type === "string" ? error.type : undefined,
            body: parsed,
          });
        }
        yield parsed as T;
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
}

export async function* iterateChatStream(
  response: Response
): AsyncGenerator<ChatCompletionChunk, void, undefined> {
  yield* iterateJsonEvents<ChatCompletionChunk>(response);
}

export async function* iterateResponseStream(response: Response): AsyncGenerator<ResponseStreamEvent, void, undefined> {
  yield* iterateJsonEvents<ResponseStreamEvent>(response);
}
