# Public Payload Security Posture

Armory packages are not just source files. They are redistributed as a public agentic package surface and may be automatically ingested by other agent runtimes. That changes the risk profile: a line that is harmless inside a private repository can become public prompt context, tool configuration, or memory seed.

This document records the second- and third-order effects that the public payload lint is intended to control.

## First-Order Risks

These are direct publication failures:

- raw API keys, tokens, passwords, or private keys;
- private IP addresses and internal hostnames;
- environment-specific topology names;
- private operational memory facts;
- copied incident details or deployment notes;
- credentials embedded in examples instead of placeholders.

The scanner in `scripts/lint-public-payloads.py` blocks high-confidence forms of these issues using `security/public-payload-lint.toml`.

## Second-Order Risks

### Automated Ingestion Amplifies Leaks

Armory compatibility metadata makes package consumption easier for non-Omegon agents. That is useful, but it means leaked operational context may be copied into:

- generated `AGENTS.md` / `CLAUDE.md` / Cursor rules;
- downstream prompt packs;
- private and public mirrors;
- model context windows;
- issue trackers or CI logs when agents summarize installed packages.

A topology leak is therefore not confined to the website. It can become durable prompt material.

### Metadata Can Leak Even When Payloads Do Not

Risky information can appear in:

- package IDs;
- descriptions;
- dependency IDs;
- extension interface fields;
- install commands;
- homepage or repository URLs;
- memory section names.

The lint scans registry and manifest metadata, not only markdown content, because metadata is part of the public API.

### Native-Only Packages Still Influence Other Agents

Even when an extension degrades to `external-tool-reference`, other agents may read its metadata and infer capabilities. Interface metadata must not overclaim MCP/CLI/HTTP support, and security notes must avoid revealing private deployment assumptions.

### Memory Seeds Are Especially Sensitive

`mind/facts.jsonl` looks like harmless context, but it is designed to be loaded directly into an agent's durable knowledge. Public memory facts must be reusable product/ecosystem facts, not local operational memory.

## Third-Order Risks

### Mirrors Preserve Mistakes

OCI registries, static mirrors, forks, and search indexes can preserve leaked payloads after the source repository is fixed. Publication review must happen before release, not after discovery.

### Exporters Can Recombine Context

Future `armory export` tools will compose profiles by pulling skills, personas, tones, and agents together. A safe individual package may become risky when combined with another package that supplies private context or tool access.

Mitigation: profile exports should preserve provenance and keep native-only tool setup notes separate from prompt instructions.

### Interface Metadata May Become Tool Authority

If another runtime treats `interfaces.mcp`, `interfaces.cli`, or `interfaces.http` as permission to call a tool, incorrect metadata can expose dangerous operations. Interface support should be declared only when the callable contract exists and security expectations are known.

### Documentation Examples Shape Real Configurations

Examples often get copied into production. Use clearly fake placeholders and avoid realistic internal values unless explicitly allowlisted as examples. Prefer:

```text
example.internal.invalid
TOKEN_PLACEHOLDER
192.0.2.10
```

over home-lab, production, or real private network details.

## Scanner Policy

The scanner policy lives at:

```text
security/public-payload-lint.toml
```

It controls:

- allowlisted documentation placeholders;
- private topology terms;
- private domain suffixes;
- secret key names;
- high-entropy token thresholds;
- scanned text suffixes.

Private/federated Armories should maintain their own policy file with organization-specific topology terms. The public Styrene Armory policy should remain strict.

## Operational Rules

- Treat every public Armory payload as world-readable and mirrorable.
- Do not put private environment facts in public personas, agents, profiles, or extension manifests.
- Add organization-specific terms to `deny.topology_terms` before adding new catalog agents.
- Prefer fake documentation placeholders over realistic values.
- If the scanner blocks an example, either make the example less realistic or add a narrow allowlist with a comment explaining why it is safe.
- If a real secret is ever published, rotate it. Removing it from Git is not enough.

## Current Known Limits

The scanner is not a replacement for review. It can miss:

- natural-language sensitive context that has no configured topology term;
- screenshots or binary assets;
- secrets split across multiple lines;
- secrets hidden in archives that are not unpacked before scanning;
- valid-looking public domains that are still private by convention.

The mitigation is defense in depth: lint, review, conservative package scope, and private/federated Armory for environment-specific agents.
