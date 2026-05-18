#!/usr/bin/env python3
"""Resolve the immutable release tag for an Armory site promotion.

The public site is a generated artifact over repository catalog data. Requiring a
manual package.json bump for every catalog/profile/extension-only change created
a repeated failure mode: validation and OCI publication succeeded, but production
promotion failed because the old semver tag already existed.

This resolver keeps the human semver from site/package.json as the release
series, then derives an immutable promotion tag from the target commit:

    v<site-version>+site.<short-sha>

The tag is unique per promoted commit, still semver-valid, and no longer depends
on unrelated manual version-bump commits.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

SEMVER_RE = re.compile(
    r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?"
)


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def tag_exists(tag: str) -> bool:
    result = subprocess.run(
        ["git", "rev-parse", "-q", "--verify", f"refs/tags/{tag}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sha", required=True, help="Commit SHA being promoted")
    parser.add_argument("--package", default="site/package.json")
    args = parser.parse_args()

    version = json.loads(Path(args.package).read_text())["version"]
    if not SEMVER_RE.fullmatch(version):
        raise SystemExit(f"site/package.json version is not semver: {version}")

    full_sha = git("rev-parse", args.sha)
    short_sha = full_sha[:7]
    tag = f"v{version}+site.{short_sha}"

    if tag_exists(tag):
        tagged_sha = git("rev-list", "-n", "1", tag)
        if tagged_sha != full_sha:
            raise SystemExit(f"Tag {tag} exists but points to {tagged_sha}, not {full_sha}")
        print(f"version={version}")
        print(f"tag={tag}")
        print("tag_exists=true")
        return

    print(f"version={version}")
    print(f"tag={tag}")
    print("tag_exists=false")


if __name__ == "__main__":
    main()
