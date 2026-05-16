#!/usr/bin/env python3
"""Build OCI payload tarballs and an Armory index from repository contents."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import tarfile
import tomllib
from pathlib import Path


REPO_URL = "https://github.com/styrene-lab/omegon-armory"
INDEX_SCHEMA = "dev.styrene.omegon.armory.index.v1"
MEDIA_TYPES = {
    "skill": "application/vnd.styrene.omegon.skill.v1+tar",
    "persona": "application/vnd.styrene.omegon.persona.v1+tar",
    "tone": "application/vnd.styrene.omegon.tone.v1+tar",
    "agent": "application/vnd.styrene.omegon.agent.v1+tar",
    "profile": "application/vnd.styrene.omegon.profile.v1+tar",
}


def load_toml(path: Path) -> dict:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def iter_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in sorted(root.rglob("*")):
        if path.is_file():
            files.append(path)
    return files


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def write_tarball(source_dir: Path, files: list[Path], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(out_path, "w:gz", format=tarfile.PAX_FORMAT) as archive:
        for path in files:
            archive.add(path, arcname=path.relative_to(source_dir))


def plugin_items(repo: Path, registry: str, out_dir: Path) -> list[dict]:
    items: list[dict] = []
    roots = {
        "skills": "skill",
        "personas": "persona",
        "tones": "tone",
    }

    for root_name, expected_kind in roots.items():
        root = repo / root_name
        if not root.is_dir():
            continue
        for item_dir in sorted(path for path in root.iterdir() if path.is_dir()):
            manifest_path = item_dir / "plugin.toml"
            if not manifest_path.exists():
                continue

            manifest = load_toml(manifest_path)
            plugin = manifest["plugin"]
            kind = plugin["type"]
            if kind != expected_kind:
                raise SystemExit(
                    f"{manifest_path}: expected plugin.type={expected_kind!r}, got {kind!r}"
                )

            slug = item_dir.name
            version = plugin["version"]
            rel_path = f"{root_name}/{slug}"
            payload = out_dir / "payloads" / root_name / f"{slug}-{version}.tar.gz"
            files = iter_files(item_dir)
            write_tarball(item_dir, files, payload)
            payload_digest = sha256_file(payload)
            ref = f"{registry}/{root_name}/{slug}:{version}"

            items.append(
                {
                    "kind": kind,
                    "id": slug,
                    "manifest_id": plugin["id"],
                    "name": plugin["name"],
                    "version": version,
                    "description": plugin["description"],
                    "category": kind,
                    "ref": ref,
                    "source_path": rel_path,
                    "payload": str(payload.relative_to(out_dir)),
                    "payload_digest": payload_digest,
                    "artifact_type": MEDIA_TYPES[kind],
                    "annotations": annotations(kind, slug, plugin),
                }
            )

    return items


def profile_items(repo: Path, registry: str, out_dir: Path) -> list[dict]:
    root = repo / "profiles"
    if not root.is_dir():
        return []

    items: list[dict] = []
    for item_dir in sorted(path for path in root.iterdir() if path.is_dir()):
        manifest_path = item_dir / "profile.toml"
        if not manifest_path.exists():
            continue
        manifest = load_toml(manifest_path)
        profile = manifest["profile"]
        slug = profile.get("slug", item_dir.name)
        if slug != item_dir.name:
            raise SystemExit(f"{manifest_path}: profile.slug must match directory name")
        version = profile["version"]
        rel_path = f"profiles/{slug}"
        payload = out_dir / "payloads" / "profiles" / f"{slug}-{version}.tar.gz"
        files = iter_files(item_dir)
        write_tarball(item_dir, files, payload)
        payload_digest = sha256_file(payload)
        ref = f"{registry}/profiles/{slug}:{version}"

        items.append(
            {
                "kind": "profile",
                "id": slug,
                "manifest_id": profile["id"],
                "name": profile["name"],
                "version": version,
                "description": profile["description"],
                "category": profile.get("category", "profile"),
                "ref": ref,
                "source_path": rel_path,
                "payload": str(payload.relative_to(out_dir)),
                "payload_digest": payload_digest,
                "artifact_type": MEDIA_TYPES["profile"],
                "annotations": annotations("profile", slug, profile),
                "dependencies": manifest.get("dependencies", []),
            }
        )

    return items


def catalog_items(repo: Path, registry: str, out_dir: Path) -> list[dict]:
    registry_path = repo / "catalog-registry.toml"
    if not registry_path.exists():
        return []

    registry_toml = load_toml(registry_path)
    items: list[dict] = []
    for agent_id, entry in sorted(registry_toml.items()):
        if not isinstance(entry, dict):
            continue
        source_dir = repo / "catalog" / agent_id
        files = [source_dir / file_name for file_name in entry["files"]]
        missing = [str(path.relative_to(repo)) for path in files if not path.exists()]
        if missing:
            raise SystemExit(f"{agent_id}: missing catalog files: {', '.join(missing)}")

        version = entry["version"]
        payload = out_dir / "payloads" / "catalog" / f"{agent_id}-{version}.tar.gz"
        write_tarball(source_dir, files, payload)
        payload_digest = sha256_file(payload)
        ref = f"{registry}/catalog/{agent_id}:{version}"

        meta = {
            "id": agent_id,
            "name": entry["name"],
            "version": version,
            "description": entry["description"],
            "min_omegon": entry.get("min_omegon", ""),
        }
        items.append(
            {
                "kind": "agent",
                "id": agent_id,
                "manifest_id": agent_id,
                "name": entry["name"],
                "version": version,
                "description": entry["description"],
                "category": entry["domain"],
                "ref": ref,
                "source_path": f"catalog/{agent_id}",
                "payload": str(payload.relative_to(out_dir)),
                "payload_digest": payload_digest,
                "artifact_type": MEDIA_TYPES["agent"],
                "annotations": annotations("agent", agent_id, meta),
            }
        )

    return items


def annotations(kind: str, item_id: str, meta: dict) -> dict[str, str]:
    values = {
        "io.styrene.omegon.kind": kind,
        "io.styrene.omegon.id": item_id,
        "io.styrene.omegon.name": meta.get("name", item_id),
        "io.styrene.omegon.description": meta.get("description", ""),
        "io.styrene.omegon.version": meta.get("version", ""),
        "io.styrene.omegon.min_omegon": meta.get("min_omegon", ""),
        "io.styrene.omegon.source": REPO_URL,
        "org.opencontainers.image.source": REPO_URL,
        "org.opencontainers.image.licenses": meta.get("license", "MIT"),
    }
    return {key: value for key, value in values.items() if value}


def write_index(out_dir: Path, registry: str, items: list[dict]) -> None:
    index = {
        "schema": INDEX_SCHEMA,
        "generated_at": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat(),
        "registry": registry,
        "items": items,
    }
    index_path = out_dir / "index.json"
    index_path.write_text(json.dumps(index, indent=2, sort_keys=True) + "\n")

    payload = out_dir / "payloads" / "index" / "armory-index.tar.gz"
    staging = out_dir / "_index"
    staging.mkdir(parents=True, exist_ok=True)
    staged_index = staging / "index.json"
    staged_index.write_text(index_path.read_text())
    write_tarball(staging, [staged_index], payload)

    index_descriptor = {
        "kind": "index",
        "id": "index",
        "name": "Omegon Armory Index",
        "version": "latest",
        "description": "Searchable index of Omegon Armory OCI artifacts",
        "category": "index",
        "ref": f"{registry}/index:latest",
        "source_path": "index.json",
        "payload": str(payload.relative_to(out_dir)),
        "payload_digest": sha256_file(payload),
        "artifact_type": "application/vnd.styrene.omegon.armory.index.v1+tar",
        "annotations": {
            "io.styrene.omegon.kind": "index",
            "io.styrene.omegon.id": "index",
            "io.styrene.omegon.name": "Omegon Armory Index",
            "io.styrene.omegon.version": "latest",
            "io.styrene.omegon.source": REPO_URL,
            "org.opencontainers.image.source": REPO_URL,
            "org.opencontainers.image.licenses": "MIT",
        },
    }
    (out_dir / "index-descriptor.json").write_text(
        json.dumps(index_descriptor, indent=2, sort_keys=True) + "\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", default="ghcr.io/styrene-lab/omegon-armory")
    parser.add_argument("--out", default="dist/oci")
    args = parser.parse_args()

    repo = Path.cwd()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    items = plugin_items(repo, args.registry, out_dir)
    items.extend(profile_items(repo, args.registry, out_dir))
    items.extend(catalog_items(repo, args.registry, out_dir))
    items.sort(key=lambda item: (item["kind"], item["id"]))
    write_index(out_dir, args.registry, items)

    print(f"Built {len(items)} Armory artifacts")
    print(f"Index: {out_dir / 'index.json'}")


if __name__ == "__main__":
    main()
