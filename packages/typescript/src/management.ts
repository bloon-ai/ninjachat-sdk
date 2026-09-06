import type { NinjaChatTransport, RequestOptions } from "./transport.js";
import type { RoutingPolicy, WebhookCreateParams, WebhookEndpoint, WebhookDelivery, WebhookTestResult } from "./types.js";

export type ManagementScope = "keys:read" | "keys:write" | "projects:read" | "projects:write" | "routing:write" | "usage:read" | "webhooks:read" | "webhooks:write";
export interface ManagedKeyCreate { name: string; projectId?: string | null; readOnly?: boolean; expiresInDays?: number | null; monthlyBudgetCents?: number | null }
export interface ManagedKey { id: string; name: string; keyPrefix: string; projectId: string | null; monthlyBudgetCents: number | null; readOnly: boolean; expiresAt: string | null; revokedAt: string | null; createdAt: string; lastUsedAt: string | null; usageCount: number }
export interface ManagedProjectCreate { name: string; monthlyBudgetCents?: number | null; environment?: "development" | "staging" | "production"; routingPolicy?: RoutingPolicy | null }
export interface ManagedProject extends ManagedProjectCreate { id: string; createdAt: string; archivedAt: string | null; spentThisMonthCents: number }
export interface CreatedManagedKey { key: string; data: { id: string; prefix: string; name: string } }
type List<T> = { data: T[] };
type Page<T> = List<T> & { next_cursor: string | null };
export type ManagementPageOptions = RequestOptions & { limit?: number; before?: string };

/** Account-scoped administration, authenticated with a separate nj_mk_ key.
 * Mutations are deliberately never auto-retried: mint/rotate/test have side effects. */
export class ManagementResource {
  readonly #transport: NinjaChatTransport;
  constructor(transport: NinjaChatTransport) { this.#transport = transport; }
  private call<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.#transport.requestJson<T>({ method, path: `/management/${path}`, body, idempotentMethod: method === "GET", options });
  }
  private page<T>(path: string, options: ManagementPageOptions = {}): Promise<Page<T>> {
    const { limit, before, ...requestOptions } = options;
    const query = new URLSearchParams();
    if (limit !== undefined) query.set("limit", String(limit));
    if (before !== undefined) query.set("before", before);
    return this.call("GET", path + (query.size ? `?${query}` : ""), undefined, requestOptions);
  }
  whoami = (options?: RequestOptions) => this.call<{ data: { keyId: string; scopes: ManagementScope[] } }>("GET", "whoami", undefined, options);
  balance = (options?: RequestOptions) => this.call<{ balanceCents: number; currency: "usd" }>("GET", "balance", undefined, options);
  usage = (options?: RequestOptions) => this.call<{ data: Record<string, unknown> }>("GET", "usage", undefined, options);
  audit = (options?: ManagementPageOptions) => this.page<{ actorKeyId: string; action: string; target: string; outcome: string; createdAt: string }>("audit", options);
  keys = {
    list: (options?: ManagementPageOptions) => this.page<ManagedKey>("keys", options),
    retrieve: (id: string, options?: RequestOptions) => this.call<{ data: ManagedKey }>("GET", `keys/${encodeURIComponent(id)}`, undefined, options),
    create: (params: ManagedKeyCreate, options?: RequestOptions) => this.call<CreatedManagedKey>("POST", "keys", params, options),
    update: (id: string, params: Partial<ManagedKeyCreate>, options?: RequestOptions) => this.call<{ updated: true }>("PATCH", `keys/${encodeURIComponent(id)}`, params, options),
    revoke: (id: string, options?: RequestOptions) => this.call<{ deleted: true }>("DELETE", `keys/${encodeURIComponent(id)}`, undefined, options),
    rotate: (id: string, options?: RequestOptions) => this.call<CreatedManagedKey>("POST", `keys/${encodeURIComponent(id)}/rotate`, undefined, options),
  };
  projects = {
    list: (options?: ManagementPageOptions) => this.page<ManagedProject>("projects", options),
    retrieve: (id: string, options?: RequestOptions) => this.call<{ data: ManagedProject }>("GET", `projects/${encodeURIComponent(id)}`, undefined, options),
    create: (params: ManagedProjectCreate, options?: RequestOptions) => this.call<{ data: ManagedProject }>("POST", "projects", params, options),
    update: (id: string, params: Partial<ManagedProjectCreate>, options?: RequestOptions) => this.call<{ updated: true }>("PATCH", `projects/${encodeURIComponent(id)}`, params, options),
    archive: (id: string, options?: RequestOptions) => this.call<{ archived: true }>("DELETE", `projects/${encodeURIComponent(id)}`, undefined, options),
  };
  webhooks = {
    list: (options?: RequestOptions) => this.call<List<WebhookEndpoint>>("GET", "webhooks", undefined, options),
    create: (params: WebhookCreateParams, options?: RequestOptions) => this.call<{ id: string; secret: string }>("POST", "webhooks", params, options),
    delete: (id: string, options?: RequestOptions) => this.call<{ deleted: true }>("DELETE", `webhooks/${encodeURIComponent(id)}`, undefined, options),
    deliveries: (options: RequestOptions & { endpointId?: string } = {}) => {
      const { endpointId, ...requestOptions } = options;
      return this.call<List<WebhookDelivery>>("GET", `webhooks/deliveries${endpointId ? `?endpointId=${encodeURIComponent(endpointId)}` : ""}`, undefined, requestOptions);
    },
    test: (id: string, options?: RequestOptions) => this.call<WebhookTestResult>("POST", `webhooks/${encodeURIComponent(id)}/test`, undefined, options),
  };
}
