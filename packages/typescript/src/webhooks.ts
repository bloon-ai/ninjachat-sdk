/**
 * Outbound-webhook signature verification.
 *
 * NinjaChat signs every delivery with:
 *   X-Ninja-Signature: hex( HMAC-SHA256( secret, `${timestamp}.${rawBody}` ) )
 *   X-Ninja-Timestamp: unix seconds at send time
 *
 * Verify with the RAW request body bytes exactly as received — re-serializing
 * the parsed JSON changes the bytes and breaks the signature.
 *
 * Uses WebCrypto (crypto.subtle), available in Node >= 18, browsers, and edge
 * runtimes — zero dependencies.
 */

const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Constant-time byte comparison. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export interface VerifyWebhookOptions {
  /**
   * Reject deliveries whose timestamp is further than this many seconds from
   * now (replay protection). Default 300. Pass null to skip the check.
   */
  toleranceSeconds?: number | null;
}

/**
 * Verify a webhook delivery.
 *
 * @param rawBody   The raw request body (string or bytes), byte-exact.
 * @param signature The X-Ninja-Signature header value (hex).
 * @param timestamp The X-Ninja-Timestamp header value (unix seconds).
 * @param secret    The endpoint's signing secret (returned once at creation).
 */
export async function verifyWebhookSignature(
  rawBody: string | Uint8Array,
  signature: string,
  timestamp: string | number,
  secret: string,
  options: VerifyWebhookOptions = {}
): Promise<boolean> {
  const ts = typeof timestamp === "number" ? timestamp : parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;

  const tolerance = options.toleranceSeconds === undefined ? 300 : options.toleranceSeconds;
  if (tolerance !== null && Math.abs(Date.now() / 1000 - ts) > tolerance) {
    return false;
  }

  const provided = hexToBytes(signature.trim());
  if (!provided) return false;

  const bodyText =
    typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`${ts}.${bodyText}`))
  );

  return timingSafeEqual(provided, expected);
}
