from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request

from ..models import HistoryResponse, HistoryStatsResponse, HistoryStatsWindow

router = APIRouter(prefix="/history", tags=["history"])


@router.get("", response_model=HistoryResponse)
async def list_history(
    request: Request,
    voice_id: str | None = None,
    search: str | None = None,
    sort: str = "newest",
    limit: int = 50,
    offset: int = 0,
) -> HistoryResponse:
    limit = max(1, min(limit, 200))
    generations, total = await request.app.state.services.db.list_generations(
        voice_id=voice_id,
        search=search,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    return HistoryResponse(generations=generations, total=total, limit=limit, offset=offset)


@router.delete("/{generation_id}")
async def delete_history_item(request: Request, generation_id: str) -> dict[str, bool]:
    generation = await request.app.state.services.db.delete_generation(generation_id)
    if not generation:
        return {"deleted": False}
    Path(generation.output_path).unlink(missing_ok=True)
    return {"deleted": True}


@router.delete("")
async def clear_history(request: Request) -> dict[str, int]:
    generations = await request.app.state.services.db.clear_history()
    for generation in generations:
        Path(generation.output_path).unlink(missing_ok=True)
    return {"deleted": len(generations)}


@router.get("/stats", response_model=HistoryStatsResponse)
async def history_stats(request: Request) -> HistoryStatsResponse:
    services = request.app.state.services
    stats = await services.db.history_stats(services.session_started_at.isoformat())
    return HistoryStatsResponse(
        session=HistoryStatsWindow(**stats["session"]),
        lifetime=HistoryStatsWindow(**stats["lifetime"]),
    )
