from __future__ import annotations

import datetime
import json
import shutil
import uuid
from pathlib import Path
from typing import Any

import aiosqlite

from .config import DEFAULT_SETTINGS
from .models import generation_from_row, voice_from_row

SCHEMA = """
CREATE TABLE IF NOT EXISTS voices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    gender TEXT,
    color TEXT,
    description TEXT,
    tags TEXT,
    reference_audio_path TEXT,
    reference_text TEXT,
    reference_duration_seconds REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    voice_id TEXT NOT NULL,
    voice_name TEXT NOT NULL,
    quality TEXT,
    system_prompt TEXT,
    output_path TEXT NOT NULL,
    format TEXT NOT NULL,
    sample_rate INTEGER NOT NULL,
    duration_seconds REAL NOT NULL,
    generation_time_seconds REAL NOT NULL,
    rtf REAL NOT NULL,
    char_count INTEGER NOT NULL,
    word_count INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class Database:
    def __init__(self, db_path: Path, app_home: Path) -> None:
        self.db_path = db_path
        self.app_home = app_home

    async def initialize(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self.db_path) as db:
            await db.executescript(SCHEMA)
            await self._migrate(db)
            for key, value in DEFAULT_SETTINGS.items():
                await db.execute(
                    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                    (key, value),
                )
            await db.commit()

    async def _migrate(self, db: aiosqlite.Connection) -> None:
        columns = await self._fetchall(db, "PRAGMA table_info(generations)")
        generation_columns = {column[1] for column in columns}
        if "quality" not in generation_columns:
            await db.execute("ALTER TABLE generations ADD COLUMN quality TEXT")

    async def _fetchone(
        self, db: aiosqlite.Connection, query: str, params: tuple[Any, ...] = ()
    ) -> aiosqlite.Row | None:
        cursor = await db.execute(query, params)
        try:
            return await cursor.fetchone()
        finally:
            await cursor.close()

    async def _fetchall(
        self, db: aiosqlite.Connection, query: str, params: tuple[Any, ...] = ()
    ) -> list[aiosqlite.Row]:
        cursor = await db.execute(query, params)
        try:
            return await cursor.fetchall()
        finally:
            await cursor.close()

    async def seed_presets(self, presets: list[dict[str, Any]]) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            existing = await self._fetchall(
                db,
                "SELECT id, name, reference_duration_seconds FROM voices WHERE type = 'preset'"
            )
            existing_by_name = {row["name"]: row for row in existing}
            now = datetime.datetime.now(datetime.timezone.utc).isoformat()
            for preset in presets:
                existing_row = existing_by_name.get(preset["name"])
                if existing_row is not None:
                    # Update existing preset if reference audio changed (different duration)
                    old_dur = existing_row["reference_duration_seconds"] or 0
                    new_dur = preset.get("reference_duration_seconds") or 0
                    if abs(old_dur - new_dur) > 0.5:
                        await db.execute(
                            """
                            UPDATE voices SET
                                reference_audio_path = ?, reference_text = ?,
                                reference_duration_seconds = ?, description = ?,
                                tags = ?, color = ?, updated_at = ?
                            WHERE id = ?
                            """,
                            (
                                preset.get("reference_audio_path"),
                                preset.get("reference_text"),
                                new_dur,
                                preset.get("description"),
                                json.dumps(preset.get("tags", [])),
                                preset.get("color"),
                                now,
                                existing_row["id"],
                            ),
                        )
                    continue
                voice_id = str(uuid.uuid4())
                created_at = preset["created_at"]
                await db.execute(
                    """
                    INSERT INTO voices (
                        id, name, type, gender, color, description, tags,
                        reference_audio_path, reference_text, reference_duration_seconds,
                        created_at, updated_at
                    ) VALUES (?, ?, 'preset', ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        voice_id,
                        preset["name"],
                        preset.get("gender"),
                        preset.get("color"),
                        preset.get("description"),
                        json.dumps(preset.get("tags", [])),
                        preset.get("reference_audio_path"),
                        preset.get("reference_text"),
                        preset.get("reference_duration_seconds"),
                        created_at,
                        created_at,
                    ),
                )
            await db.commit()

    async def list_voices(self, voice_type: str | None = None) -> list[Any]:
        query = "SELECT * FROM voices"
        params: tuple[Any, ...] = ()
        if voice_type:
            query += " WHERE type = ?"
            params = (voice_type,)
        query += " ORDER BY type ASC, created_at DESC, name ASC"
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            rows = await self._fetchall(db, query, params)
        return [voice_from_row(dict(row)) for row in rows]

    async def get_voice(self, voice_id: str) -> Any | None:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            row = await self._fetchone(db, "SELECT * FROM voices WHERE id = ?", (voice_id,))
        return voice_from_row(dict(row)) if row else None

    async def create_clone_voice(self, voice: dict[str, Any]) -> Any:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                INSERT INTO voices (
                    id, name, type, gender, color, description, tags,
                    reference_audio_path, reference_text, reference_duration_seconds,
                    created_at, updated_at
                ) VALUES (?, ?, 'clone', ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    voice["id"],
                    voice["name"],
                    voice.get("gender"),
                    voice.get("color"),
                    voice.get("description"),
                    json.dumps(voice.get("tags", [])),
                    voice["reference_audio_path"],
                    voice.get("reference_text"),
                    voice.get("reference_duration_seconds"),
                    voice["created_at"],
                    voice["updated_at"],
                ),
            )
            await db.commit()
        return await self.get_voice(voice["id"])

    async def update_voice(self, voice_id: str, changes: dict[str, Any]) -> Any | None:
        if not changes:
            return await self.get_voice(voice_id)

        fields = []
        params: list[Any] = []
        for key, value in changes.items():
            if key == "tags":
                value = json.dumps(value)
            fields.append(f"{key} = ?")
            params.append(value)
        params.append(voice_id)

        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                f"UPDATE voices SET {', '.join(fields)} WHERE id = ?",
                tuple(params),
            )
            await db.commit()
        return await self.get_voice(voice_id)

    async def delete_voice(self, voice_id: str) -> Any | None:
        voice = await self.get_voice(voice_id)
        if not voice:
            return None

        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("DELETE FROM voices WHERE id = ?", (voice_id,))
            await db.commit()
        return voice

    async def insert_generation(self, generation: dict[str, Any]) -> Any:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                INSERT INTO generations (
                    id, text, voice_id, voice_name, quality, system_prompt, output_path,
                    format, sample_rate, duration_seconds, generation_time_seconds,
                    rtf, char_count, word_count, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    generation["id"],
                    generation["text"],
                    generation["voice_id"],
                    generation["voice_name"],
                    generation.get("quality"),
                    generation.get("system_prompt"),
                    generation["output_path"],
                    generation["format"],
                    generation["sample_rate"],
                    generation["duration_seconds"],
                    generation["generation_time_seconds"],
                    generation["rtf"],
                    generation["char_count"],
                    generation["word_count"],
                    generation["created_at"],
                ),
            )
            await db.commit()
        return await self.get_generation(generation["id"])

    async def get_generation(self, generation_id: str) -> Any | None:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            row = await self._fetchone(
                db,
                "SELECT * FROM generations WHERE id = ?", (generation_id,)
            )
        return generation_from_row(dict(row)) if row else None

    async def list_generations(
        self,
        *,
        voice_id: str | None = None,
        search: str | None = None,
        sort: str = "newest",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Any], int]:
        conditions: list[str] = []
        params: list[Any] = []

        if voice_id:
            conditions.append("voice_id = ?")
            params.append(voice_id)
        if search:
            conditions.append("LOWER(text) LIKE ?")
            params.append(f"%{search.lower()}%")

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        order_by = {
            "newest": "created_at DESC",
            "oldest": "created_at ASC",
            "longest": "duration_seconds DESC",
            "shortest": "duration_seconds ASC",
        }[sort]

        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            total_row = await self._fetchone(
                db,
                f"SELECT COUNT(*) AS total FROM generations {where_clause}",
                tuple(params),
            )
            rows = await self._fetchall(
                db,
                f"""
                SELECT * FROM generations
                {where_clause}
                ORDER BY {order_by}
                LIMIT ? OFFSET ?
                """,
                (*params, limit, offset),
            )

        return [generation_from_row(dict(row)) for row in rows], int(total_row["total"])

    async def delete_generation(self, generation_id: str) -> Any | None:
        generation = await self.get_generation(generation_id)
        if not generation:
            return None
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("DELETE FROM generations WHERE id = ?", (generation_id,))
            await db.commit()
        return generation

    async def clear_history(self) -> list[Any]:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            rows = await self._fetchall(db, "SELECT * FROM generations")
            await db.execute("DELETE FROM generations")
            await db.commit()
        return [generation_from_row(dict(row)) for row in rows]

    async def history_stats(self, session_started_at: str) -> dict[str, Any]:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            lifetime = await self._fetchone(
                db,
                """
                SELECT
                    COUNT(*) AS generations,
                    COALESCE(SUM(duration_seconds), 0) AS total_audio_seconds,
                    COALESCE(SUM(generation_time_seconds), 0) AS total_generation_seconds,
                    COALESCE(AVG(rtf), 0) AS avg_rtf
                FROM generations
                """
            )
            session = await self._fetchone(
                db,
                """
                SELECT
                    COUNT(*) AS generations,
                    COALESCE(SUM(duration_seconds), 0) AS total_audio_seconds,
                    COALESCE(SUM(generation_time_seconds), 0) AS total_generation_seconds,
                    COALESCE(AVG(rtf), 0) AS avg_rtf
                FROM generations
                WHERE created_at >= ?
                """,
                (session_started_at,),
            )

        return {"session": dict(session), "lifetime": dict(lifetime)}

    async def get_settings(self) -> dict[str, str]:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            rows = await self._fetchall(db, "SELECT key, value FROM settings")
        return {row["key"]: row["value"] for row in rows}

    async def update_settings(self, changes: dict[str, str]) -> dict[str, str]:
        async with aiosqlite.connect(self.db_path) as db:
            for key, value in changes.items():
                await db.execute(
                    """
                    INSERT INTO settings (key, value) VALUES (?, ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value
                    """,
                    (key, value),
                )
            await db.commit()
        return await self.get_settings()

    def resolve_relative_path(self, relative_path: str | None) -> Path | None:
        if not relative_path:
            return None
        return (self.app_home / relative_path).resolve()

    def to_relative_path(self, path: Path) -> str:
        return str(path.resolve().relative_to(self.app_home.resolve()))

    def install_packaged_presets(self, packaged_dir: Path, target_dir: Path) -> dict[str, float]:
        durations: dict[str, float] = {}
        target_dir.mkdir(parents=True, exist_ok=True)
        for source in packaged_dir.glob("*.wav"):
            target = target_dir / source.name
            if not target.exists():
                shutil.copy2(source, target)
            durations[source.name] = 10.0
        return durations
