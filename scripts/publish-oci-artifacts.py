#!/usr/bin/env python3
"""Publish generated Armory OCI payloads with ORAS and optionally sign with cosign."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


def run(cmd: list[str], dry_run: bool) -> None:
    print("+", " ".join(cmd))
    if not dry_run:
        subprocess.run(cmd, check=True)


def annotation_args(annotations: dict[str, str]) -> list[str]:
    args: list[str] = []
    for key, value in sorted(annotations.items()):
        args.extend(["--annotation", f"{key}={value}"])
    return args


def publish_item(out_dir: Path, item: dict, dry_run: bool, sign: bool) -> None:
    payload = out_dir / item["payload"]
    ref = item["ref"]
    cmd = [
        "oras",
        "push",
        ref,
        "--artifact-type",
        item["artifact_type"],
        *annotation_args(item.get("annotations", {})),
        str(payload),
    ]
    run(cmd, dry_run)
    run(["oras", "manifest", "fetch", ref], dry_run)
    if sign:
        run(["cosign", "sign", "--yes", ref], dry_run)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="dist/oci")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--sign", action="store_true")
    args = parser.parse_args()

    out_dir = Path(args.out)
    index = json.loads((out_dir / "index.json").read_text())
    for item in index["items"]:
        publish_item(out_dir, item, args.dry_run, args.sign)

    index_descriptor = json.loads((out_dir / "index-descriptor.json").read_text())
    publish_item(out_dir, index_descriptor, args.dry_run, args.sign)


if __name__ == "__main__":
    main()
