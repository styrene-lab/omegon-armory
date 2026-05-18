# Catalog Specification — Agent Bundles

Version: 1.0.0

This document is the authoritative specification for Omegon agent bundles in the armory catalog. All agents in the catalog must conform to this spec.

---

## Overview

An agent bundle is a directory under `catalog/<agent-id>/` containing a manifest and associated files. Agents are installed via `omegon catalog install`, which fetches from this registry and writes to `~/.omegon/catalog/<agent-id>/`.

---

## Directory Structure

```
catalog/
└── styrene.bd-agent/          # Directory name matches the agent ID
    ├── agent.toml             # TOML manifest (required)
    ├── agent.pkl              # Pkl manifest (optional — enables amends inheritance)
    ├── PERSONA.md             # Persona directive (required)
    └── mind/
        └── facts.jsonl        # Seed knowledge facts (optional)
```

---

## catalog-registry.toml

`catalog-registry.toml` at the repo root is the index that `omegon catalog install` fetches first. It maps each agent ID to its metadata and file list.

### Format

```toml
["styrene.bd-agent"]
name = "Business Development"
version = "1.0.0"
domain = "ops"
description = "Short description of what this agent does."
files = ["agent.toml", "agent.pkl", "PERSONA.md", "mind/facts.jsonl"]
```

### TOML Key Quoting — Required

Agent IDs contain dots (e.g. `styrene.bd-agent`). In TOML, an unquoted dotted table header like `[styrene.bd-agent]` is interpreted as **nested tables** — equivalent to `[styrene]` with a sub-key `bd-agent`. This causes a parse error when `omegon` deserializes the registry.

**Always quote agent IDs in table headers:**

```toml
# Correct — literal key "styrene.bd-agent"
["styrene.bd-agent"]
files = [...]

# Wrong — TOML parses as nested tables, omegon will error
[styrene.bd-agent]
files = [...]
```

This applies to any entry whose ID contains a dot. Simple single-word IDs (no dots) do not need quoting.

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable display name |
| `version` | Yes | Semantic version (`MAJOR.MINOR.PATCH`) |
| `domain` | Yes | Agent domain — see [domains](#domains) |
| `description` | Yes | One-sentence description |
| `files` | Yes | List of files to download, relative to `catalog/<agent-id>/` |

The `files` array controls exactly what gets written to `~/.omegon/catalog/<agent-id>/`. Only list files that exist in the bundle directory. Paths with subdirectories (e.g. `mind/facts.jsonl`) are created automatically during install.

---

## agent.toml — TOML Manifest

Every bundle must have an `agent.toml`. This is the primary manifest format and is used as a fallback when the `pkl` binary is not available.

```toml
[agent]
id = "styrene.bd-agent"      # Must match the directory name and registry key
name = "Business Development"
version = "1.0.0"
description = "..."
domain = "ops"

[persona]
directive = "PERSONA.md"
badge = "bd"                 # Optional emoji/short badge for UI display
mind_facts = ["mind/facts.jsonl"]  # One or more JSONL facts files

[[extensions]]
name = "vox"
version = ">=0.3.0"

[settings]
model = "anthropic:claude-sonnet-4-6"
thinking_level = "low"       # off | minimal | low | medium | high
context_class = "squad"      # squad | maniple | clan | legion
max_turns = 50

[workflow]
name = "doc-standard"

[secrets]
required = ["ANTHROPIC_API_KEY"]
optional = ["GOOGLE_OAUTH_TOKEN"]

[secrets.env]
GOOGLE_APPLICATION_CREDENTIALS = "GOOGLE_APPLICATION_CREDENTIALS"

[[triggers]]
name = "weekly-status-report"
schedule = "weekly"          # hourly | daily | weekdays | weekly
template = "..."
```

### Domains

| Domain | Use |
|--------|-----|
| `chat` | Conversational agents (Discord, Slack bridges) |
| `coding` | Software engineering agents |
| `coding-python` | Python-focused coding agents |
| `coding-rust` | Rust-focused coding agents |
| `infra` | Infrastructure / DevOps agents |
| `ops` | Business operations agents |
| `full` | General-purpose agents with full tooling |

### Secrets

Agent bundle `[secrets]` sections follow the same names-only contract as plugin manifests:

```toml
[secrets]
required = ["ANTHROPIC_API_KEY"]
optional = ["VAULT_ROOT_TOKEN"]

[secrets.env]
VAULT_TOKEN = "VAULT_ROOT_TOKEN"
```

Use `required` and `optional` for Omegon secret names, and `[secrets.env]` for environment variables that should be projected for profiled/headless agent runs. Values must be secret names or balanced single-template references such as `{VAULT_ROOT_TOKEN}`, never raw credential values. One-sided braces are invalid, and public payload linting remains the second gate for obvious secret-shaped values.

---

## agent.pkl — Pkl Manifest (Optional)

If `agent.pkl` is present alongside `agent.toml`, it enables **Pkl-native agent inheritance**. Users can create overlay files that extend the base agent without replacing it:

```pkl
// user-overlay.pkl
amends "omegon://catalog/styrene.bd-agent/agent.pkl"

persona {
  mind_facts { ...super; "mind/personal_facts.jsonl" }
  directive_extend { "PERSONA.personal.md" }
}

settings {
  thinking_level = "medium"
}
```

Pkl manifests must use the `omegon://schema/AgentManifest.pkl` URI, not a relative path:

```pkl
// Correct
amends "omegon://schema/AgentManifest.pkl"

// Wrong — resolves relative to the file; fails when installed to ~/.omegon/catalog/
amends "AgentManifest.pkl"
```

The `omegon://` scheme is served by a custom module reader embedded in the binary. `omegon://schema/<name>` serves compiled-in schema files; `omegon://catalog/<id>/path` serves files from `~/.omegon/catalog/<id>/`.

### Workflow Phases in Pkl

When defining workflow phases in a Pkl manifest, the `Mapping` type requires explicit construction syntax. The shorthand block syntax does not work for null-initialized optional mappings:

```pkl
// Correct
workflow = new WorkflowConfig {
  name = "doc-standard"
  phases = new Mapping<String, PhaseConfig> {
    ["drafting"] = new { model = "anthropic:claude-sonnet-4-6"; max_turns = 40 }
    ["reviewing"] = new { model = "anthropic:claude-sonnet-4-6"; max_turns = 20 }
  }
}

// Wrong — shorthand block syntax on nullable Mapping
workflow {
  name = "doc-standard"
  phases {
    ["drafting"] { model = "anthropic:claude-sonnet-4-6" }
  }
}
```

---

## PERSONA.md

The persona directive is free-form Markdown. Conventions:

- Open with a `# Agent Name` heading
- Group responsibilities under `##` headings
- Include an `## Operating principles` section for behavior constraints — things the agent must do or avoid regardless of user instruction
- Include a `## Communication style` section

Keep it action-oriented. The runtime prepends identity metadata automatically; don't repeat name/version/domain information that's already in the manifest.

---

## mind/facts.jsonl

Seed facts are loaded into the agent's working memory at session start. Each line is a JSON object:

```jsonl
{"section":"Category Name","content":"The fact or rule.","confidence":1.0}
```

| Field | Required | Description |
|-------|----------|-------------|
| `section` | Yes | Grouping label (e.g. `"Reporting"`, `"Opportunity Assessment"`) |
| `content` | Yes | The fact, rule, or procedure |
| `confidence` | Yes | Float `0.0`–`1.0`. Use `1.0` for definitive rules, `0.9` for strong conventions, lower for heuristics |

Keep facts atomic — one rule per line. Multi-step procedures are better as a numbered list within a single `content` string than spread across multiple facts.

---

## Adding an Agent to the Catalog

1. Create `catalog/<agent-id>/` with the required files
2. Add a quoted entry to `catalog-registry.toml`:
   ```toml
   ["your-org.agent-name"]
   name = "..."
   version = "1.0.0"
   domain = "..."
   description = "..."
   files = ["agent.toml", "PERSONA.md"]
   ```
3. Update `catalog.rs` in omegon to add the agent to `BUNDLED` for airgap support
4. Submit a PR — include a brief description of the agent's purpose and target user
