# Engine Lockdown

This repo now has a checked-in MLX engine baseline so the current stable TADA setup does not drift silently.

## What is locked down

- The MLX `GenerateConfig` used by [backend/app/engine.py](/Users/rob/Claude/vox/backend/app/engine.py)
- The standalone MLX benchmark prompt set and acceptance thresholds in [backend/engine_baseline.json](/Users/rob/Claude/vox/backend/engine_baseline.json)
- A repeatable benchmark/audit command in [backend/benchmark_mlx_rtf.py](/Users/rob/Claude/vox/backend/benchmark_mlx_rtf.py)

## Default commands

Run the guarded benchmark:

```bash
npm run bench:engine
```

This does two things:

1. Verifies the live MLX config in the app still matches the checked-in baseline.
2. Runs the standalone MLX benchmark and fails if performance falls outside the accepted range.

Run the benchmark without failing the build:

```bash
npm run bench:engine:report
```

That is useful when exploring model changes and collecting new numbers before deciding whether to adopt them.

## Current baseline file

The source of truth is [backend/engine_baseline.json](/Users/rob/Claude/vox/backend/engine_baseline.json).

It contains:

- the expected MLX generation settings
- the benchmark texts
- the current accepted performance envelope

If that file does not change, the app is expected to behave like the current stable engine.

## How to change the engine on purpose

When you find a real model/runtime improvement later, update it intentionally instead of letting it drift:

1. Change the engine/runtime code.
2. Run:

```bash
npm run bench:engine:report
```

3. Verify the new behavior is actually better in the standalone benchmark and in `tauri dev`.
4. Update [backend/engine_baseline.json](/Users/rob/Claude/vox/backend/engine_baseline.json) to reflect the new accepted config and thresholds.
5. Re-run:

```bash
npm run bench:engine
```

6. Commit the code change and baseline change together.

That keeps the repo flexible for future improvements while still making the current good state explicit and testable.

## Release checklist

Before shipping a new model/runtime change:

1. `npm run bench:engine`
2. `npm --prefix frontend run build`
3. `cargo check --manifest-path src-tauri/Cargo.toml`
4. `npx tauri dev` smoke test:
   - app reaches ready
   - preset generation works
   - playback works
   - clone creation works
5. packaged app smoke test before release

If a change fails the benchmark or breaks one of those paths, treat it as a regression until the baseline is intentionally updated.
