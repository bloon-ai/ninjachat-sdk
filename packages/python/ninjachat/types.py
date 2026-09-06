"""Typed request objects for NinjaChat API v1."""

from typing import Any, Dict, List, Literal, Union

try:
    from typing import NotRequired, Required, TypedDict
except ImportError:  # Python 3.9-3.10
    from typing_extensions import NotRequired, Required, TypedDict


class ProviderPolicy(TypedDict, total=False):
    only: List[str]
    exclude: List[str]
    order: List[str]


class RoutingPolicy(TypedDict, total=False):
    strategy: Literal["balanced", "cost", "latency", "quality"]
    providers: ProviderPolicy
    allow_fallbacks: bool
    require_parameters: bool
    data_policy: Literal["default", "no_training", "zero_retention"]
    caching: Literal["auto"]
    max_cost_usd: float


class ChatMessage(TypedDict, total=False):
    role: Required[Literal["developer", "system", "user", "assistant", "tool"]]
    content: Union[str, List[Dict[str, Any]], None]
    tool_call_id: str
    tool_calls: List[Dict[str, Any]]


class ReasoningParams(TypedDict, total=False):
    effort: Literal["none", "minimal", "low", "medium", "high", "xhigh"]
    max_tokens: int
    enabled: bool


class MessageCreateParams(TypedDict, total=False):
    model: Required[str]
    max_tokens: Required[int]
    messages: Required[List[Dict[str, Any]]]
    system: Union[str, List[Dict[str, Any]]]
    stream: bool
    temperature: float
    top_p: float
    stop_sequences: List[str]
    tools: List[Dict[str, Any]]
    tool_choice: Dict[str, Any]
    metadata: Dict[str, str]
    output_config: Dict[str, Any]
    routing: RoutingPolicy


class RerankCreateParams(TypedDict, total=False):
    model: Required[Literal["rerank-2.5", "rerank-2.5-lite"]]
    query: Required[str]
    documents: Required[List[str]]
    top_n: int
    return_documents: bool
    truncation: bool


class SpeechCreateParams(TypedDict, total=False):
    model: Required[Literal["tts-1", "tts-1-hd"]]
    input: Required[str]
    voice: Required[str]
    response_format: Literal["mp3", "opus", "aac", "flac", "wav", "pcm"]
    speed: float


class EmbeddingCreateParams(TypedDict, total=False):
    model: Required[Literal["text-embedding-3-small", "voyage-4-large"]]
    input: Required[Union[str, List[str], List[int], List[List[int]]]]
    dimensions: int
    encoding_format: Literal["float", "base64"]
    input_type: Literal["query", "document"]
    truncation: bool
    user: str


class ChatCompletionParams(TypedDict, total=False):
    reasoning: ReasoningParams
    model: str
    models: List[str]
    messages: Required[List[ChatMessage]]
    max_completion_tokens: int
    temperature: float
    top_p: float
    stop: Union[str, List[str]]
    frequency_penalty: float
    presence_penalty: float
    seed: int
    user: str
    response_format: Dict[str, Any]
    stream: bool
    stream_options: Dict[str, bool]
    tools: List[Dict[str, Any]]
    tool_choice: Union[str, Dict[str, Any]]
    parallel_tool_calls: bool
    routing: RoutingPolicy


class ResponseCreateParams(TypedDict, total=False):
    reasoning: ReasoningParams
    model: str
    models: List[str]
    input: Required[Union[str, List[Dict[str, Any]]]]
    instructions: str
    max_output_tokens: int
    temperature: float
    top_p: float
    tools: List[Dict[str, Any]]
    tool_choice: Union[str, Dict[str, Any]]
    parallel_tool_calls: bool
    text: Dict[str, Any]
    routing: RoutingPolicy
    metadata: Dict[str, str]
    user: str
    stream: bool
    store: Literal[False]


class ImageGenerateParams(TypedDict, total=False):
    prompt: Required[str]
    model: str
    n: int
    size: str
    aspect_ratio: str
    image: str
    reference_images: List[str]
    width: int
    height: int
    storage: Literal["durable", "provider"]


class VideoGenerateParams(TypedDict, total=False):
    negative_prompt: str
    end_image_url: str
    prompt: Required[str]
    model: str
    duration: int
    aspect_ratio: Literal["16:9", "9:16", "1:1"]
    image_url: str
    reference_images: List[str]
    reference_video: str
    reference_audio: str
    generate_audio: bool
    watermark: bool


class SearchParams(TypedDict, total=False):
    query: Required[str]
    group: Literal["web", "news"]
    max_results: int
    search_depth: Literal["basic", "advanced"]
    topic: Literal["general", "news", "finance"]
    include_answer: bool
    include_images: bool


class PlainChatMessage(TypedDict, total=False):
    """Plain-text turn accepted by /compare, /batch and /estimate."""

    role: Required[Literal["system", "user", "assistant"]]
    content: Required[str]


class CompareParams(TypedDict, total=False):
    messages: Required[List[PlainChatMessage]]
    models: List[str]
    rank_by: Literal["quality", "speed", "cost", "balanced"]
    max_tokens: int
    temperature: float
    include_full_responses: bool
    stream: bool


class BatchJobParams(TypedDict, total=False):
    model: str
    messages: Required[List[PlainChatMessage]]
    temperature: float
    max_tokens: int


class BatchParams(TypedDict, total=False):
    requests: Required[List[BatchJobParams]]
    fail_on_any_error: bool
    stream: bool


class EstimateParams(TypedDict, total=False):
    model: Required[str]
    messages: List[PlainChatMessage]
    max_tokens: int
    count: int
    models: List[str]


class PipelineChatStep(TypedDict, total=False):
    id: Required[str]
    type: Required[Literal["chat"]]
    model: str
    input: Required[str]
    system: str
    max_tokens: int
    temperature: float


class PipelineImageStep(TypedDict, total=False):
    id: Required[str]
    type: Required[Literal["image"]]
    model: str
    prompt: Required[str]
    aspect_ratio: str
    image_url: str


class PipelineVideoStep(TypedDict, total=False):
    id: Required[str]
    type: Required[Literal["video"]]
    model: str
    prompt: Required[str]
    aspect_ratio: Literal["16:9", "9:16", "1:1"]
    image_url: str
    duration: int


PipelineStep = Union[PipelineChatStep, PipelineImageStep, PipelineVideoStep]


class PipelineCreateParams(TypedDict, total=False):
    steps: Required[List[PipelineStep]]
    webhook_url: str


class PresetChatCompletionParams(TypedDict, total=False):
    """A preset owns the model chain, so model/models are optional overrides."""

    model: str
    models: List[str]
    messages: Required[List[ChatMessage]]
    max_completion_tokens: int
    temperature: float
    top_p: float
    stop: Union[str, List[str]]
    frequency_penalty: float
    presence_penalty: float
    seed: int
    user: str
    response_format: Dict[str, Any]
    stream: bool
    stream_options: Dict[str, bool]
    tools: List[Dict[str, Any]]
    tool_choice: Union[str, Dict[str, Any]]
    parallel_tool_calls: bool
    routing: RoutingPolicy
