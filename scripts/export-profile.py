#!/usr/bin/env python3
"""Export Armory profiles into degraded prompt/config formats."""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import sys
import textwrap
import tomllib
from pathlib import Path

PROFILE_SCHEMA = "dev.styrene.omegon.profile.v1"
FORMATS = {"generic-markdown", "agents-md", "claude-md", "cursor-rules"}


@dataclasses.dataclass
class ResolvedDependency:
    kind: str
    id: str
    version: str
    required: bool
    activate: str
    portable: bool
    source_path: str
    content_path: str | None
    content: str | None
    note: str | None


def load_toml(path: Path) -> dict:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8").rstrip() + "\n"


def profile_dir(repo: Path, slug: str) -> Path:
    return repo / "profiles" / slug


def load_profile(repo: Path, slug: str) -> tuple[Path, dict]:
    root = profile_dir(repo, slug)
    path = root / "profile.toml"
    if not path.exists():
        raise SystemExit(f"profile not found: {slug}")
    manifest = load_toml(path)
    validate_profile(slug, manifest)
    return root, manifest


def validate_profile(slug: str, manifest: dict) -> None:
    profile = manifest.get("profile", {})
    if profile.get("schema") != PROFILE_SCHEMA:
        raise SystemExit(f"{slug}: unsupported profile schema {profile.get('schema')!r}")
    if profile.get("slug") != slug:
        raise SystemExit(f"{slug}: profile.slug must match directory name")
    if profile.get("id") != f"dev.styrene.omegon.profile.{slug}":
        raise SystemExit(f"{slug}: profile.id does not match slug")
    if "defaults" not in manifest:
        raise SystemExit(f"{slug}: missing [defaults]")
    if not isinstance(manifest.get("dependencies"), list):
        raise SystemExit(f"{slug}: dependencies must be an array")


def dependency_default_portable(kind: str) -> bool:
    return kind in {"skill", "persona", "tone", "profile"}


def dependency_portable(dep: dict) -> bool:
    if "portable" in dep:
        return bool(dep["portable"])
    return dependency_default_portable(dep.get("kind", ""))


def plugin_entrypoint(repo: Path, kind: str, dep_id: str) -> tuple[str, Path]:
    roots = {"skill": "skills", "persona": "personas", "tone": "tones"}
    files = {"skill": "SKILL.md", "persona": "PERSONA.md", "tone": "TONE.md"}
    root = roots[kind]
    entry = files[kind]
    rel = f"{root}/{dep_id}/{entry}"
    path = repo / rel
    if not path.exists():
        raise SystemExit(f"missing dependency entrypoint: {rel}")
    return rel, path


def extension_note(repo: Path, dep_id: str) -> str:
    registry = load_toml(repo / "registry.toml") if (repo / "registry.toml").exists() else {}
    enabled = bool(registry.get(dep_id, {}).get("enabled", False))
    detail_path = repo / "extensions" / f"{dep_id}.toml"
    detail = load_toml(detail_path) if detail_path.exists() else {}
    interfaces = detail.get("interfaces", {})
    portable = [name for name in ["mcp", "cli", "http"] if interfaces.get(name, {}).get("status") == "supported"]
    lines = [f"Extension `{dep_id}` is native to Omegon by default."]
    lines.append(f"Install: `omegon extension install {dep_id}`")
    lines.append(f"Registry enabled: {'yes' if enabled else 'no'}")
    if portable:
        lines.append(f"Portable callable interfaces declared: {', '.join(portable)}")
    else:
        lines.append("No portable MCP, CLI, or HTTP interface is declared.")
    return "\n".join(lines)


def resolve_dependency(repo: Path, dep: dict) -> ResolvedDependency:
    kind = dep.get("kind", "")
    dep_id = dep.get("id", "")
    portable = dependency_portable(dep)
    version = dep.get("version", "")
    required = bool(dep.get("required", True))
    activate = dep.get("activate", "manual")

    if kind in {"skill", "persona", "tone"}:
        rel, path = plugin_entrypoint(repo, kind, dep_id)
        return ResolvedDependency(kind, dep_id, version, required, activate, portable, str(path.parent.relative_to(repo)), rel, read(path), None)

    if kind == "extension":
        rel = f"extensions/{dep_id}.toml"
        return ResolvedDependency(kind, dep_id, version, required, activate, False, rel, None, None, extension_note(repo, dep_id))

    if kind == "agent":
        rel = f"catalog/{dep_id}/agent.toml"
        note = f"Catalog agent `{dep_id}` is an Omegon agent blueprint. Export includes this note only unless explicitly made portable."
        return ResolvedDependency(kind, dep_id, version, required, activate, portable, rel, None, None, note)

    if kind == "profile":
        raise SystemExit(f"profile dependency recursion is not implemented yet: {dep_id}")

    raise SystemExit(f"unsupported dependency kind: {kind}")


def resolve_dependencies(repo: Path, manifest: dict, include_optional: bool) -> list[ResolvedDependency]:
    resolved = []
    for dep in manifest.get("dependencies", []):
        required = bool(dep.get("required", True))
        if not required and not include_optional:
            continue
        resolved.append(resolve_dependency(repo, dep))
    return resolved


def generated_header(slug: str, fmt: str) -> str:
    now = dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat()
    return textwrap.dedent(
        f"""
        <!--
        Generated by Omegon Armory profile export.
        Profile: {slug}
        Format: {fmt}
        Generated: {now}
        Do not edit by hand; regenerate from profiles/{slug}/profile.toml.
        -->
        """
    ).strip()


def section_title(dep: ResolvedDependency) -> str:
    labels = {"skill": "Skill", "persona": "Persona", "tone": "Tone", "agent": "Agent", "extension": "Extension"}
    return f"{labels.get(dep.kind, dep.kind.title())}: {dep.id}"


def provenance_table(deps: list[ResolvedDependency]) -> str:
    lines = ["| Kind | ID | Version | Required | Activation | Source | Included |", "|---|---|---|---:|---|---|---:|"]
    for dep in deps:
        included = "yes" if dep.content else "note"
        lines.append(f"| {dep.kind} | {dep.id} | {dep.version} | {str(dep.required).lower()} | {dep.activate} | `{dep.source_path}` | {included} |")
    return "\n".join(lines)


def native_notes(deps: list[ResolvedDependency]) -> list[ResolvedDependency]:
    return [dep for dep in deps if dep.note]


def portable_deps(deps: list[ResolvedDependency]) -> list[ResolvedDependency]:
    return [dep for dep in deps if dep.content]


def render_generic(slug: str, manifest: dict, deps: list[ResolvedDependency], include_native_notes: bool) -> str:
    profile = manifest["profile"]
    defaults = manifest["defaults"]
    parts = [
        generated_header(slug, "generic-markdown"),
        f"# {profile['name']}",
        profile["description"],
        "## Profile metadata",
        f"- Profile: `{slug}`",
        f"- Version: `{profile['version']}`",
        f"- Category: `{profile['category']}`",
        f"- Source: `profiles/{slug}/profile.toml`",
        "## Native Omegon defaults",
        f"- Persona: `{defaults['persona']}`",
        f"- Tone: `{defaults['tone']}`",
        f"- Posture: `{defaults['posture']}`",
        f"- Thinking level: `{defaults['thinking_level']}`",
        f"- Max turns: `{defaults['max_turns']}`",
        "## Included portable dependencies",
    ]
    for dep in portable_deps(deps):
        parts.extend([f"### {section_title(dep)}", f"_Source: `{dep.content_path}`_", dep.content or ""])
    notes = native_notes(deps)
    if include_native_notes and notes:
        parts.append("## Native-only dependencies")
        for dep in notes:
            parts.extend([f"### {section_title(dep)}", dep.note or ""])
    parts.extend(["## Provenance", provenance_table(deps)])
    return "\n\n".join(parts).rstrip() + "\n"


def render_agents(slug: str, manifest: dict, deps: list[ResolvedDependency], include_native_notes: bool) -> str:
    profile = manifest["profile"]
    parts = [generated_header(slug, "agents-md"), "# AGENTS.md", f"Generated from Omegon Armory profile `{slug}`: {profile['description']}"]
    for heading, kinds in [("Agent operating instructions", {"persona"}), ("Response style", {"tone"}), ("Skills", {"skill"})]:
        selected = [dep for dep in portable_deps(deps) if dep.kind in kinds]
        if selected:
            parts.append(f"## {heading}")
            for dep in selected:
                parts.extend([f"### {dep.id}", dep.content or ""])
    notes = native_notes(deps)
    if include_native_notes and notes:
        parts.append("## Native Omegon-only setup notes")
        for dep in notes:
            parts.extend([f"### {dep.id}", dep.note or ""])
    parts.extend(["## Provenance", provenance_table(deps)])
    return "\n\n".join(parts).rstrip() + "\n"


def render_claude(slug: str, manifest: dict, deps: list[ResolvedDependency], include_native_notes: bool) -> str:
    profile = manifest["profile"]
    defaults = manifest["defaults"]
    parts = [generated_header(slug, "claude-md"), "# CLAUDE.md", f"Generated from `{slug}` ({profile['name']}).", "## Role and posture", f"Posture: `{defaults['posture']}`. Thinking level: `{defaults['thinking_level']}`."]
    for dep in portable_deps(deps):
        heading = {"persona": "Role instructions", "tone": "Communication style", "skill": f"{dep.id} rules"}.get(dep.kind, dep.id)
        parts.extend([f"## {heading}", dep.content or ""])
    notes = native_notes(deps)
    if include_native_notes and notes:
        parts.append("## Native Omegon-only notes")
        for dep in notes:
            parts.extend([f"### {dep.id}", dep.note or ""])
    parts.extend(["## Provenance", provenance_table(deps)])
    return "\n\n".join(parts).rstrip() + "\n"


def render_cursor(slug: str, manifest: dict, deps: list[ResolvedDependency], include_native_notes: bool) -> str:
    profile = manifest["profile"]
    parts = [generated_header(slug, "cursor-rules"), f"You are operating under the Omegon Armory profile `{slug}`: {profile['description']}"]
    for dep in portable_deps(deps):
        parts.extend([f"## {section_title(dep)}", dep.content or ""])
    if include_native_notes:
        notes = native_notes(deps)
        if notes:
            parts.append("## Native-only setup notes")
            for dep in notes:
                parts.extend([f"### {dep.id}", dep.note or ""])
    parts.extend(["## Provenance", provenance_table(deps)])
    return "\n\n".join(parts).rstrip() + "\n"


def render(slug: str, manifest: dict, deps: list[ResolvedDependency], fmt: str, include_native_notes: bool) -> str:
    if fmt == "generic-markdown":
        return render_generic(slug, manifest, deps, include_native_notes)
    if fmt == "agents-md":
        return render_agents(slug, manifest, deps, include_native_notes)
    if fmt == "claude-md":
        return render_claude(slug, manifest, deps, include_native_notes)
    if fmt == "cursor-rules":
        return render_cursor(slug, manifest, deps, include_native_notes)
    raise SystemExit(f"unsupported format: {fmt}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("profile")
    parser.add_argument("--format", choices=sorted(FORMATS), default=None)
    parser.add_argument("--out", default="-")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--include-optional", action="store_true")
    parser.add_argument("--no-native-notes", action="store_true")
    args = parser.parse_args()

    repo = Path(args.repo_root).resolve()
    _root, manifest = load_profile(repo, args.profile)
    export_config = manifest.get("export", {})
    fmt = args.format or export_config.get("default_format", "generic-markdown")
    include_optional = args.include_optional or bool(export_config.get("include_optional", False))
    include_native_notes = not args.no_native_notes and bool(export_config.get("include_native_notes", True))

    deps = resolve_dependencies(repo, manifest, include_optional)
    output = render(args.profile, manifest, deps, fmt, include_native_notes)
    if args.out == "-":
        sys.stdout.write(output)
    else:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(output, encoding="utf-8")


if __name__ == "__main__":
    main()
