"""Office -> PDF conversion with LibreOffice (used for previews and printing)."""

from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from pathlib import Path

_CANDIDATES = [
    r"C:\Program Files\LibreOffice\program\soffice.exe",
    r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/usr/bin/soffice",
    "/usr/lib/libreoffice/program/soffice",
    "/opt/libreoffice/program/soffice",
]


def find_soffice() -> str | None:
    configured = os.environ.get("LIBREOFFICE_PATH")
    if configured and Path(configured).exists():
        return configured
    found = shutil.which("soffice") or shutil.which("libreoffice")
    if found:
        return found
    return next((c for c in _CANDIDATES if Path(c).exists()), None)


class ConversionError(RuntimeError):
    pass


async def convert_to_pdf(name: str, data: bytes, soffice: str | None = None, timeout: float = 180) -> bytes:
    soffice = soffice or find_soffice()
    if not soffice:
        raise ConversionError(
            "LibreOffice is not installed, so Office files cannot be rendered to PDF. Install LibreOffice "
            "(or use the Docker sandbox image, which includes it)."
        )
    with tempfile.TemporaryDirectory(prefix="amentum_pdf_") as tmp:
        tmp_path = Path(tmp)
        src = tmp_path / Path(name).name
        src.write_bytes(data)
        profile = (tmp_path / "profile").as_uri()
        proc = await asyncio.create_subprocess_exec(
            soffice, f"-env:UserInstallation={profile}", "--headless", "--norestore", "--convert-to", "pdf",
            "--outdir", str(tmp_path), str(src),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError as exc:
            proc.kill()
            raise ConversionError("PDF conversion timed out") from exc
        out = tmp_path / (src.stem + ".pdf")
        if not out.exists():
            raise ConversionError(f"LibreOffice could not convert {name}: {err.decode(errors='replace')[:400]}")
        return out.read_bytes()
