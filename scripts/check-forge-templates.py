#!/usr/bin/env python3
"""Validate public Nex forge-template packages without executing forge plans.

Armory owns package shape, public lint, and optional CI integration. Nex owns Pkl
semantics. This script runs static Armory checks first, then calls
`nex forge check ... --json --no-execute` when a compatible Nex CLI is available.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import Any

SCHEMA = "dev.styrene.nex.forge-template.v1"
ALLOWED_EVALUATORS = {"pkl"}
ALLOWED_EVALUATION_MODES = {"inspect-only", "plan-only", "build-plan", "execute-capable"}
ALLOWED_SAFETY_CLASSES = {
    "documentation",
    "plan-only",
    "image-build",
    "disk-write",
    "cluster-init",
    "remote-provision",
}
CAPABILITIES_BY_SAFETY_CLASS = {
    "documentation": set(),
    "plan-only": set(),
    "image-build": {"image-build"},
    "disk-write": {"image-build", "disk-write"},
    "cluster-init": {"image-build", "disk-write", "cluster-init"},
    "remote-provision": {"image-build", "disk-write", "cluster-init", "remote-provision"},
}
SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def load_toml(path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def forge_dirs(root: Path) -> list[Path]:
    base = root / "forge-templates"
    if not base.exists():
        return []
    return sorted(path for path in base.iterdir() if path.is_dir())


def error(errors: list[str], path: Path, message: str) -> None:
    errors.append(f"{path}: {message}")


def check_static_template(path: Path) -> tuple[dict[str, Any] | None, list[str]]:
    errors: list[str] = []
    metadata_path = path / "forge.toml"
    forge_path = path / "forge.pkl"
    readme_path = path / "README.md"

    if not metadata_path.exists():
        error(errors, path, "missing forge.toml")
        return None, errors
    if not forge_path.exists():
        error(errors, path, "missing forge.pkl")
    if not readme_path.exists():
        error(errors, path, "missing README.md")

    try:
        metadata = load_toml(metadata_path).get("forge_template", {})
    except tomllib.TOMLDecodeError as exc:
        error(errors, metadata_path, f"invalid TOML: {exc}")
        return None, errors

    slug = path.name
    required = [
        "schema",
        "evaluator",
        "evaluation_mode",
        "safety_class",
        "id",
        "name",
        "version",
        "description",
        "category",
        "license",
        "canonical_format",
        "nex_min_version",
        "visibility",
        "profile_class",
        "destructive_capabilities",
        "network_requirements",
    ]
    for field in required:
        if field not in metadata:
            error(errors, metadata_path, f"missing forge_template.{field}")

    if metadata.get("schema") != SCHEMA:
        error(errors, metadata_path, f"schema must be {SCHEMA!r}")
    if metadata.get("evaluator") not in ALLOWED_EVALUATORS:
        error(errors, metadata_path, "evaluator must be one of: " + ", ".join(sorted(ALLOWED_EVALUATORS)))
    if metadata.get("evaluation_mode") not in ALLOWED_EVALUATION_MODES:
        error(errors, metadata_path, "invalid evaluation_mode")
    if metadata.get("safety_class") not in ALLOWED_SAFETY_CLASSES:
        error(errors, metadata_path, "invalid safety_class")
    if metadata.get("id") != slug:
        error(errors, metadata_path, "id must match directory name")
    if metadata.get("canonical_format") != "pkl":
        error(errors, metadata_path, "canonical_format must be 'pkl'")
    if metadata.get("visibility") != "public":
        error(errors, metadata_path, "public Armory only accepts visibility = 'public'")
    if not isinstance(metadata.get("destructive_capabilities"), list):
        error(errors, metadata_path, "destructive_capabilities must be an array")
    if not isinstance(metadata.get("network_requirements"), list):
        error(errors, metadata_path, "network_requirements must be an array")
    if isinstance(metadata.get("version"), str) and not SEMVER_RE.fullmatch(metadata["version"]):
        error(errors, metadata_path, "version must be semver MAJOR.MINOR.PATCH")
    if isinstance(metadata.get("nex_min_version"), str) and not SEMVER_RE.fullmatch(metadata["nex_min_version"]):
        error(errors, metadata_path, "nex_min_version must be semver MAJOR.MINOR.PATCH")

    safety_class = metadata.get("safety_class")
    declared_caps = set(metadata.get("destructive_capabilities") or [])
    allowed_caps = CAPABILITIES_BY_SAFETY_CLASS.get(safety_class, set())
    extra_caps = sorted(declared_caps - allowed_caps)
    if extra_caps:
        error(
            errors,
            metadata_path,
            f"destructive_capabilities {extra_caps} exceed safety_class {safety_class!r}",
        )

    if metadata.get("evaluation_mode") in {"inspect-only", "plan-only"} and "disk-write" in declared_caps:
        error(errors, metadata_path, "inspect-only/plan-only templates must not declare disk-write")
    if metadata.get("evaluation_mode") in {"inspect-only", "plan-only"} and "cluster-init" in declared_caps:
        error(errors, metadata_path, "inspect-only/plan-only templates must not declare cluster-init")

    return metadata, errors


def run_public_lint(root: Path) -> list[str]:
    proc = subprocess.run(
        [sys.executable, "scripts/lint-public-payloads.py"],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode == 0:
        return []
    return ["public payload lint failed", proc.stdout.strip(), proc.stderr.strip()]


def nex_supports_forge_check(root: Path, nex_bin: str) -> bool:
    proc = subprocess.run(
        [nex_bin, "forge", "check", "--help"],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    )
    output = proc.stdout + proc.stderr
    return proc.returncode == 0 and "--metadata" in output and "--no-execute" in output


def run_nex_check(root: Path, template_dir: Path, nex_bin: str) -> tuple[bool, str]:
    proc = subprocess.run(
        [
            nex_bin,
            "forge",
            "check",
            str(template_dir / "forge.pkl"),
            "--metadata",
            str(template_dir / "forge.toml"),
            "--json",
            "--no-execute",
        ],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    )
    output = (proc.stdout or proc.stderr).strip()
    if proc.returncode != 0:
        return False, output or f"nex exited {proc.returncode}"
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        return False, f"nex returned non-JSON output: {exc}: {proc.stdout[:500]}"
    if data.get("valid") is not True:
        return False, json.dumps(data, indent=2, sort_keys=True)
    return True, json.dumps(data, sort_keys=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--skip-public-lint", action="store_true")
    parser.add_argument("--require-nex", action="store_true", default=os.environ.get("ARMORY_REQUIRE_NEX") == "1")
    args = parser.parse_args()

    root = Path(args.repo_root).resolve()
    errors: list[str] = []
    templates = forge_dirs(root)

    if not templates:
        print("No forge templates found")
        return 0

    for template_dir in templates:
        _, static_errors = check_static_template(template_dir)
        errors.extend(static_errors)

    if not args.skip_public_lint:
        errors.extend(message for message in run_public_lint(root) if message)

    if errors:
        for message in errors:
            print(f"ERROR: {message}", file=sys.stderr)
        return 1

    nex_bin = shutil.which("nex")
    if not nex_bin:
        message = "Nex CLI not found; skipped semantic forge validation"
        if args.require_nex:
            print(f"ERROR: {message}", file=sys.stderr)
            return 2
        print(f"WARNING: {message}")
        print(f"Static forge-template checks passed for {len(templates)} template(s)")
        return 0

    if not nex_supports_forge_check(root, nex_bin):
        message = f"Nex CLI at {nex_bin} does not expose 'forge check'; skipped semantic forge validation"
        if args.require_nex:
            print(f"ERROR: {message}", file=sys.stderr)
            return 2
        print(f"WARNING: {message}")
        print(f"Static forge-template checks passed for {len(templates)} template(s)")
        return 0

    semantic_errors: list[str] = []
    for template_dir in templates:
        ok, details = run_nex_check(root, template_dir, nex_bin)
        if ok:
            print(f"Nex semantic check passed: {template_dir.relative_to(root)}")
        else:
            semantic_errors.append(f"{template_dir.relative_to(root)}: {details}")

    if semantic_errors:
        for message in semantic_errors:
            print(f"ERROR: {message}", file=sys.stderr)
        return 3

    print(f"Forge-template checks passed for {len(templates)} template(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
