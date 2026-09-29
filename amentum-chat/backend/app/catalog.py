"""Model catalog, pricing and cost accounting."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from .config import get_settings


@dataclass
class Pricing:
    input: float = 0.0  # USD per 1M input tokens
    cached_input: float = 0.0  # USD per 1M cached input tokens
    output: float = 0.0  # USD per 1M output tokens (reasoning tokens are billed as output)


@dataclass
class ModelInfo:
    id: str
    label: str
    deployment: str
    api: Literal["responses", "chat"] = "responses"
    tier: str = ""
    description: str = ""
    reasoning: bool = True
    efforts: list[str] = field(default_factory=lambda: ["low", "medium", "high"])
    default_effort: str = "medium"
    vision: bool = True
    pricing: Pricing = field(default_factory=Pricing)

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "tier": self.tier,
            "description": self.description,
            "api": self.api,
            "reasoning": self.reasoning,
            "efforts": self.efforts,
            "default_effort": self.default_effort,
            "vision": self.vision,
            "pricing": vars(self.pricing),
        }


@dataclass
class Usage:
    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    calls: int = 0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    def add(self, other: "Usage") -> None:
        self.input_tokens += other.input_tokens
        self.cached_tokens += other.cached_tokens
        self.output_tokens += other.output_tokens
        self.reasoning_tokens += other.reasoning_tokens
        self.calls += other.calls

    def cost(self, pricing: Pricing) -> float:
        uncached = max(self.input_tokens - self.cached_tokens, 0)
        return (
            uncached * pricing.input + self.cached_tokens * pricing.cached_input + self.output_tokens * pricing.output
        ) / 1_000_000

    def as_dict(self, pricing: Pricing | None = None) -> dict[str, Any]:
        d = {
            "input_tokens": self.input_tokens,
            "cached_tokens": self.cached_tokens,
            "output_tokens": self.output_tokens,
            "reasoning_tokens": self.reasoning_tokens,
            "total_tokens": self.total_tokens,
            "calls": self.calls,
        }
        if pricing is not None:
            d["cost_usd"] = round(self.cost(pricing), 6)
        return d

    @classmethod
    def from_api(cls, usage: Any) -> "Usage":
        """Normalise a Responses API or Chat Completions usage object."""
        if usage is None:
            return cls()

        def g(obj: Any, *names: str) -> Any:
            for n in names:
                if obj is None:
                    return None
                obj = obj.get(n) if isinstance(obj, dict) else getattr(obj, n, None)
            return obj

        input_tokens = g(usage, "input_tokens") or g(usage, "prompt_tokens") or 0
        output_tokens = g(usage, "output_tokens") or g(usage, "completion_tokens") or 0
        cached = (
            g(usage, "input_tokens_details", "cached_tokens") or g(usage, "prompt_tokens_details", "cached_tokens") or 0
        )
        reasoning = (
            g(usage, "output_tokens_details", "reasoning_tokens")
            or g(usage, "completion_tokens_details", "reasoning_tokens")
            or 0
        )
        return cls(int(input_tokens), int(cached), int(output_tokens), int(reasoning), 1)


class Catalog:
    def __init__(self, models: list[ModelInfo]):
        self._models = {m.id: m for m in models}

    @classmethod
    def load(cls, path: str | Path | None = None) -> "Catalog":
        settings = get_settings()
        raw = json.loads(Path(path or settings.models_file).read_text(encoding="utf-8"))
        overrides = settings.deployment_map
        enabled = settings.enabled_model_ids
        models: list[ModelInfo] = []
        for m in raw.get("models", []):
            if enabled and m["id"] not in enabled:
                continue
            pricing = Pricing(**m.get("pricing", {}))
            models.append(
                ModelInfo(
                    id=m["id"],
                    label=m.get("label", m["id"]),
                    deployment=overrides.get(m["id"], m.get("deployment", m["id"])),
                    api=m.get("api", "responses"),
                    tier=m.get("tier", ""),
                    description=m.get("description", ""),
                    reasoning=m.get("reasoning", True),
                    efforts=m.get("efforts", ["low", "medium", "high"]),
                    default_effort=m.get("default_effort", "medium"),
                    vision=m.get("vision", True),
                    pricing=pricing,
                )
            )
        if not models:
            raise RuntimeError("Model catalog is empty - check MODELS_FILE / ENABLED_MODELS.")
        return cls(models)

    def all(self) -> list[ModelInfo]:
        return list(self._models.values())

    def get(self, model_id: str | None) -> ModelInfo:
        settings = get_settings()
        if model_id and model_id in self._models:
            return self._models[model_id]
        if settings.default_model in self._models:
            return self._models[settings.default_model]
        return next(iter(self._models.values()))

    def has(self, model_id: str) -> bool:
        return model_id in self._models


@lru_cache
def get_catalog() -> Catalog:
    return Catalog.load()
