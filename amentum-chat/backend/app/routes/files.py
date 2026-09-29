"""Upload, download, preview and print files."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from ..auth import User, current_user
from ..config import get_settings
from ..db import get_db
from ..files import CONVERTIBLE_TO_PDF, public_file, store_bytes

router = APIRouter()


def _owned(fid: str, user: User) -> dict:
    f = get_db().get_file(fid)
    if f is None or f["user"] != user.id or not Path(f["path"]).exists():
        raise HTTPException(404, "File not found")
    return f


@router.post("/files")
async def upload(files: list[UploadFile], user: User = Depends(current_user)) -> list[dict]:
    limit = get_settings().max_upload_mb * 1024 * 1024
    out = []
    for up in files:
        data = await up.read()
        if len(data) > limit:
            raise HTTPException(413, f"{up.filename} exceeds the {get_settings().max_upload_mb} MB limit")
        rec = store_bytes(user.id, up.filename or "upload", data, source="upload")
        out.append(public_file(rec))
    return out


@router.get("/files/{fid}")
async def download(fid: str, inline: bool = False, user: User = Depends(current_user)) -> FileResponse:
    f = _owned(fid, user)
    disposition = "inline" if inline else "attachment"
    return FileResponse(f["path"], media_type=f["mime"],
                        headers={"Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(f['name'])}",
                                 "Cache-Control": "private, max-age=3600"})


@router.get("/files/{fid}/pdf")
async def as_pdf(fid: str, user: User = Depends(current_user)) -> Response:
    """Render Word/Excel/PowerPoint to PDF for in-browser preview and printing."""
    f = _owned(fid, user)
    ext = Path(f["name"]).suffix.lower()
    if ext == ".pdf":
        return FileResponse(f["path"], media_type="application/pdf",
                            headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(f['name'])}"})
    if ext not in CONVERTIBLE_TO_PDF:
        raise HTTPException(415, "This file type cannot be rendered to PDF")
    cache = Path(f["path"] + ".pdf")
    if not cache.exists():
        from ..sandbox.convert import ConversionError
        from ..tools.code_interpreter import get_sandbox

        try:
            pdf = await get_sandbox().convert_pdf(f["name"], Path(f["path"]).read_bytes())
        except ConversionError as exc:
            raise HTTPException(422, str(exc)) from exc
        cache.write_bytes(pdf)
    name = Path(f["name"]).stem + ".pdf"
    return FileResponse(str(cache), media_type="application/pdf",
                        headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(name)}"})
