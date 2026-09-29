"""User identity.

``AUTH_MODE=none``   – single local user (development).
``AUTH_MODE=header`` – trust an identity header injected by the fronting proxy
                       (Azure App Service Easy Auth, Entra Application Proxy,
                       IIS/ADFS, oauth2-proxy, …). Default header is
                       ``X-MS-CLIENT-PRINCIPAL-NAME`` which Easy Auth and Entra
                       App Proxy both set. Never expose the backend directly
                       when using this mode.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, Request

from .config import get_settings


@dataclass
class User:
    id: str
    name: str
    is_admin: bool


def current_user(request: Request) -> User:
    settings = get_settings()
    if settings.auth_mode == "header":
        raw = request.headers.get(settings.auth_user_header, "").strip()
        if not raw:
            raise HTTPException(status_code=401, detail="Not authenticated")
        user_id = raw.lower()
    else:
        user_id = settings.dev_user.lower()
    admins = settings.admin_user_set
    is_admin = settings.auth_mode == "none" or "*" in admins or user_id in admins
    display = user_id.split("@")[0].replace(".", " ").title()
    return User(id=user_id, name=display, is_admin=is_admin)


def require_connector_admin(user: User) -> None:
    if get_settings().connectors_admin_only and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only administrators can manage data connectors.")
