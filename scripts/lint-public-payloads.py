#!/usr/bin/env python3
"""Lint public Armory payloads for obvious secrets and private topology leaks.

This scanner is intentionally conservative: it blocks high-confidence raw secret
patterns and common private network/topology material in files that are shipped
through the public catalog or OCI artifacts.
"""

from __future__ import annotations

import argparse
import ipaddress
import re
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

TEXT_SUFFIXES = {
    ".md",
    ".toml",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".txt",
    ".pkl",
}

SECRET_ASSIGNMENT_RE = re.compile(
    r"(?i)\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|private[_-]?key)\b\s*=\s*\"?[^\"\s][^\n\"]{8,}\"?"
)
SECRET_VALUE_RE = re.compile(
    r"(?i)\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b"
)
PRIVATE_KEY_RE = re.compile(r"-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----")
PRIVATE_HOST_RE = re.compile(r"(?i)\b([a-z0-9-]+\.)+(local|lan|internal|home|corp)\b")
SUSPICIOUS_HOME_NAMES_RE = re.compile(r"(?i)\b(brutus|jellyfin|jellyseerr|radarr|sonarr|prowlarr|qbittorrent|sabnzbd|forgejo)\b")
IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")

ALLOWLIST_PATTERNS = [
    re.compile(r"127\.0\.0\.1"),
    re.compile(r"0\.0\.0\.0"),
    re.compile(r"localhost", re.I),
    re.compile(r"10\.0\.1\.50"),  # documentation example in shuttle detail metadata
    re.compile(r"192\.168\.1\.100"),  # documentation example in shuttle detail metadata
    re.compile(r"VOX_[A-Z0-9_]+_TOKEN"),
    re.compile(r"ANTHROPIC_API_KEY"),
    re.compile(r"GITHUB_TOKEN"),
    re.compile(r"FORGEJO_TOKEN"),
    re.compile(r"COSIGN_EXPERIMENTAL"),
    re.compile(r"sk-abc123"),
    re.compile(r"process\.env\.[A-Z0-9_]+"),
]


@dataclass(frozen=True)
class Finding:
    path: Path
    line: int
    rule: str
    text: str


def load_toml(path: Path) -> dict:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def iter_catalog_files(repo: Path) -> set[Path]:
    files: set[Path] = set()
    registry_path = repo / "catalog-registry.toml"
    if not registry_path.exists():
        return files
    registry = load_toml(registry_path)
    for agent_id, entry in registry.items():
        if not isinstance(entry, dict):
            continue
        for file_name in entry.get("files", []):
            files.add(repo / "catalog" / agent_id / file_name)
    return files


def iter_public_payload_files(repo: Path) -> list[Path]:
    files: set[Path] = set()
    for root_name in ["skills", "personas", "tones", "profiles"]:
        root = repo / root_name
        if root.exists():
            files.update(path for path in root.rglob("*") if path.is_file())
    files.update(iter_catalog_files(repo))
    files.update(path for path in (repo / "extensions").glob("*.toml") if path.is_file())
    files.update([repo / "registry.toml", repo / "catalog-registry.toml"])
    return sorted(path for path in files if path.exists() and path.suffix in TEXT_SUFFIXES)


def allowlisted(line: str) -> bool:
    return any(pattern.search(line) for pattern in ALLOWLIST_PATTERNS)


def private_ip(line: str) -> bool:
    for match in IPV4_RE.finditer(line):
        try:
            address = ipaddress.ip_address(match.group(0))
        except ValueError:
            continue
        if address.is_private and not address.is_loopback:
            return True
    return False


def scan_file(repo: Path, path: Path) -> list[Finding]:
    findings: list[Finding] = []
    try:
        text = path.read_text(encoding="utf8")
    except UnicodeDecodeError:
        return findings

    for number, line in enumerate(text.splitlines(), start=1):
        if allowlisted(line):
            continue
        checks = [
            ("private-key", bool(PRIVATE_KEY_RE.search(line))),
            ("secret-assignment", bool(SECRET_ASSIGNMENT_RE.search(line))),
            ("secret-value", bool(SECRET_VALUE_RE.search(line))),
            ("private-hostname", bool(PRIVATE_HOST_RE.search(line))),
            ("private-ip", private_ip(line)),
            ("private-topology-name", bool(SUSPICIOUS_HOME_NAMES_RE.search(line))),
        ]
        for rule, matched in checks:
            if matched:
                findings.append(
                    Finding(
                        path=path.relative_to(repo),
                        line=number,
                        rule=rule,
                        text=line.strip()[:220],
                    )
                )
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=".")
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    findings: list[Finding] = []
    for path in iter_public_payload_files(repo):
        findings.extend(scan_file(repo, path))

    if findings:
        print("Public payload lint failed:", file=sys.stderr)
        for finding in findings:
            print(
                f"{finding.path}:{finding.line}: {finding.rule}: {finding.text}",
                file=sys.stderr,
            )
        return 1

    print("Public payload lint passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
