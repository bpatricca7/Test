"""Runtime configuration.

Every setting can be supplied as an environment variable (case-insensitive) or in
an ``.env`` file. The same code base runs in four provider profiles:

* ``demo``            – built-in OpenAI-compatible simulator. No keys, no internet.
* ``openai``          – api.openai.com (personal machine / quick testing).
* ``azure``           – Azure OpenAI in Azure commercial (same Microsoft code path as GCC High).
* ``azure_gcc_high``  – Azure OpenAI in Azure Government (GCC High):
                        ``*.openai.azure.us`` + Entra ID at ``login.microsoftonline.us``.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent

Provider = Literal["demo", "openai", "azure", "azure_gcc_high"]

# Cloud-specific constants. Azure Government (GCC High / DoD) uses different
# sovereign endpoints for Entra ID, Azure OpenAI and the token audience.
AZURE_CLOUDS = {
    "azure": {
        "authority_host": "login.microsoftonline.com",
        "token_scope": "https://cognitiveservices.azure.com/.default",
        "openai_suffixes": (".openai.azure.com", ".cognitiveservices.azure.com", ".services.ai.azure.com"),
    },
    "azure_gcc_high": {
        "authority_host": "login.microsoftonline.us",
        "token_scope": "https://cognitiveservices.azure.us/.default",
        "openai_suffixes": (".openai.azure.us", ".cognitiveservices.azure.us", ".services.ai.azure.us"),
    },
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=os.environ.get("AMENTUM_ENV_FILE", str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- Branding / UI -------------------------------------------------------------
    app_name: str = "Amentum AI"
    app_tagline: str = "Secure intelligence for mission-critical work"
    ui_banner_text: str = ""  # e.g. "CUI // Controlled Unclassified Information"
    ui_banner_color: str = "#502b85"
    show_usage_by_default: bool = False

    # ---- Provider selection --------------------------------------------------------
    llm_provider: Provider = "demo"

    # OpenAI (personal computer / test)
    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_organization: str = ""

    # Azure OpenAI (commercial and GCC High)
    azure_openai_endpoint: str = ""  # https://<resource>.openai.azure.us/
    azure_openai_api_key: str = ""
    azure_api_style: Literal["v1", "versioned"] = "v1"
    azure_openai_api_version: str = "2025-04-01-preview"  # only used when azure_api_style=versioned
    azure_auth: Literal["key", "entra"] = "key"
    azure_tenant_id: str = ""
    azure_client_id: str = ""
    azure_client_secret: str = ""
    azure_client_certificate_path: str = ""
    azure_use_managed_identity: bool = False
    # Refuse to start if a GCC High profile points at a non-government endpoint.
    enforce_gov_endpoints: bool = True

    # Outbound networking (Amentum proxy / TLS inspection)
    outbound_proxy: str = ""
    outbound_ca_bundle: str = ""
    request_timeout_s: float = 600.0
    max_retries: int = 2

    # ---- Models --------------------------------------------------------------------
    models_file: str = str(PROJECT_DIR / "config" / "models.json")
    # JSON object mapping catalog model id -> Azure deployment name, e.g. {"gpt-5.6-sol": "sol-prod"}
    model_deployments: str = ""
    enabled_models: str = ""  # comma separated; empty = all catalog models
    default_model: str = "gpt-5.6-terra"
    title_model: str = "gpt-5.6-luna"
    auto_title: bool = True
    reasoning_summary: Literal["auto", "concise", "detailed", "off"] = "auto"
    # Responses API: store=false keeps nothing on the provider side (reasoning is
    # carried forward as encrypted content instead).
    responses_store: bool = False
    max_tool_steps: int = 16
    max_output_tokens: int = 0  # 0 = provider default
    system_prompt_extra: str = ""

    # ---- Code interpreter ---------------------------------------------------------
    # local  = our own Jupyter sandbox (works on every provider + Chat Completions,
    #          files never leave the Amentum network)
    # hosted = provider-hosted code_interpreter tool (Responses API only)
    code_interpreter: Literal["local", "hosted", "off"] = "local"
    sandbox_url: str = ""  # empty = run kernels embedded in the backend process
    sandbox_token: str = ""
    sandbox_exec_timeout_s: int = 180
    sandbox_idle_timeout_s: int = 1800
    sandbox_max_sessions: int = 24
    libreoffice_path: str = ""  # auto-detected when empty

    # ---- Data / storage --------------------------------------------------------------
    data_dir: str = str(BACKEND_DIR / "data")
    max_upload_mb: int = 100
    max_inline_text_chars: int = 60_000

    # ---- MCP connectors --------------------------------------------------------------
    mcp_config_file: str = ""  # defaults to <data_dir>/mcp_servers.json
    mcp_allow_stdio: bool = True
    connectors_admin_only: bool = False
    mcp_tool_timeout_s: float = 120.0
    mcp_max_result_chars: int = 40_000

    # ---- Identity ---------------------------------------------------------------------
    auth_mode: Literal["none", "header"] = "none"
    auth_user_header: str = "X-MS-CLIENT-PRINCIPAL-NAME"
    dev_user: str = "local.user"
    admin_users: str = ""  # comma separated; "*" = everyone

    # ---- Web ------------------------------------------------------------------------------
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    frontend_dist: str = str(PROJECT_DIR / "frontend" / "dist")
    # Base URL the backend uses to reach its own demo simulator.
    demo_base_url: str = ""

    @field_validator("llm_provider", mode="before")
    @classmethod
    def _normalize_provider(cls, v: str) -> str:
        v = (v or "demo").strip().lower().replace("-", "_")
        aliases = {"gcc_high": "azure_gcc_high", "gcchigh": "azure_gcc_high", "azure_gov": "azure_gcc_high",
                   "azure_government": "azure_gcc_high", "mock": "demo"}
        return aliases.get(v, v)

    # ---- Derived helpers -------------------------------------------------------------------
    @property
    def is_azure(self) -> bool:
        return self.llm_provider in ("azure", "azure_gcc_high")

    @property
    def is_gov(self) -> bool:
        return self.llm_provider == "azure_gcc_high"

    @property
    def cloud(self) -> dict:
        return AZURE_CLOUDS["azure_gcc_high" if self.is_gov else "azure"]

    @property
    def data_path(self) -> Path:
        p = Path(self.data_dir)
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def mcp_config_path(self) -> Path:
        return Path(self.mcp_config_file) if self.mcp_config_file else self.data_path / "mcp_servers.json"

    @property
    def deployment_map(self) -> dict[str, str]:
        if not self.model_deployments.strip():
            return {}
        try:
            data = json.loads(self.model_deployments)
            return {str(k): str(v) for k, v in data.items()}
        except json.JSONDecodeError:
            # Also accept "a=b,c=d"
            pairs = [p.split("=", 1) for p in self.model_deployments.split(",") if "=" in p]
            return {k.strip(): v.strip() for k, v in pairs}

    @property
    def enabled_model_ids(self) -> list[str]:
        return [m.strip() for m in self.enabled_models.split(",") if m.strip()]

    @property
    def admin_user_set(self) -> set[str]:
        return {u.strip().lower() for u in self.admin_users.split(",") if u.strip()}

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def provider_label(self) -> str:
        return {
            "demo": "Demo simulator",
            "openai": "OpenAI (test)",
            "azure": "Azure OpenAI",
            "azure_gcc_high": "Azure Government · GCC High",
        }[self.llm_provider]

    def validate_runtime(self) -> list[str]:
        """Return a list of human readable configuration problems (empty = OK)."""
        problems: list[str] = []
        if self.llm_provider == "openai" and not self.openai_api_key:
            problems.append("LLM_PROVIDER=openai but OPENAI_API_KEY is not set.")
        if self.is_azure:
            if not self.azure_openai_endpoint:
                problems.append("AZURE_OPENAI_ENDPOINT is required for Azure providers.")
            if self.azure_auth == "key" and not self.azure_openai_api_key:
                problems.append("AZURE_AUTH=key but AZURE_OPENAI_API_KEY is not set.")
            if self.is_gov and self.enforce_gov_endpoints and self.azure_openai_endpoint:
                from urllib.parse import urlparse

                host = (urlparse(self.azure_openai_endpoint).hostname or "").lower()
                if not host.endswith(self.cloud["openai_suffixes"]):
                    problems.append(
                        f"GCC High profile refuses non-government endpoint '{host}'. Expected a host ending in "
                        f"{', '.join(self.cloud['openai_suffixes'])} (set ENFORCE_GOV_ENDPOINTS=false to override)."
                    )
        if self.code_interpreter == "hosted" and self.llm_provider == "demo":
            problems.append("CODE_INTERPRETER=hosted is not supported by the demo simulator; use 'local'.")
        return problems


@lru_cache
def get_settings() -> Settings:
    return Settings()
