from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = REPO_ROOT / "backend" / "app" / "presets" / "voices.json"
RIGHTS_PATH = REPO_ROOT / "docs" / "preset-asset-rights.json"


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def validate(strict: bool) -> int:
    manifest = load_json(MANIFEST_PATH)
    rights = load_json(RIGHTS_PATH)

    manifest_by_name = {entry["name"]: entry for entry in manifest}
    rights_by_name = {entry["name"]: entry for entry in rights}

    errors: list[str] = []
    warnings: list[str] = []

    missing_in_rights = sorted(set(manifest_by_name) - set(rights_by_name))
    extra_in_rights = sorted(set(rights_by_name) - set(manifest_by_name))
    if missing_in_rights:
        errors.append(f"Missing rights entries for presets: {', '.join(missing_in_rights)}")
    if extra_in_rights:
        errors.append(f"Rights file contains unknown presets: {', '.join(extra_in_rights)}")

    for name, preset in manifest_by_name.items():
        rights_entry = rights_by_name.get(name)
        if rights_entry is None:
            continue

        expected_file = preset["reference_file"]
        actual_file = rights_entry.get("reference_file", "")
        if actual_file != expected_file:
            errors.append(f"{name}: reference_file mismatch ({actual_file!r} != {expected_file!r})")

        file_path = rights_entry.get("file_path", "")
        if not file_path:
            errors.append(f"{name}: file_path is missing")
        else:
            resolved = REPO_ROOT / file_path
            if not resolved.exists():
                errors.append(f"{name}: file_path does not exist ({file_path})")

        status = rights_entry.get("approval_status", "")
        if strict:
            required_fields = {
                "source_creator": rights_entry.get("source_creator", ""),
                "rights_owner": rights_entry.get("rights_owner", ""),
                "approval_date": rights_entry.get("approval_date", ""),
            }
            empty_fields = [field for field, value in required_fields.items() if not str(value).strip()]
            if status != "approved":
                errors.append(f"{name}: approval_status must be 'approved' for strict mode (got {status!r})")
            if empty_fields:
                errors.append(f"{name}: missing required rights fields in strict mode: {', '.join(empty_fields)}")
        elif status != "approved":
            warnings.append(f"{name}: not approved yet ({status or 'missing approval_status'})")

    if errors:
        print("Preset asset audit failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Preset asset inventory is structurally valid ({len(manifest_by_name)} presets).")
    if warnings:
        print("Outstanding release blockers:")
        for warning in warnings:
            print(f"- {warning}")
        if strict:
            return 1
    else:
        print("All preset assets are approved.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Foundry Vox preset asset inventory and rights records.")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Require every preset asset to be fully approved for App Store submission.",
    )
    args = parser.parse_args()
    return validate(strict=args.strict)


if __name__ == "__main__":
    raise SystemExit(main())

