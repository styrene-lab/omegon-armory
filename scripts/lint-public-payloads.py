#!/usr/bin/env python3
"""Lint public Armory payloads for secrets and private topology leaks.

The scanner blocks high-confidence secret patterns and configurable private
network/topology material in files shipped through the public catalog or OCI
artifacts. It is deliberately stricter than a generic secret scanner because
Armory payloads are intended for broad automated ingestion by other agents.
"""

from __future__ import annotations

import argparse
import ipaddress
import math
import re
import sys
import tomllib
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

DEFAULT_POLICY = "security/public-payload-lint.toml"

SECRET_VALUE_RE = re.compile(
    r"(?i)\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b"
)
PRIVATE_KEY_RE = re.compile(r"-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----")
IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
HOSTLIKE_RE = re.compile(r"(?i)\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\b")
ASSIGNMENT_RE = re.compile(r"(?i)\b([a-z0-9_-]*(?:key|token|secret|password|passwd)[a-z0-9_-]*)\b\s*[=:]\s*[\"']?([^\"'\s#,}]+)")
BEARER_RE = re.compile(r"(?i)\b(?:bearer|token)\s+[A-Za-z0-9._~+/=-]{24,}\b")
HIGH_ENTROPY_TOKEN_RE = re.compile(r"\b[A-Za-z0-9+/=_-]{24,}\b")


@dataclass(frozen=True)
class Policy:
    text_suffixes: set[str]
    allow_patterns: list[re.Pattern[str]]
    topology_terms: list[str]
    topology_re: re.Pattern[str] | None
    private_domain_suffixes: set[str]
    secret_keys: set[str]
    min_entropy_token_length: int
    min_entropy: float


@dataclass(frozen=True)
class Finding:
    path: Path
    line: int
    rule: str
    text: str


def load_toml(path: Path) -> dict:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def load_policy(repo: Path, policy_path: str) -> Policy:
    raw = load_toml(repo / policy_path)
    allow_patterns = [re.compile(pattern) for pattern in raw.get("allow", {}).get("patterns", [])]
    topology_terms = [str(term) for term in raw.get("deny", {}).get("topology_terms", [])]
    topology_re = None
    if topology_terms:
        topology_re = re.compile(r"(?i)\b(" + "|".join(re.escape(term) for term in topology_terms) + r")\b")
    return Policy(
        text_suffixes=set(raw.get("files", {}).get("text_suffixes", [])),
        allow_patterns=allow_patterns,
        topology_terms=topology_terms,
        topology_re=topology_re,
        private_domain_suffixes={
            str(value).lower() for value in raw.get("deny", {}).get("private_domain_suffixes", [])
        },
        secret_keys={str(value).lower() for value in raw.get("deny", {}).get("secret_keys", [])},
        min_entropy_token_length=int(raw.get("limits", {}).get("min_entropy_token_length", 24)),
        min_entropy=float(raw.get("limits", {}).get("min_entropy", 4.2)),
    )


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


def iter_public_payload_files(repo: Path, policy: Policy) -> list[Path]:
    files: set[Path] = set()
    for root_name in ["skills", "personas", "tones", "profiles"]:
        root = repo / root_name
        if root.exists():
            files.update(path for path in root.rglob("*") if path.is_file())
    files.update(iter_catalog_files(repo))
    files.update(path for path in (repo / "extensions").glob("*.toml") if path.is_file())
    files.update([repo / "registry.toml", repo / "catalog-registry.toml"])
    return sorted(path for path in files if path.exists() and path.suffix in policy.text_suffixes)


def allowlisted(policy: Policy, line: str) -> bool:
    return any(pattern.search(line) for pattern in policy.allow_patterns)


def private_ip(line: str) -> bool:
    for match in IPV4_RE.finditer(line):
        try:
            address = ipaddress.ip_address(match.group(0))
        except ValueError:
            continue
        if address.is_private and not address.is_loopback:
            return True
    return False


def private_hostname(policy: Policy, line: str) -> bool:
    for match in HOSTLIKE_RE.finditer(line):
        suffix = match.group(0).rsplit(".", 1)[-1].lower()
        if suffix in policy.private_domain_suffixes:
            return True
    return False


def entropy(value: str) -> float:
    if not value:
        return 0.0
    counts = Counter(value)
    length = len(value)
    return -sum((count / length) * math.log2(count / length) for count in counts.values())


def high_entropy_token(policy: Policy, line: str) -> bool:
    for match in HIGH_ENTROPY_TOKEN_RE.finditer(line):
        token = match.group(0)
        if len(token) >= policy.min_entropy_token_length and entropy(token) >= policy.min_entropy:
            return True
    return False


def suspicious_assignment(policy: Policy, line: str) -> bool:
    for match in ASSIGNMENT_RE.finditer(line):
        key = match.group(1).lower().replace("-", "_")
        value = match.group(2)
        normalized_keys = {secret_key.replace("-", "_") for secret_key in policy.secret_keys}
        if key in normalized_keys or any(key.endswith(secret_key) for secret_key in normalized_keys):
            if len(value) >= 8 and not value.startswith("$"):
                return True
    return False


def scan_file(repo: Path, policy: Policy, path: Path) -> list[Finding]:
    findings: list[Finding] = []
    try:
        text = path.read_text(encoding="utf8")
    except UnicodeDecodeError:
        return findings

    for number, line in enumerate(text.splitlines(), start=1):
        if allowlisted(policy, line):
            continue
        checks = [
            ("private-key", bool(PRIVATE_KEY_RE.search(line))),
            ("secret-assignment", suspicious_assignment(policy, line)),
            ("secret-value", bool(SECRET_VALUE_RE.search(line))),
            ("bearer-token", bool(BEARER_RE.search(line))),
            ("high-entropy-token", high_entropy_token(policy, line)),
            ("private-hostname", private_hostname(policy, line)),
            ("private-ip", private_ip(line)),
            ("private-topology-name", bool(policy.topology_re and policy.topology_re.search(line))),
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
    parser.add_argument("--policy", default=DEFAULT_POLICY)
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    policy = load_policy(repo, args.policy)
    findings: list[Finding] = []
    for path in iter_public_payload_files(repo, policy):
        findings.extend(scan_file(repo, policy, path))

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
