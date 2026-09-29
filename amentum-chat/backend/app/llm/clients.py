"""LLM client factory.

One code path for every environment: the official ``openai`` SDK talks to
api.openai.com (``openai``), Azure OpenAI commercial (``azure``), Azure OpenAI in
Azure Government / GCC High (``azure_gcc_high``) or the built-in simulator
(``demo``). Only the endpoint, credential and token audience change.

GCC High specifics handled here:
  * Endpoint host must be ``*.openai.azure.us`` (enforced in config).
  * Entra ID tokens are issued by ``login.microsoftonline.us``.
  * Token audience/scope is ``https://cognitiveservices.azure.us/.default``.
  * Optional corporate proxy + custom CA bundle for TLS-inspecting egress.
"""

from __future__ import annotations

import logging
import ssl
from typing import Any

import openai

from ..config import Settings, get_settings

log = logging.getLogger(__name__)

_client: Any = None
_client_key: tuple | None = None


def _http_client(settings: Settings) -> Any | None:
    """Build an HTTP client that honours the Amentum proxy / CA bundle when configured."""
    if not settings.outbound_ca_bundle and not settings.outbound_proxy:
        return None  # SDK defaults (also honour HTTPS_PROXY / SSL_CERT_FILE env vars)
    kwargs: dict[str, Any] = {}
    if settings.outbound_ca_bundle:
        ctx = ssl.create_default_context(cafile=settings.outbound_ca_bundle)
        kwargs["verify"] = ctx
    if settings.outbound_proxy:
        kwargs["proxy"] = settings.outbound_proxy
    return openai.DefaultAsyncHttpxClient(**kwargs)


def _azure_credential(settings: Settings) -> Any:
    """Entra ID credential pinned to the right sovereign cloud authority."""
    from azure.identity.aio import (
        CertificateCredential,
        ClientSecretCredential,
        DefaultAzureCredential,
        ManagedIdentityCredential,
    )

    authority = settings.cloud["authority_host"]
    if settings.azure_use_managed_identity:
        return ManagedIdentityCredential(client_id=settings.azure_client_id or None)
    if settings.azure_client_certificate_path:
        return CertificateCredential(
            tenant_id=settings.azure_tenant_id,
            client_id=settings.azure_client_id,
            certificate_path=settings.azure_client_certificate_path,
            authority=authority,
        )
    if settings.azure_client_secret:
        return ClientSecretCredential(
            tenant_id=settings.azure_tenant_id,
            client_id=settings.azure_client_id,
            client_secret=settings.azure_client_secret,
            authority=authority,
        )
    # Falls back through env vars, workload identity, managed identity, Azure CLI
    # (run `az cloud set --name AzureUSGovernment && az login` for GCC High).
    return DefaultAzureCredential(authority=authority)


def _token_provider(settings: Settings) -> Any:
    from azure.identity.aio import get_bearer_token_provider

    return get_bearer_token_provider(_azure_credential(settings), settings.cloud["token_scope"])


def build_client(settings: Settings | None = None, demo_base_url: str | None = None) -> Any:
    settings = settings or get_settings()
    common: dict[str, Any] = {"timeout": settings.request_timeout_s, "max_retries": settings.max_retries}
    http_client = _http_client(settings)
    if http_client is not None:
        common["http_client"] = http_client

    provider = settings.llm_provider
    if provider == "demo":
        base = (settings.demo_base_url or demo_base_url or "http://127.0.0.1:8000").rstrip("/")
        return openai.AsyncOpenAI(api_key="demo", base_url=f"{base}/demo/v1", timeout=120, max_retries=0)

    if provider == "openai":
        kwargs = dict(common, api_key=settings.openai_api_key)
        if settings.openai_base_url:
            kwargs["base_url"] = settings.openai_base_url
        if settings.openai_organization:
            kwargs["organization"] = settings.openai_organization
        return openai.AsyncOpenAI(**kwargs)

    # ---- Azure commercial / Azure Government (GCC High) --------------------------
    endpoint = settings.azure_openai_endpoint.rstrip("/")
    if settings.azure_api_style == "v1":
        # Azure OpenAI v1 API: standard OpenAI client pointed at /openai/v1/.
        credential: Any = settings.azure_openai_api_key if settings.azure_auth == "key" else _token_provider(settings)
        return openai.AsyncOpenAI(base_url=f"{endpoint}/openai/v1/", api_key=credential, **common)

    # Date-versioned API (…/openai/…?api-version=YYYY-MM-DD) via AsyncAzureOpenAI.
    kwargs = dict(common, azure_endpoint=endpoint, api_version=settings.azure_openai_api_version)
    if settings.azure_auth == "key":
        kwargs["api_key"] = settings.azure_openai_api_key
    else:
        kwargs["azure_ad_token_provider"] = _token_provider(settings)
    return openai.AsyncAzureOpenAI(**kwargs)


def get_client(demo_base_url: str | None = None) -> Any:
    """Process-wide cached client (rebuilt if the demo base URL changes)."""
    global _client, _client_key
    settings = get_settings()
    key = (settings.llm_provider, demo_base_url if settings.llm_provider == "demo" else None)
    if _client is None or key != _client_key:
        _client = build_client(settings, demo_base_url)
        _client_key = key
        log.info("LLM client ready: provider=%s", settings.llm_provider)
    return _client


def describe_endpoint(settings: Settings | None = None) -> dict[str, Any]:
    """Non-secret description of the active LLM connection for the status panel."""
    from urllib.parse import urlparse

    settings = settings or get_settings()
    info: dict[str, Any] = {"provider": settings.llm_provider, "label": settings.provider_label}
    if settings.llm_provider == "openai":
        info["host"] = urlparse(settings.openai_base_url or "https://api.openai.com").hostname
        info["auth"] = "api-key"
    elif settings.is_azure:
        info["host"] = urlparse(settings.azure_openai_endpoint).hostname
        info["api_style"] = settings.azure_api_style
        if settings.azure_api_style == "versioned":
            info["api_version"] = settings.azure_openai_api_version
        info["auth"] = "api-key" if settings.azure_auth == "key" else "entra-id"
        info["authority"] = settings.cloud["authority_host"]
        info["token_scope"] = settings.cloud["token_scope"]
    else:
        info["host"] = "built-in simulator"
        info["auth"] = "none"
    info["proxy"] = bool(settings.outbound_proxy)
    info["custom_ca"] = bool(settings.outbound_ca_bundle)
    return info
