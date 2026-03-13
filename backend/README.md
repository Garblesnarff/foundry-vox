# Foundry Vox Backend

FastAPI sidecar backend for the Foundry Vox macOS desktop app.

## Dev

```bash
uv sync --project backend --extra dev
uv run --project backend uvicorn app.main:app --host 127.0.0.1 --port 3456 --reload
```

## ML Dependencies

Install the model stack separately when you are ready to run local TADA inference:

```bash
uv sync --project backend --extra ml
```

## Build Sidecar

```bash
uv sync --project backend --extra build --extra ml
sh ./scripts/build-sidecar.sh
```

