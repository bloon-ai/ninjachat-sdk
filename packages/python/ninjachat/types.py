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


class ChatCompletionParams(TypedDict, total=False):
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
    width: int
    height: int


class VideoGenerateParams(TypedDict, total=False):
    prompt: Required[str]
    model: str
    duration: int
    aspect_ratio: Literal["16:9", "9:16"]
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
