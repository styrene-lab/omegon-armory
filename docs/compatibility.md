# Armory Compatibility Model

Armory is the public package registry for Omegon-native agentic additions, but its artifact shapes intentionally overlap with broader agent ecosystems: prompt packs, agent cards, MCP servers, CLI tools, tool manifests, and project instruction files.

The compatibility goal is **full fidelity in Omegon, graceful degradation everywhere else**.

Omegon remains the native runtime. Other agent hosts should still be able to consume Armory packages as useful prompts, manifests, tool descriptors, or dependency recommendations without implementing the full Omegon environment.

## Core Principle

An Armory package has three layers:

1. **Payload** — markdown, TOML, JSON, archives, source pointers, or native extension artifacts.
2. **Metadata** — package kind, id, version, description, capabilities, dependencies, digest, and source.
3. **Compatibility contract** — how the package behaves in Omegon and what it degrades to elsewhere.

The compatibility contract should be explicit and machine-readable. Consumers should not have to infer whether a package is a prompt, tool, profile, agent blueprint, or native-only extension.

## Compatibility Tiers

| Tier | Name | Meaning | Typical consumers |
|---|---|---|---|
| 0 | Human-readable | Package page or README is useful, but no automation is promised. | Operators, docs sites |
| 1 | Prompt-compatible | Payload can be loaded as system/project/task instructions. | Claude Code, Codex, Cursor, Aider, Roo, generic chat agents |
| 2 | Manifest-compatible | Payload describes dependencies/configuration that another runtime can transform. | Profile resolvers, agent launchers, registry bridges |
| 3 | Tool-compatible | Package exposes callable tools through MCP, CLI, HTTP, or another portable interface. | MCP clients, tool routers, agent harnesses |
| 4 | Native-compatible | Package installs and runs with full fidelity in Omegon. | Omegon |

Every public Armory package should support tier 0. Most text packages should support tier 1. Profiles and agents should support tier 2. Extensions should aim for tier 3 where possible.

## Package Kind Matrix

| Kind | Native Omegon behavior | Degraded behavior | Current rating | Target rating |
|---|---|---|---|---|
| `skill` | Loaded as behavior guidance. | Markdown instruction pack, checklist, policy doc, prompt fragment. | High | High |
| `persona` | Loaded as identity, posture, optional memory/tool policy. | System prompt/role prompt; memory seed optional. | High | High |
| `tone` | Loaded as response style modifier. | Writing-style instruction. | High | High |
| `profile` | Installs/activates curated dependency stack. | Dependency manifest and recommended agent config bundle. | Medium-high | High |
| `agent` | Catalog-installable Omegon agent bundle. | Agent blueprint: prompt, config, memory seed, tool requirements. | Medium | High |
| `extension` | Native extension install and tool exposure. | External tool reference; MCP/CLI/HTTP bridge where declared. | Medium-low | High |
| `index` | Searchable registry of Armory artifacts. | Public package index for external resolvers. | High | High |

## Degradation Ladder

A consumer should use the highest supported level and fall back safely:

```text
Level 5: Native Omegon install
Level 4: Armory-aware resolver using package dependencies and compatibility metadata
Level 3: OCI pull + manifest interpretation
Level 2: API index + raw GitHub source fetch
Level 1: Plain markdown prompt/manual instruction
Level 0: Human-readable package page
```

A failed high-fidelity install should not make the package useless. It should expose the lower-fidelity path.

## Source Package Contracts

### Skills

Skills are the most portable Armory package.

Native behavior:

```text
omegon plugin install ./skills/<id>
```

Degraded behavior:

- read guidance markdown;
- inject as project instructions;
- convert to host-specific rule files;
- use as checklist or review policy.

Portable entrypoints:

```text
plugin.toml
GUIDANCE.md or equivalent guidance file
```

Target compatibility metadata:

```json
{
  "native": [{ "runtime": "omegon", "mode": "plugin" }],
  "degraded": [
    {
      "runtime": "generic-agent",
      "mode": "instructions",
      "entrypoints": ["GUIDANCE.md"]
    }
  ]
}
```

### Personas

Personas are also highly portable.

Native behavior:

```text
persona + posture + optional memory/tool policy
```

Degraded behavior:

- system prompt;
- role prompt;
- assistant card;
- optional memory seed where supported.

Portable entrypoints:

```text
plugin.toml
PERSONA.md
mind/facts.jsonl  # optional, public-safe only
```

Degradation rules:

- if memory is unsupported, ignore `mind/facts.jsonl`;
- if tool policy is unsupported, treat it as advisory text;
- if persona metadata is unsupported, use `PERSONA.md` only.

### Tones

Tones should remain style-only and avoid policy/tool semantics.

Native behavior:

```text
response style modifier
```

Degraded behavior:

- writing style instruction;
- response formatting guide;
- tone preamble.

Portable entrypoints:

```text
plugin.toml
TONE.md or tone guidance file
```

### Profiles

Profiles are Armory meta-packages. They reference dependencies instead of copying them.

Native behavior:

```text
omegon profile install <id>
```

Degraded behavior:

- dependency manifest;
- recommended stack;
- source for generated `AGENTS.md`, `CLAUDE.md`, Cursor rules, or similar project files.

Portable entrypoints:

```text
profile.toml
README.md
LOCK.json  # optional, for reproducible pinned profiles
```

Profile dependency metadata should be sufficient to answer:

- which dependencies are required?
- which are optional?
- which should activate automatically?
- which require native Omegon extension support?
- which can be rendered as prompt material elsewhere?

Example external transform:

```text
python-shop profile
  -> systems-engineer persona
  -> concise tone
  -> python/security/git skills
  -> optional openspec/oci skills
  -> optional flynt extension reference
  -> generated AGENTS.md / CLAUDE.md / .cursor/rules
```

### Catalog Agents

Catalog agents are native Omegon bundles, but their contents should include a portable subset.

Native behavior:

```text
omegon catalog install
```

Degraded behavior:

- assistant blueprint;
- prompt + settings recipe;
- memory seed;
- tool requirement list;
- runbook automation template.

Portable entrypoints:

```text
agent.toml   # portable manifest subset
PERSONA.md   # role prompt
mind/*       # optional public-safe memory seed
agent.pkl    # native Omegon representation; other hosts may ignore
```

The portable `agent.toml` subset should be documented separately from the native `agent.pkl` representation.

### Extensions

Extensions are the hard edge because they may expose native tools, background services, UI surfaces, browser integrations, or model pipelines.

Native behavior:

```text
omegon extension install <id>
```

Degraded behavior:

1. MCP interface if declared.
2. CLI interface if declared.
3. HTTP/OpenAPI interface if declared.
4. Manual external tool reference if no callable interface exists.

Target extension interface metadata:

```toml
[interfaces.omegon]
status = "supported"
install = "omegon extension install flynt"

[interfaces.mcp]
status = "planned" # supported|planned|none
transport = "stdio"
tools = ["canvas_active", "canvas_set_cells"]

[interfaces.cli]
status = "none"

[interfaces.http]
status = "none"
```

A non-Omegon host should never assume an extension is callable just because it exists in Armory. It should inspect declared interfaces.

## Generated API Shape

The public API should eventually add a `compatibility` object to each item.

Initial generated shape:

```json
{
  "compatibility": {
    "tier": 1,
    "native": [
      {
        "runtime": "omegon",
        "mode": "plugin",
        "installCommand": "omegon plugin install ./skills/security"
      }
    ],
    "degraded": [
      {
        "runtime": "generic-agent",
        "mode": "instructions",
        "entrypoints": ["GUIDANCE.md"]
      }
    ],
    "notes": []
  }
}
```

Kind-specific default generation is acceptable for the first implementation. Source manifests can grow explicit overrides later.

## External Runtime Mappings

Armory should not deeply couple to every agent host, but common export targets are useful.

| Target | Export form |
|---|---|
| Generic agent | Concatenated markdown instructions + dependency notes |
| Claude Code | `CLAUDE.md` sections or skill-like folders |
| Codex-style coding agents | `AGENTS.md` sections |
| Cursor | `.cursor/rules/*.md` |
| Aider | conventions markdown / repo map notes |
| MCP clients | MCP server declaration from extension interface metadata |
| OpenAI/Anthropic tool runners | tool descriptors derived from MCP/HTTP metadata where possible |

A future `armory export` command can implement these transforms without changing package payloads.

## Import Model

Armory can also normalize external ecosystems.

| External thing | Armory representation |
|---|---|
| Prompt library entry | `skill`, `persona`, or `tone` |
| Claude Code skill | `skill` |
| Cursor rule | `skill` or profile dependency |
| MCP server | `extension` with `[interfaces.mcp]` |
| CLI tool | `extension` with `[interfaces.cli]` |
| OpenAPI service | `extension` with `[interfaces.http]` |
| Assistant/agent card | `agent` |
| Curated project stack | `profile` |

The import rule: preserve the original artifact where useful, but declare the portable Armory kind and compatibility tier explicitly.

## Security Boundaries

Compatibility increases redistribution. Treat all public Armory payloads as world-readable.

Public packages must not contain:

- raw secrets;
- private hostnames that reveal sensitive topology;
- internal IP addresses;
- private incident details;
- home-lab or production operational specifics not intended for publication;
- credentials by value;
- environment-specific memory facts unless intentionally public.

Private or organization-specific packages belong in a private/federated Armory, not the public Styrene Armory.

`mind/facts.jsonl`, `PERSONA.md`, `agent.toml`, `profile.toml`, and extension manifests need the same review standard as source code.

## Plan of Action

### Phase 1: Document and expose defaults

- Publish this compatibility model.
- Add generated `compatibility` metadata to `site/public/api/index.json` and `site/src/data/armory.json`.
- Generate conservative defaults by package kind.
- Add tests that every public item has compatibility metadata.
- Keep source manifests unchanged unless an override is needed.

Acceptance criteria:

- API consumers can tell how to use each package outside Omegon.
- Existing site build remains static and generated from manifests.
- No package loses native Omegon install metadata.

### Phase 2: Extension interface metadata

- Add `[interfaces.omegon]` to every enabled extension detail file.
- Add `[interfaces.mcp]`, `[interfaces.cli]`, and `[interfaces.http]` sections where known.
- Treat undeclared portable tool interfaces as unsupported.
- Render interface support on extension pages.

Acceptance criteria:

- Non-Omegon hosts can distinguish callable extensions from documentation-only extensions.
- MCP bridge candidates are visible without implying support that does not exist.

### Phase 3: Export transforms

- Add an `armory export` design/API for transforming packages into host-specific files.
- Start with no-runtime transforms:
  - `generic-markdown`
  - `agents-md`
  - `claude-md`
  - `cursor-rules`
- Profiles should resolve dependency graphs and render required prompt-compatible dependencies.
- Extensions without portable interfaces should render as setup notes only.

Acceptance criteria:

- A non-Omegon user can export `python-shop` into useful project instructions.
- Optional/native-only dependencies are clearly marked, not silently dropped.

### Phase 4: Import and bridge external ecosystems

- Define import conventions for MCP servers, CLI tools, prompt packs, and agent cards.
- Add validation for imported package metadata.
- Consider private/federated Armory workflows for organization-specific imports.

Acceptance criteria:

- Armory can represent external agentic additions without pretending they are Omegon-native.
- Native support and degraded support are explicit.

### Phase 5: Compatibility conformance tests

- Add fixture tests for each kind.
- Verify all package pages and API records expose compatibility data.
- Verify profile dependencies map to compatibility entries.
- Verify extension interface sections do not overclaim support.
- Add secret/topology linting for portable payloads.

Acceptance criteria:

- Publication fails if a package lacks compatibility metadata.
- Publication fails if public payloads contain obvious private operational material.

## Design Decisions

- Omegon is the full-fidelity runtime, not the only consumer.
- Degradation is a first-class feature, not an accidental side effect.
- Profiles reference dependencies; they do not copy dependency payloads.
- Extensions must declare portable interfaces before other hosts treat them as callable tools.
- Public Armory is for generally reusable packages. Private operational agents belong in private/federated Armory.
