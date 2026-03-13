from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ApiError(Exception):
    error: str
    message: str
    status_code: int
    details: dict[str, Any] = field(default_factory=dict)


def error_payload(
    error: str, message: str, details: dict[str, Any] | None = None
) -> dict[str, Any]:
    payload = {
        "error": error,
        "message": message,
        "details": details or {},
    }
    payload.update(details or {})
    return payload
