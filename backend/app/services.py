from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from .models import ProgressEvent


def utc_now() -> datetime:
    return datetime.now(UTC)


class ProgressBroker:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._lock = asyncio.Lock()

    async def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        async with self._lock:
            self._subscribers.add(queue)
        return queue

    async def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            self._subscribers.discard(queue)

    async def publish(self, event_type: str, payload: ProgressEvent | dict[str, Any]) -> None:
        data = payload.model_dump() if isinstance(payload, ProgressEvent) else payload
        async with self._lock:
            subscribers = list(self._subscribers)
        for queue in subscribers:
            await queue.put({"event": event_type, "data": data})


@dataclass
class HealthState:
    status: str = "loading"
    error: str | None = None
    message: str | None = None


@dataclass
class AppServices:
    paths: Any
    db: Any
    engine: Any
    progress: ProgressBroker
    session_started_at: datetime = field(default_factory=utc_now)
    health: HealthState = field(default_factory=HealthState)
    generation_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    active_generation_started_at: datetime | None = None
    active_generation_estimated_seconds: int | None = None
