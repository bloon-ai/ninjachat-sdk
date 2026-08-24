/** Public NinjaChat API v1 contract types. Generated documentation lives in public/openapi.json. */

export interface RoutingPolicy {
  strategy?: "balanced" | "cost" | "latency" | "quality";
  providers?: { only?: string[]; exclude?: string[]; order?: string[] };
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  data_policy?: "default" | "no_training" | "zero_retention";
  caching?: "auto";
  max_cost_usd?: number;
}

export type ChatRole = "developer" | "system" | "user" | "assistant" | "tool";
export interface TextContentPart { type: "text"; text: string }
export interface ImageContentPart { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
export type ContentPart = TextContentPart | ImageContentPart;
export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export type ChatMessage =
  | { role: "developer" | "system" | "user"; content: string | ContentPart[] }
  | { role: "assistant"; content?: string | ContentPart[] | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };
export interface FunctionTool {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown>; strict?: boolean };
}
export type ToolChoice = "auto" | "none" | "required" | { type: "function"; function: { name: string } };
export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; description?: string; schema: Record<string, unknown>; strict?: boolean } };
interface ChatCompletionBase {
  messages: ChatMessage[];
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  frequency_penalty?: number;
  presence_penalty?: number;
  seed?: number;
  user?: string;
  response_format?: ResponseFormat;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  tools?: FunctionTool[];
  tool_choice?: ToolChoice;
  parallel_tool_calls?: boolean;
  routing?: RoutingPolicy;
}
export type ChatCompletionCreateParams = ChatCompletionBase & (
  | { model: string; models?: never }
  | { model?: never; models: [string, ...string[]] }
);
export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_creation_tokens?: number;
  };
  completion_tokens_details?: { reasoning_tokens?: number };
}
export interface RoutingSummary {
  strategy: "balanced" | "cost" | "latency" | "quality";
  requested_models: string[];
  resolved_model: string;
  provider: string | null;
  fallbacks_allowed: boolean;
  data_policy: "default" | "no_training" | "zero_retention";
  caching?: "auto";
  source?: "request" | "project" | "default";
}
export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  resolved_model: string;
  provider: string | null;
  choices: Array<{ index: number; message: { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }; finish_reason: string | null }>;
  usage: ChatUsage;
  cost_usd: number;
  request_id: string;
  routing: RoutingSummary;
}
export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: "assistant"; content?: string; tool_calls?: Array<{ index: number; id?: string; type?: "function"; function?: { name?: string; arguments?: string } }> };
    finish_reason: string | null;
  }>;
  usage?: ChatUsage;
  cost_usd?: number;
  request_id?: string;
}

export interface ResponsesTextPart { type: "input_text"; text: string }
export interface ResponsesImagePart { type: "input_image"; image_url: string; detail?: "auto" | "low" | "high" }
export interface ResponsesMessageItem {
  type?: "message";
  role: "developer" | "system" | "user" | "assistant";
  content: string | Array<ResponsesTextPart | ResponsesImagePart>;
}
export interface ResponsesFunctionCall { type: "function_call"; call_id: string; name: string; arguments: string }
export interface ResponsesFunctionCallOutput { type: "function_call_output"; call_id: string; output: string }
export type ResponsesInputItem = ResponsesMessageItem | ResponsesFunctionCall | ResponsesFunctionCallOutput;
export interface ResponsesFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}
interface ResponseCreateBase {
  input: string | ResponsesInputItem[];
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: ResponsesFunctionTool[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; name: string };
  parallel_tool_calls?: boolean;
  text?: { format?: { type: "text" | "json_object" } | { type: "json_schema"; name: string; description?: string; schema: Record<string, unknown>; strict?: boolean } };
  routing?: RoutingPolicy;
  metadata?: Record<string, string>;
  user?: string;
  stream?: boolean;
  store?: false;
}
export type ResponseCreateParams = ResponseCreateBase & (
  | { model: string; models?: never }
  | { model?: never; models: [string, ...string[]] }
);
export interface ResponseOutputMessage {
  id: string; type: "message"; status: "completed"; role: "assistant";
  content: Array<{ type: "output_text"; text: string; annotations: unknown[] }>;
}
export interface ResponseOutputFunctionCall {
  id: string; type: "function_call"; status: "completed"; call_id: string; name: string; arguments: string;
}
export interface ResponseObject {
  id: string;
  object: "response";
  created_at: number;
  status: "completed";
  error: null;
  model: string;
  output: Array<ResponseOutputMessage | ResponseOutputFunctionCall>;
  output_text: string;
  usage: {
    input_tokens: number;
    input_tokens_details: {
      cached_tokens: number;
      cache_creation_tokens: number;
    };
    output_tokens: number;
    output_tokens_details: { reasoning_tokens: number };
    total_tokens: number;
  };
  cost_usd: number;
  provider: string | null;
  request_id: string;
  routing: RoutingSummary;
  store: false;
}
export interface ResponseStreamEvent {
  type: string;
  sequence_number: number;
  response?: Partial<ResponseObject>;
  item?: Record<string, unknown>;
  delta?: string;
  text?: string;
  arguments?: string;
  error?: { type: string; code: string; message: string; param?: string | null };
  [key: string]: unknown;
}

export interface PublicModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  name: string;
  modality: "text" | "image" | "image_edit" | "video" | "audio" | "embedding" | "rerank" | "search";
  status: string;
  servable: boolean;
  capabilities: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  pricing: {
    unit: "token" | "image" | "second" | "request";
    typicalRequestUsd?: number;
    meteredPromptPerToken?: number;
    meteredCachedPromptPerToken?: number;
    meteredCacheWritePromptPerToken?: number;
    meteredCompletionPerToken?: number;
    perUnitUsd?: number;
  };
  providers: Array<{
    provider: string;
    providerDisplayName: string;
    trainsOnData?: boolean;
    zeroRetentionAvailable?: boolean;
    performance?: { samples: number; successRate: number | null; p50Ms: number | null; p95Ms: number | null; medianTtftMs: number | null; thin: boolean } | null;
  }>;
  supportedParameters: string[];
}
export interface ModelList { object: "list"; data: PublicModel[]; total: number; generated_at: string }

export interface ImageGenerateParams { prompt: string; model?: string; n?: number; size?: string; aspect_ratio?: string; image?: string; width?: number; height?: number }
export interface ImageGenerateResponse {
  created: number; data: Array<{ url: string; revised_prompt?: string | null }>;
  model: string; usage: { images_generated: number }; cost_usd: number; request_id: string;
}
export interface VideoGenerateParams {
  prompt: string; model?: string; duration?: number; aspect_ratio?: "16:9" | "9:16"; image_url?: string;
  reference_images?: string[]; reference_video?: string; reference_audio?: string; generate_audio?: boolean; watermark?: boolean;
}
export interface VideoGenerateResponse { id: string; object: "video"; status: "queued"; model: string; cost_usd: number; request_id: string }
export interface VideoStatusResponse {
  id: string; object: "video"; status: "queued" | "processing" | "completed" | "failed";
  progress?: number; video_url?: string; error?: string;
}
export interface SearchQueryParams {
  query: string; group?: "web" | "news"; max_results?: number; search_depth?: "basic" | "advanced";
  topic?: "general" | "news" | "finance"; include_answer?: boolean; include_images?: boolean;
}
export interface SearchResponse {
  object: "search.results"; query: string; answer: string | null;
  sources: Array<{ url: string; title: string; content: string; published_date: string | null }>;
  images?: Array<{ url: string; description: string | null }>;
  follow_up_questions: string[]; provider: string; cost_usd: number; request_id: string;
}
export interface BalanceResponse { object: "balance"; balance_cents: number; balance: string; currency: "usd"; request_id: string }
export interface UsageResponse {
  period: "1d" | "7d" | "30d"; total_requests: number; total_cost_cents: number; total_cost: string;
  daily: Array<{ date: string; requests: number; cost_cents: number }>;
  by_model: Array<{ model: string; requests: number; cost_cents: number; avg_latency_ms: number }>;
  by_endpoint: Array<{ endpoint: string; requests: number }>;
  request_id: string;
}
export interface RequestRecord {
  object: "request"; request_id: string; timestamp: string | null; endpoint: string | null;
  model_requested: string | null; model: string | null; provider: string | null;
  tokens: { input: number | null; output: number | null; reasoning: number | null; cached: number | null };
  cost_cents: number | null; metered_cost_cents: number | null; latency_ms: number | null; ttfb_ms: number | null;
  status_code: number | null; retries: number | null;
  error_code: string | null; routing: Record<string, unknown> | null;
}

export type WebhookEvent = "video.completed" | "video.failed" | "budget.alert" | "balance.low";
export interface WebhookEndpoint { id: string; url: string; events: string[]; secret_hint: string; created_at: string }
export interface WebhookCreateParams { url: string; events?: WebhookEvent[] }
export interface WebhookCreateResponse { id: string; url: string; events: string[]; secret: string; message?: string }
export type WebhookDeliveryStatus = "delivered" | "retrying" | "dead" | "pending";
export interface WebhookDelivery {
  id: string; endpoint_id: string | null; event: string; status: WebhookDeliveryStatus; attempts: number;
  delivered_at: string | null; next_attempt_at: string; last_error: string | null; created_at: string; request_id: string | null;
}
export interface WebhookTestResult { delivered: boolean; detail: string | null }
