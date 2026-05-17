#!/usr/bin/env python3
"""Generate public site catalog JSON from Armory manifests and OCI build output."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import tomllib
from pathlib import Path


REPO_URL = "https://github.com/styrene-lab/omegon-armory"


def load_toml(path: Path) -> dict:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def iter_files(root: Path) -> list[str]:
    return [str(path.relative_to(root)) for path in sorted(root.rglob("*")) if path.is_file()]


def source_url(source_path: str) -> str:
    return f"{REPO_URL}/tree/main/{source_path}"


def github_blob_url(source_path: str) -> str:
    return f"{REPO_URL}/blob/main/{source_path}"


def publisher_from_url(url: str) -> str:
    if "github.com/styrene-lab/" in url:
        return "Styrene Lab"
    if "github.com/" in url:
        parts = url.removeprefix("https://github.com/").split("/")
        return parts[0] if parts else "Unknown"
    return "Unknown"


def keywords(*values: str) -> list[str]:
    seen = []
    for value in values:
        for part in str(value).replace("/", " ").replace("-", " ").split():
            normalized = part.strip().lower()
            if normalized and normalized not in seen:
                seen.append(normalized)
    return seen


def plugin_install_command(source_path: str) -> str:
    return f"omegon plugin install ./{source_path}"


def plugin_install_note(source_path: str) -> str:
    return (
        "Text-only plugin. Clone the armory repository first, then run this "
        f"from the repository root to symlink ./{source_path} into OMEGON_HOME."
    )


def oci_items(oci_dir: Path) -> dict[tuple[str, str], dict]:
    index_path = oci_dir / "index.json"
    if not index_path.exists():
        return {}
    data = json.loads(index_path.read_text())
    return {(item["kind"], item["id"]): item for item in data.get("items", [])}


def dependency_install_command(dep: dict) -> str:
    kind = dep.get("kind", "")
    dep_id = dep.get("id", "")
    if kind in {"skill", "persona", "tone"}:
        root = {"skill": "skills", "persona": "personas", "tone": "tones"}[kind]
        return f"omegon plugin install ./{root}/{dep_id}"
    if kind == "extension":
        return f"omegon extension install {dep_id}"
    if kind == "agent":
        return "omegon catalog install"
    if kind == "profile":
        return f"omegon profile install {dep_id}"
    return ""


def dependency_compatibility(dep: dict, enabled: bool = True) -> dict:
    kind = dep.get("kind", "")
    if kind in {"skill", "persona", "tone"}:
        return {"tier": 1, "mode": "prompt-compatible"}
    if kind in {"profile", "agent"}:
        return {"tier": 2, "mode": "manifest-compatible"}
    if kind == "extension":
        return {
            "tier": 0,
            "mode": "native-extension" if enabled else "staged-extension",
            "nativeOnly": True,
        }
    return {"tier": 0, "mode": "unknown"}


def normalize_dependencies(deps: list[dict], enabled_extensions: dict[str, bool] | None = None) -> list[dict]:
    values = []
    enabled_extensions = enabled_extensions or {}
    for dep in deps:
        kind = dep.get("kind", "")
        dep_id = dep.get("id", "")
        enabled = True
        if kind == "extension":
            enabled = bool(enabled_extensions.get(dep_id, False))
        values.append(
            {
                "kind": kind,
                "id": dep_id,
                "version": dep.get("version", ""),
                "required": bool(dep.get("required", True)),
                "enabled": enabled,
                "installCommand": dependency_install_command(dep),
                "compatibility": dependency_compatibility(dep, enabled),
            }
        )
    return values


def plugin_catalog(repo: Path, oci: dict[tuple[str, str], dict]) -> list[dict]:
    items = []
    roots = {"skills": "skill", "personas": "persona", "tones": "tone"}

    for root_name, kind in roots.items():
        root = repo / root_name
        if not root.exists():
            continue
        for item_dir in sorted(path for path in root.iterdir() if path.is_dir()):
            manifest_path = item_dir / "plugin.toml"
            if not manifest_path.exists():
                continue
            manifest = load_toml(manifest_path)
            plugin = manifest["plugin"]
            slug = item_dir.name
            source_path = f"{root_name}/{slug}"
            oci_item = oci.get((kind, slug), {})
            oci_ref = oci_item.get("ref")
            items.append(
                {
                    "kind": kind,
                    "id": slug,
                    "name": plugin["name"],
                    "version": plugin["version"],
                    "description": plugin["description"],
                    "category": kind,
                    "sourcePath": source_path,
                    "sourceUrl": source_url(source_path),
                    "repositoryUrl": REPO_URL,
                    "homepageUrl": source_url(source_path),
                    "armoryUrl": source_url(source_path),
                    "installCommand": plugin_install_command(source_path),
                    "installNote": plugin_install_note(source_path),
                    "verifyCommand": f"cosign verify {oci_ref}" if oci_ref else "",
                    "ociRef": oci_ref or "",
                    "artifactType": oci_item.get("artifact_type", ""),
                    "payloadDigest": oci_item.get("payload_digest", ""),
                    "manifestId": plugin["id"],
                    "license": plugin.get("license", "MIT"),
                    "minOmegon": plugin.get("min_omegon", ""),
                    "publisher": "Styrene Lab",
                    "official": True,
                    "capabilities": plugin_capabilities(kind, manifest),
                    "keywords": keywords(kind, slug, plugin["name"], plugin["description"]),
                    "files": iter_files(item_dir),
                    "dependencies": [],
                    "distribution": "oci" if oci_ref else "registry",
                }
            )
    return items


def profile_catalog(repo: Path, oci: dict[tuple[str, str], dict], extension_registry: dict) -> list[dict]:
    root = repo / "profiles"
    if not root.exists():
        return []
    enabled_extensions = {
        name: bool(entry.get("enabled", False))
        for name, entry in extension_registry.items()
        if isinstance(entry, dict)
    }
    items = []
    for item_dir in sorted(path for path in root.iterdir() if path.is_dir()):
        manifest_path = item_dir / "profile.toml"
        if not manifest_path.exists():
            continue
        manifest = load_toml(manifest_path)
        profile = manifest["profile"]
        slug = profile.get("slug", item_dir.name)
        source_path = f"profiles/{slug}"
        oci_item = oci.get(("profile", slug), {})
        oci_ref = oci_item.get("ref")
        dependencies = normalize_dependencies(manifest.get("dependencies", []), enabled_extensions)
        items.append(
            {
                "kind": "profile",
                "id": slug,
                "name": profile["name"],
                "version": profile["version"],
                "description": profile["description"],
                "category": profile.get("category", "profile"),
                "sourcePath": source_path,
                "sourceUrl": source_url(source_path),
                "repositoryUrl": REPO_URL,
                "homepageUrl": source_url(source_path),
                "armoryUrl": source_url(source_path),
                "installCommand": f"omegon profile install {slug}",
                "installNote": "Profile meta-package. Installs a curated stack of personas, tones, skills, and optional extensions.",
                "verifyCommand": f"cosign verify {oci_ref}" if oci_ref else "",
                "ociRef": oci_ref or "",
                "artifactType": oci_item.get("artifact_type", ""),
                "payloadDigest": oci_item.get("payload_digest", ""),
                "manifestId": profile["id"],
                "license": profile.get("license", "MIT"),
                "minOmegon": profile.get("min_omegon", ""),
                "publisher": "Styrene Lab",
                "official": True,
                "capabilities": profile_capabilities(manifest),
                "keywords": keywords("profile", slug, profile.get("category", "profile"), profile["description"]),
                "files": iter_files(item_dir),
                "dependencies": dependencies,
                "distribution": "oci" if oci_ref else "registry",
            }
        )
    return items


def catalog_agents(repo: Path, oci: dict[tuple[str, str], dict]) -> list[dict]:
    registry_path = repo / "catalog-registry.toml"
    extension_registry_path = repo / "registry.toml"
    if not registry_path.exists():
        return []
    registry = load_toml(registry_path)
    extension_registry = load_toml(extension_registry_path) if extension_registry_path.exists() else {}
    items = []
    for agent_id, entry in sorted(registry.items()):
        if not isinstance(entry, dict):
            continue
        source_path = f"catalog/{agent_id}"
        agent_manifest_path = repo / source_path / "agent.toml"
        agent_manifest = load_toml(agent_manifest_path) if agent_manifest_path.exists() else {}
        dependencies = agent_dependencies(agent_manifest, extension_registry)
        oci_item = oci.get(("agent", agent_id), {})
        oci_ref = oci_item.get("ref")
        items.append(
            {
                "kind": "agent",
                "id": agent_id,
                "name": entry["name"],
                "version": entry["version"],
                "description": entry["description"],
                "category": entry["domain"],
                "sourcePath": source_path,
                "sourceUrl": source_url(source_path),
                "repositoryUrl": REPO_URL,
                "homepageUrl": source_url(source_path),
                "armoryUrl": source_url(source_path),
                "installCommand": "omegon catalog install",
                "installNote": "Installs or updates all currently bundled catalog agents.",
                "verifyCommand": f"cosign verify {oci_ref}" if oci_ref else "",
                "ociRef": oci_ref or "",
                "artifactType": oci_item.get("artifact_type", ""),
                "payloadDigest": oci_item.get("payload_digest", ""),
                "manifestId": agent_id,
                "license": "MIT",
                "minOmegon": entry.get("min_omegon", ""),
                "publisher": "Styrene Lab",
                "official": True,
                "capabilities": agent_capabilities(entry),
                "keywords": keywords("agent", agent_id, entry["domain"], entry["description"]),
                "files": entry.get("files", iter_files(repo / source_path)),
                "dependencies": dependencies,
                "distribution": "oci" if oci_ref else "registry",
            }
        )
    return items


def extensions(repo: Path) -> list[dict]:
    registry_path = repo / "registry.toml"
    if not registry_path.exists():
        return []
    registry = load_toml(registry_path)
    items = []
    for ext_id, entry in sorted(registry.items()):
        if not isinstance(entry, dict) or not entry.get("enabled", True):
            continue
        distribution = entry.get("distribution", "registry")
        installable = bool(entry.get("installable", distribution == "registry"))
        detail_path = repo / "extensions" / f"{ext_id}.toml"
        detail_manifest = load_toml(detail_path) if detail_path.exists() else {}
        detail = detail_manifest.get("extension", {})
        files = [str(detail_path.relative_to(repo))] if detail_path.exists() else []
        repo_url = entry["repo"]
        homepage = detail.get("homepage", repo_url)
        source_path = f"extensions/{ext_id}.toml"
        items.append(
            {
                "kind": "extension",
                "id": ext_id,
                "name": ext_id,
                "version": entry.get("version", "latest"),
                "description": entry["description"],
                "category": entry["category"],
                "sourcePath": source_path,
                "sourceUrl": homepage,
                "repositoryUrl": repo_url,
                "homepageUrl": homepage,
                "armoryUrl": github_blob_url(source_path),
                "installCommand": f"omegon extension install {ext_id}" if installable else f"See upstream integration: {repo_url}",
                "installNote": "Installs by name from the Omegon extension registry." if installable else "External community integration. Use the declared CLI/OCI interfaces; not installable as a native Omegon extension yet.",
                "verifyCommand": "",
                "ociRef": "",
                "artifactType": "",
                "payloadDigest": "",
                "manifestId": entry.get("manifest_path", ""),
                "license": entry.get("license", ""),
                "minOmegon": entry.get("min_sdk", ""),
                "publisher": publisher_from_url(repo_url),
                "official": repo_url.startswith("https://github.com/styrene-lab/"),
                "capabilities": extension_capabilities(detail_path),
                "keywords": keywords("extension", ext_id, entry["category"], entry["description"]),
                "files": files,
                "dependencies": [],
                "interfaces": normalize_interfaces(detail_manifest.get("interfaces", {})),
                "distribution": distribution,
            }
        )
    return items


def plugin_capabilities(kind: str, manifest: dict) -> list[str]:
    if kind == "skill":
        return ["guidance"]
    if kind == "tone":
        values = ["tone"]
        if manifest.get("tone", {}).get("exemplars"):
            values.append("exemplars")
        return values
    if kind == "persona":
        persona = manifest.get("persona", {})
        values = ["persona"]
        if persona.get("mind"):
            values.append("memory")
        if persona.get("skills"):
            values.append("skills")
        if persona.get("tools"):
            values.append("tool policy")
        return values
    return []


def profile_capabilities(manifest: dict) -> list[str]:
    values = ["curated stack"]
    kinds = []
    for dep in manifest.get("dependencies", []):
        kind = dep.get("kind")
        if kind and kind not in kinds:
            kinds.append(kind)
    values.extend(kinds)
    if any(not dep.get("required", True) for dep in manifest.get("dependencies", [])):
        values.append("optional deps")
    return values


def agent_capabilities(entry: dict) -> list[str]:
    values = [entry.get("domain", "agent")]
    files = entry.get("files", [])
    if "agent.pkl" in files:
        values.append("pkl")
    if any(file.startswith("mind/") for file in files):
        values.append("memory")
    return values


def agent_dependencies(agent_manifest: dict, extension_registry: dict) -> list[dict]:
    return normalize_dependencies(agent_manifest.get("extensions", []), {
        name: bool(entry.get("enabled", False))
        for name, entry in extension_registry.items()
        if isinstance(entry, dict)
    })



def normalize_interfaces(interfaces: dict) -> dict:
    normalized = {}
    for name in ["omegon", "mcp", "cli", "http", "oci"]:
        raw = interfaces.get(name, {}) if isinstance(interfaces, dict) else {}
        if not isinstance(raw, dict):
            raw = {}
        entry = {"status": raw.get("status", "none")}
        for key, value in raw.items():
            if key != "status":
                entry[key] = value
        normalized[name] = entry
    return normalized

def extension_capabilities(detail_path: Path) -> list[str]:
    if not detail_path.exists():
        return []
    detail = load_toml(detail_path)
    values = []
    for section in ["tools", "cli", "secrets", "integrations", "external_dependencies"]:
        if section in detail:
            values.extend(detail[section].keys())
    return sorted(values)



def compatibility_for_item(item: dict) -> dict:
    """Return conservative cross-runtime compatibility metadata for a generated catalog item."""
    kind = item.get("kind", "")
    install_command = item.get("installCommand", "")
    files = set(item.get("files", []))

    native_modes = {
        "skill": "plugin",
        "persona": "plugin",
        "tone": "plugin",
        "profile": "profile",
        "agent": "catalog-agent",
        "extension": "extension",
    }
    compatibility = {
        "tier": 0,
        "native": [
            {
                "runtime": "omegon",
                "mode": native_modes.get(kind, "package"),
                "installCommand": install_command,
            }
        ],
        "degraded": [],
        "notes": [],
    }

    if kind == "skill":
        compatibility["tier"] = 1
        compatibility["degraded"].append(
            {
                "runtime": "generic-agent",
                "mode": "instructions",
                "entrypoints": ["SKILL.md"] if "SKILL.md" in files else item.get("files", []),
            }
        )
    elif kind == "persona":
        compatibility["tier"] = 1
        compatibility["degraded"].append(
            {
                "runtime": "generic-agent",
                "mode": "system-prompt",
                "entrypoints": ["PERSONA.md"] if "PERSONA.md" in files else item.get("files", []),
            }
        )
        if any(file.startswith("mind/") for file in files):
            compatibility["notes"].append(
                "Memory seed files are optional and may be ignored by non-Omegon runtimes."
            )
    elif kind == "tone":
        compatibility["tier"] = 1
        compatibility["degraded"].append(
            {
                "runtime": "generic-agent",
                "mode": "style-instructions",
                "entrypoints": ["TONE.md"] if "TONE.md" in files else item.get("files", []),
            }
        )
    elif kind == "profile":
        compatibility["tier"] = 2
        compatibility["degraded"].append(
            {
                "runtime": "generic-agent",
                "mode": "dependency-manifest",
                "entrypoints": [entry for entry in ["profile.toml", "README.md"] if entry in files],
            }
        )
        compatibility["notes"].append(
            "Profiles require dependency resolution before prompt export outside Omegon."
        )
    elif kind == "agent":
        compatibility["tier"] = 2
        compatibility["degraded"].append(
            {
                "runtime": "generic-agent",
                "mode": "agent-blueprint",
                "entrypoints": [entry for entry in ["agent.toml", "PERSONA.md"] if entry in files],
            }
        )
        if "agent.pkl" in files:
            compatibility["notes"].append(
                "agent.pkl is Omegon-native and may be ignored by other runtimes."
            )
    elif kind == "extension":
        interfaces = item.get("interfaces", {})
        portable = [
            name
            for name in ["mcp", "cli", "http", "oci"]
            if interfaces.get(name, {}).get("status") == "supported"
        ]
        compatibility["tier"] = 3 if portable else 0
        compatibility["degraded"].append(
            {
                "runtime": "generic-agent",
                "mode": "external-tool-reference",
                "entrypoints": ["repositoryUrl", "homepageUrl"],
            }
        )
        for name in portable:
            compatibility["degraded"].append(
                {
                    "runtime": f"generic-{name}",
                    "mode": f"{name}-interface",
                    "entrypoints": ["interfaces"],
                }
            )
        if portable:
            compatibility["notes"].append(
                f"Portable callable interface declared: {', '.join(portable)}."
            )
        else:
            compatibility["notes"].append(
                "Portable callable interfaces require explicit MCP, CLI, or HTTP metadata."
            )

    return compatibility

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--oci", default="site/.cache/oci")
    parser.add_argument("--out", default="site/src/data/armory.json")
    parser.add_argument("--api", default="site/public/api/index.json")
    args = parser.parse_args()

    repo = Path.cwd()
    oci = oci_items(Path(args.oci))
    extension_registry_path = repo / "registry.toml"
    extension_registry = load_toml(extension_registry_path) if extension_registry_path.exists() else {}
    items = extensions(repo)
    items.extend(plugin_catalog(repo, oci))
    items.extend(profile_catalog(repo, oci, extension_registry))
    items.extend(catalog_agents(repo, oci))
    items.sort(key=lambda item: (item["kind"], item["id"]))
    for item in items:
        item["compatibility"] = compatibility_for_item(item)

    registry = ""
    index_path = Path(args.oci) / "index.json"
    if index_path.exists():
        registry = json.loads(index_path.read_text()).get("registry", "")

    payload = {
        "generatedAt": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat(),
        "registry": registry,
        "items": items,
    }

    for target in [Path(args.out), Path(args.api)]:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")

    print(f"Wrote {len(items)} site catalog entries")


if __name__ == "__main__":
    main()
