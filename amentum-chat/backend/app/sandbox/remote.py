"""HTTP client for the isolated sandbox service (same interface as LocalSandbox)."""

from __future__ import annotations

from typing import Any

import httpx

from .convert import ConversionError


class RemoteSandbox:
    def __init__(self, base_url: str, token: str = "", exec_timeout: int = 180):
        self.base_url = base_url.rstrip("/")
        self.exec_timeout = exec_timeout
        headers = {"X-Sandbox-Token": token} if token else {}
        # trust_env=False: the sandbox lives on the internal network, never via the egress proxy.
        self._http = httpx.AsyncClient(base_url=self.base_url, headers=headers, timeout=exec_timeout + 60,
                                       trust_env=False)

    def start_reaper(self) -> None:  # the service reaps its own kernels
        pass

    async def close(self) -> None:
        await self._http.aclose()

    async def execute(self, sid: str, code: str, timeout: int | None = None) -> dict[str, Any]:
        r = await self._http.post(f"/sessions/{sid}/execute", json={"code": code, "timeout": timeout})
        r.raise_for_status()
        return r.json()

    async def has_session(self, sid: str) -> bool:
        r = await self._http.get(f"/sessions/{sid}")
        r.raise_for_status()
        return bool(r.json().get("alive"))

    async def put_file(self, sid: str, name: str, data: bytes, overwrite: bool = False) -> str:
        r = await self._http.put(f"/sessions/{sid}/files", params={"name": name, "overwrite": overwrite}, content=data)
        r.raise_for_status()
        return r.json()["path"]

    async def read_file(self, sid: str, rel: str) -> bytes:
        r = await self._http.get(f"/sessions/{sid}/files/content", params={"path": rel})
        r.raise_for_status()
        return r.content

    async def list_files(self, sid: str) -> list[dict[str, Any]]:
        r = await self._http.get(f"/sessions/{sid}/files")
        r.raise_for_status()
        return r.json()

    async def reset(self, sid: str, wipe_files: bool = False) -> None:
        r = await self._http.delete(f"/sessions/{sid}", params={"wipe": wipe_files})
        r.raise_for_status()

    async def convert_pdf(self, name: str, data: bytes) -> bytes:
        r = await self._http.post("/convert", params={"name": name}, content=data)
        if r.status_code == 422:
            raise ConversionError(r.json().get("detail", "conversion failed"))
        r.raise_for_status()
        return r.content

    def info(self) -> dict[str, Any]:
        return {"mode": "service", "url": self.base_url}

    async def health(self) -> dict[str, Any]:
        r = await self._http.get("/health")
        r.raise_for_status()
        return r.json()
