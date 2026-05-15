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
    return [
        str(path.relative_to(root))
        for path in sorted(root.rglob("*"))
        if path.is_file()
    ]


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
            repo_url = REPO_URL

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
                    "repositoryUrl": repo_url,
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
                    "distribution": "oci" if oci_ref else "registry",
                }
            )

    return items


def catalog_agents(repo: Path, oci: dict[tuple[str, str], dict]) -> list[dict]:
    registry_path = repo / "catalog-registry.toml"
    if not registry_path.exists():
        return []
    registry = load_toml(registry_path)
    items = []

    for agent_id, entry in sorted(registry.items()):
        if not isinstance(entry, dict):
            continue
        source_path = f"catalog/{agent_id}"
        oci_item = oci.get(("agent", agent_id), {})
        oci_ref = oci_item.get("ref")
        repo_url = REPO_URL
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
                "repositoryUrl": repo_url,
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
        if not isinstance(entry, dict):
            continue
        if not entry.get("enabled", True):
            continue
        detail_path = repo / "extensions" / f"{ext_id}.toml"
        detail = load_toml(detail_path).get("extension", {}) if detail_path.exists() else {}
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
                "installCommand": f"omegon extension install {ext_id}",
                "installNote": "Installs by name from the Omegon extension registry.",
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
                "distribution": "registry",
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


def agent_capabilities(entry: dict) -> list[str]:
    values = [entry.get("domain", "agent")]
    files = entry.get("files", [])
    if "agent.pkl" in files:
        values.append("pkl")
    if any(file.startswith("mind/") for file in files):
        values.append("memory")
    return values


def extension_capabilities(detail_path: Path) -> list[str]:
    if not detail_path.exists():
        return []
    detail = load_toml(detail_path)
    values = []
    for section in ["tools", "cli", "secrets", "integrations", "external_dependencies"]:
        if section in detail:
            values.extend(detail[section].keys())
    return sorted(values)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--oci", default="site/.cache/oci")
    parser.add_argument("--out", default="site/src/data/armory.json")
    parser.add_argument("--api", default="site/public/api/index.json")
    args = parser.parse_args()

    repo = Path.cwd()
    oci = oci_items(Path(args.oci))
    items = extensions(repo)
    items.extend(plugin_catalog(repo, oci))
    items.extend(catalog_agents(repo, oci))
    items.sort(key=lambda item: (item["kind"], item["id"]))

    payload = {
        "generatedAt": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat(),
        "items": items,
    }

    for target in [Path(args.out), Path(args.api)]:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")

    print(f"Wrote {len(items)} site catalog entries")


if __name__ == "__main__":
    main()
