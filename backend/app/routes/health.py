from __future__ import annotations

from fastapi import APIRouter, Request

from ..models import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def get_health(request: Request) -> HealthResponse:
    services = request.app.state.services
    return HealthResponse(
        status=services.health.status,
        model=services.engine.model_name,
        model_loaded=services.engine.model_loaded,
        warmed_up=services.engine.warmed_up,
        device=services.engine.device,
        dtype=services.engine.dtype,
        platform="darwin-arm64",
        error=services.health.error,
        message=services.health.message,
    )
