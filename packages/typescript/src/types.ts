/** Public NinjaChat API v1 contract types. Generated documentation lives in public/openapi.json. */
import type { components } from "./openapi.generated.js";
export type RerankCreateParams = Omit<components["schemas"]["RerankRequest"], "truncation" | "return_documents"> & Partial<Pick<components["schemas"]["RerankRequest"], "truncation" | "return_documents">>;
export type RerankResponse = components["schemas"]["RerankResponse"];
export type SpeechCreateParams = Omit<components["schemas"]["SpeechRequest"], "speed" | "response_format"> & Partial<Pick<components["schemas"]["SpeechRequest"], "speed" | "response_format">>;
export type MessagesCreateParams = components["schemas"]["AnthropicMessagesRequest"];
export interface AnthropicMessage {
  id: string; type: "message"; role: "assistant"; model: string;
  content: Array<{type:"text";text:string} | {type:"tool_use";id:string;name:string;input:Record<string,unknown>}>;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "refusal";
  stop_sequence: string | null;
  usage: {input_tokens:number;output_tokens:number;cache_read_input_tokens?:number;cache_creation_input_tokens?:number};
  request_id?: string; provider?: string; cost_usd?: number; routing?: RoutingSummary;
}
export interface MessageStreamEvent { type: string; [key: string]: unknown }
export interface SessionCreateParams { session_id?: string }
export interface SessionCreated {session_id:string;message_count:number;created_at:string;request_id:string}
export interface SessionState {session_id:string;messages:Array<{role:"system"|"user"|"assistant";content:string}>;message_count:number;created_at:string;updated_at:string}
export interface SessionExport extends SessionState { exported_at: string }
export interface EmbeddingCreateParams {
  model: "text-embedding-3-small" | "voyage-4-large";
  input: string | string[] | number[] | number[][];
  dimensions?: number;
  encoding_format?: "float" | "base64";
  input_type?: "query" | "document";
  truncation?: boolean;
  user?: string;
}
export interface EmbeddingResponse {
  object:"list"; model:string;
  data:Array<{object:"embedding";index:number;embedding:number[]|string}>;
  usage:{prompt_tokens:number;total_tokens:number};cost_usd:number;request_id:string;
}

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
export interface FileContentPart { type: "file"; file: { filename?: string; media_type?: "application/pdf" | "text/plain" | "text/markdown" | "text/csv" | "application/json" } & ({ file_data: string; file_url?: never } | { file_url: string; file_data?: never }) }
export type ContentPart = TextContentPart | ImageContentPart | FileContentPart;
export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export type ChatMessage =
  | { role: "developer" | "system"; content: string | TextContentPart[] }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content?: string | TextContentPart[] | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string | ContentPart[]; tool_call_id: string };
export interface FunctionTool {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown>; strict?: boolean };
}
export type ToolChoice = "auto" | "none" | "required" | { type: "function"; function: { name: string } };
export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; description?: string; schema: Record<string, unknown>; strict?: boolean } };
export interface ChatCompletionBase {
  reasoning?: components["schemas"]["ChatReasoning"];
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
/**
 * Body for a saved preset. The preset already carries the model chain, routing,
 * system prompt and parameters, so `model`/`models` are optional here — pass
 * one to override the preset's chain for this call only.
 */
export type PresetRunParams = ChatCompletionBase & {
  model?: string;
  models?: [string, ...string[]];
};
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
  provider_attempts?: ProviderAttempt[];
  router?: RouterDecision;
}
export interface ProviderAttempt { provider: string; outcome: "served" | "failed_over"; attempt_index: number }
export interface RouterDecision {
  id: "ninja/auto"; task: string; classified_by: "regex" | "llm" | "llm-cached";
  override: "long_context" | "multilingual" | null; reasoning: string;
  candidates: string[]; considered: Array<Record<string, unknown>>;
}
export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  resolved_model: string;
  provider: string | null;
  choices: Array<{ index: number; message: { role: "assistant"; content: string | null; reasoning_content?: string; tool_calls?: ToolCall[] }; finish_reason: string | null }>;
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
    delta: { role?: "assistant"; content?: string; reasoning_content?: string; tool_calls?: Array<{ index: number; id?: string; type?: "function"; function?: { name?: string; arguments?: string } }> };
    finish_reason: string | null;
  }>;
  usage?: ChatUsage;
  cost_usd?: number;
  request_id?: string;
  resolved_model?: string;
  provider?: string | null;
  routing?: RoutingSummary;
}

export interface ResponsesTextPart { type: "input_text"; text: string }
export interface ResponsesImagePart { type: "input_image"; image_url: string; detail?: "auto" | "low" | "high" }
export type ResponsesFilePart = {type:"input_file"} & FileContentPart["file"];
export interface ResponsesMessageItem {
  type?: "message";
  role: "developer" | "system" | "user" | "assistant";
  content: string | Array<ResponsesTextPart | ResponsesImagePart | ResponsesFilePart>;
}
export interface ResponsesFunctionCall { type: "function_call"; call_id: string; name: string; arguments: string }
export interface ResponsesFunctionCallOutput { type: "function_call_output"; call_id: string; output: string | Array<ResponsesTextPart | ResponsesImagePart | ResponsesFilePart> }
export type ResponsesInputItem = ResponsesMessageItem | ResponsesFunctionCall | ResponsesFunctionCallOutput;
export interface ResponsesFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}
interface ResponseCreateBase {
  reasoning?: ChatCompletionBase["reasoning"];
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
  id: string; type: "message"; status: "completed" | "incomplete"; role: "assistant";
  content: Array<{ type: "output_text"; text: string; annotations: unknown[] }>;
}
export interface ResponseOutputFunctionCall {
  id: string; type: "function_call"; status: "completed" | "incomplete"; call_id: string; name: string; arguments: string;
}
export interface ResponseOutputReasoning {
  id: string; type: "reasoning";
  summary: Array<{ type: "summary_text"; text: string }>;
}
export interface ResponseObject {
  id: string;
  object: "response";
  created_at: number;
  status: "completed" | "incomplete";
  incomplete_details: { reason: "max_output_tokens" | "content_filter" } | null;
  error: null;
  model: string;
  output: Array<ResponseOutputMessage | ResponseOutputFunctionCall | ResponseOutputReasoning>;
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

/** One chat model's row on the public rate sheet. Metered rates ARE the billing schedule. */
export interface PricingChatEntry {
  id: string;
  metered_input_per_mtok: number | null;
  metered_output_per_mtok: number | null;
  metered_cached_input_per_mtok: number | null;
  /** Whole-request rates once input passes the threshold, where the upstream bills one. */
  long_context: {
    threshold_tokens: number;
    input_per_mtok: number;
    output_per_mtok: number;
    cached_input_per_mtok: number;
  } | null;
  /** Derived 5K-in/1K-out reference price — comparison only, never billing. */
  typical_request_cents: number | null;
  tier: string;
}
export interface PricingResponse {
  embeddings: Array<{id:string;provider:string;input_per_mtok:number;default_dimensions:number;configured:boolean;minimum_charge_usd:number;charge_increment_usd:number}>;
  object: "pricing";
  currency: "usd";
  pricing_version: string;
  chat: PricingChatEntry[];
  images: Array<{ id: string; per_image_cents: number; per_image: string }>;
  /** `basis: "max_duration"` — the price of the model's LONGEST accepted shape, a ceiling. */
  video: Array<{ id: string; per_video_cents: number; per_video: string; basis: "max_duration" }>;
  search: { per_query_cents: number; per_query: string };
  /** @deprecated Always null — NinjaChat operates no response cache. */
  cache_hit_fraction: null;
  reference_usage: { input_tokens: number; output_tokens: number };
  notes: { video: string; chat: string; cache: string };
  docs: string;
}

export interface ImageGenerateParams { prompt: string; model?: string; n?: number; size?: string; aspect_ratio?: string; image?: string; reference_images?: string[]; width?: number; height?: number; storage?: "durable" | "provider" }
export interface ImageGenerateResponse {
  created: number; data: Array<
    | { url: string; revised_prompt?: string | null }
    | { b64_json: string; mime_type: string; revised_prompt?: string | null }
  >;
  model: string; provider: string; storage: "durable" | "provider";
  usage: { images_generated: number }; cost_usd: number; request_id: string;
}
export interface VideoGenerateParams {
  negative_prompt?: string;
  end_image_url?: string;
  prompt: string; model?: string; duration?: number; aspect_ratio?: "16:9" | "9:16" | "1:1"; image_url?: string;
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

/** Plain-text turn accepted by /compare, /batch and /estimate (no content parts). */
export interface PlainChatMessage { role: "system" | "user" | "assistant"; content: string }
/** Emitted on a spend surface when the wallet is running low. */
export interface BalanceWarning { warning?: string; threshold?: string }
export type RankBy = "quality" | "speed" | "cost" | "balanced";
export interface FanoutTokens { prompt: number; completion: number; reasoning?: number; cached?: number; total: number }

export interface CompareCreateParams {
  messages: PlainChatMessage[];
  /** 2-8 concrete model ids. Omit for the server's default cross-tier set. Virtual ids (ninja/auto, ensemble) are rejected. */
  models?: string[];
  rank_by?: RankBy;
  max_tokens?: number;
  temperature?: number;
  /** false truncates each response to 200 characters. */
  include_full_responses?: boolean;
  stream?: boolean;
}
export interface CompareQuality { confidence: number; flags: string[]; suggested_retry: boolean }
export interface CompareResult {
  rank: number;
  model: string;
  content: string;
  error: null;
  quality: CompareQuality;
  latency_ms: number;
  cost_cents: number;
  tokens: FanoutTokens;
  success: true;
}
export interface CompareFailure {
  model: string;
  content: null;
  error: string;
  quality: null;
  latency_ms: number;
  cost_cents: number;
  tokens: FanoutTokens | null;
  success: false;
}
export interface CompareResponse {
  request_id: string;
  winner: { model: string; name: string; reason: string } | null;
  /** Successful models, best first under `ranked_by`. */
  results: CompareResult[];
  failed: CompareFailure[];
  summary: {
    fastest: { model: string; latency_ms: number } | null;
    highest_quality: { model: string; confidence?: number } | null;
    cheapest: { model: string; cost_cents: number } | null;
    best_value: { model: string } | null;
  };
  ranked_by: RankBy;
  models_compared: number;
  succeeded: number;
  total_cost_cents: number;
  total_cost: string;
  balance: string;
  compared_at: string;
  metadata: { latency_ms: number };
  balance_warning?: BalanceWarning;
}
export type CompareStreamEvent =
  | { type: "start"; id: string; request_id: string; models: string[]; rank_by: RankBy }
  | { type: "delta"; model: string; delta: { content: string } }
  | { type: "model_done"; model: string; content: string; latency_ms: number; cost_cents: number; quality: CompareQuality }
  | { type: "model_error"; model: string; error: string }
  | {
      type: "rankings";
      winner: { model: string; name: string; quality: number; latency_ms: number; cost_cents: number } | null;
      results: Array<{ rank: number; model: string; content: string; latency_ms: number; cost_cents: number; quality: CompareQuality; success: true }>;
      rank_by: RankBy;
    };

export interface BatchJobParams {
  /** Defaults to gpt-5 server-side. Virtual ids (ninja/auto, ensemble) resolve per job. */
  model?: string;
  messages: PlainChatMessage[];
  temperature?: number;
  max_tokens?: number;
}
export interface BatchCreateParams {
  /** 1-20 independent chat jobs, run in parallel under one hold. */
  requests: BatchJobParams[];
  /** true fails the whole batch on the first job error and refunds everything. */
  fail_on_any_error?: boolean;
  stream?: boolean;
}
export interface BatchJobSuccess {
  index: number;
  success: true;
  /** The model that actually served — a job silently falls back on error. */
  model: string;
  requested_model: string;
  content: string;
  cost_cents: number;
  latency_ms: number;
  tokens: FanoutTokens;
  usage: { inputTokens: number; outputTokens: number; reasoningTokens?: number; cachedInputTokens?: number; cacheWriteInputTokens?: number; present: boolean };
  /** Present when the provider reported no usage and the charge came from the estimator. */
  usage_estimated?: true;
  routing?: { requested: string; resolved: string; task_type: string };
}
export interface BatchJobFailure {
  index: number;
  success: false;
  model: string;
  requested_model: string;
  error: string;
  cost_cents: 0;
  latency_ms: number;
}
export interface BatchResponse {
  results: Array<BatchJobSuccess | BatchJobFailure>;
  succeeded: number;
  failed: number;
  total_cost_cents: number;
  total_cost: string;
  balance: string;
  metadata: { total_latency_ms: number; batch_size: number; parallelism: number };
  request_id: string;
  balance_warning?: BalanceWarning;
}
export type BatchStreamEvent =
  | { type: "result"; index: number; success: true; model: string; content: string; cost_cents: number; latency_ms: number; tokens: FanoutTokens }
  | { type: "result"; index: number; success: false; model: string; error: string; cost_cents: 0; latency_ms: number }
  | { type: "summary"; succeeded: number; failed: number; total_cost_cents: number; total_cost: string; request_id: string };

export interface EstimateCreateParams {
  model: string;
  /** Priced with the estimator that bills real traffic. Omitted, a 5K-token reference input is used. */
  messages?: PlainChatMessage[];
  max_tokens?: number;
  /** Multiplies the totals (default 1). */
  count?: number;
  /** Up to 10 extra models to price at the same payload. */
  models?: string[];
}
export interface EstimateResponse {
  model: string;
  model_name: string;
  provider?: string;
  tier?: string;
  pricing_version: string;
  billing: "metered";
  rates: { input_per_mtok: number; output_per_mtok: number; cached_input_per_mtok: number } | null;
  estimated_tokens: { prompt: number; completion: number };
  /** Realistic mid-point for this payload. */
  estimated_cents: number;
  estimated_cost: string;
  /** The hold a real request would preauthorize; the unused portion refunds at settle. */
  estimated_max_cents: number | null;
  estimated_max: string | null;
  for_count: number;
  total_estimated_cents: number;
  total_estimated: string;
  cheaper_alternatives: Array<{ id: string; name: string; estimated_cents: number; savings_percent: number; capabilities: string[] }>;
  monthly_estimate: { at_100: string; at_1000: string; at_10000: string; at_100000: string };
  model_comparison?: Array<{ model: string; estimated_cents: number; total_estimated_cents: number }>;
  note: string;
}

export type PipelineStepType = "chat" | "image" | "video";
export type PipelineStepStatus = "pending" | "running" | "completed" | "failed";
/** Later steps read earlier ones with `{{stepId.output}}` (chat) or `{{stepId.url}}` (image/video). */
export interface PipelineChatStep {
  id: string;
  type: "chat";
  /** Concrete model only — the up-front reserve cannot price ninja/auto or an ensemble. */
  model?: string;
  input: string;
  system?: string;
  max_tokens?: number;
  temperature?: number;
}
export interface PipelineImageStep {
  id: string;
  type: "image";
  model?: string;
  prompt: string;
  aspect_ratio?: string;
  image_url?: string;
}
export interface PipelineVideoStep {
  id: string;
  type: "video";
  model?: string;
  prompt: string;
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  image_url?: string;
  duration?: number;
}
export type PipelineStep = PipelineChatStep | PipelineImageStep | PipelineVideoStep;
export interface PipelineCreateParams {
  /** Up to 5 steps, run in order. */
  steps: PipelineStep[];
  /** https endpoint for pipeline.completed / pipeline.failed instead of polling. */
  webhook_url?: string;
}
export interface PipelineCreateResponse {
  id: string;
  status: "running";
  steps: Array<{ id: string; type: PipelineStepType; model: string; status: PipelineStepStatus }>;
  poll: string;
  cost: { reserved: string; reserved_cents: number; note: string };
  balance: string;
  /** Only when webhook_url was sent. The secret is shown once. */
  webhook?: { url: string; secret: string | null };
  metadata: { latency_ms: number };
  balance_warning?: BalanceWarning;
}
export interface PipelineStepState {
  id: string;
  type: PipelineStepType;
  /** The model that actually served this step. */
  model: string;
  status: PipelineStepStatus;
  output?: string;
  url?: string;
  error?: string;
  cost_cents: number;
}
export interface PipelineState {
  id: string;
  status: "running" | "completed" | "failed";
  steps: PipelineStepState[];
  error?: { step_id: string; message: string };
  cost: { reserved_cents: number; charged_cents: number; refunded_cents: number };
  created_at: string;
  completed_at?: string;
  failed_at?: string;
  poll: string;
}
export interface BalanceResponse { object: "balance"; balance_cents: number; balance: string; currency: "usd"; request_id: string }
/** Public gateway health snapshot. Shape can grow as new reliability checks land. */
export type HealthResponse = Record<string, unknown>;
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
