# Plugin Specification — `plugin.toml`

Version: 1.0.0

This document is the authoritative specification for Omegon plugin manifests. All plugins in the armory and third-party plugins must conform to this spec.

---

## Overview

An Omegon plugin is a directory containing a `plugin.toml` manifest and associated files. Plugins are installed via `omegon plugin install <uri>` and managed through the CLI or TUI settings.

## Manifest Structure

### `[plugin]` — Required

Every plugin must have a `[plugin]` section with these fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | ✅ | One of: `persona`, `tone`, `skill`, `extension` |
| `id` | string | ✅ | Reverse-domain identifier, e.g. `dev.styrene.omegon.tutor` |
| `name` | string | ✅ | Human-readable display name |
| `version` | string | ✅ | Semantic version (e.g. `1.0.0`) |
| `description` | string | ✅ | One-line description, under 200 characters |
| `authors` | string[] | | List of author names or handles |
| `license` | string | | SPDX license identifier (e.g. `Apache-2.0`, `MIT`) |
| `min_omegon` | string | | Minimum Omegon version required |

**ID convention:** Use reverse-domain notation: `{tld}.{org}.{product}.{name}`. Official plugins use `dev.styrene.omegon.*`. Third parties use their own domain.

**Version:** Must follow [Semantic Versioning 2.0.0](https://semver.org/).

```toml
[plugin]
type = "persona"
id = "dev.styrene.omegon.tutor"
name = "Socratic Tutor"
version = "1.0.0"
description = "Patient, skilled tutor — guides through questioning, never lectures"
authors = ["styrene-lab"]
license = "Apache-2.0"
min_omegon = "0.15.0"
```

---

### `[persona]` — Persona plugins only

#### `[persona.identity]`

| Field | Type | Required | Description |
|---|---|---|---|
| `directive` | string | ✅ | Path to the behavioral directive markdown file (relative to plugin root) |

The directive file (typically `PERSONA.md`) must contain:
- A `# Title` heading
- At least one behavioral principle section
- A "What NOT To Do" or equivalent anti-pattern section

#### `[persona.mind]`

| Field | Type | Required | Description |
|---|---|---|---|
| `seed_facts` | string | | Path to seed facts file (JSONL format) |
| `seed_episodes` | string | | Path to seed episodes file (JSONL format) |

**Seed facts format:** One JSON object per line with these fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `section` | string | ✅ | Memory section (e.g. `Domain`, `Constraints`) |
| `content` | string | ✅ | The fact content |
| `confidence` | number | ✅ | Confidence score, 0.0–1.0 |
| `source` | string | | Attribution for the fact |
| `tags` | string[] | | Searchable tags |

```jsonl
{"section":"Domain","content":"CAP theorem: ...","confidence":0.95,"source":"brewer-2000","tags":["distributed","cap"]}
```

#### `[persona.skills]`

| Field | Type | Required | Description |
|---|---|---|---|
| `activate` | string[] | | Skill plugin IDs or names to auto-activate |
| `deactivate` | string[] | | Skill plugin IDs or names to deactivate |

#### `[persona.tools]`

| Field | Type | Required | Description |
|---|---|---|---|
| `profile` | string | | Tool profile name to apply (e.g. `default`, `restricted`) |
| `enable` | string[] | | Additional tools to force-enable |
| `disable` | string[] | | Tools to force-disable |

Valid tool names: `bash`, `read`, `write`, `edit`, `view`, `web_search`, `memory_store`, `memory_recall`, `memory_query`, `design_tree`, `design_tree_update`, `openspec_manage`, `cleave_assess`, `cleave_run`, `whoami`, `chronos`, `ask_local_model`, `manage_ollama`, `set_model_tier`, `set_thinking_level`, `manage_tools`.

#### `[persona.routing]`

| Field | Type | Required | Description |
|---|---|---|---|
| `default_thinking` | string | | Default thinking level: `off`, `minimal`, `low`, `medium`, `high` |

#### `[persona.tone]`

| Field | Type | Required | Description |
|---|---|---|---|
| `default` | string | | Default tone plugin ID or name. Operator can override. |

#### `[persona.style]`

| Field | Type | Required | Description |
|---|---|---|---|
| `badge` | string | | Emoji or short string shown in the dashboard footer |
| `accent_color` | string | | Hex color for UI accents (e.g. `#2ab4c8`) |

---

### `[tone]` — Tone plugins only

| Field | Type | Required | Description |
|---|---|---|---|
| `directive` | string | ✅ | Path to the voice directive markdown file |
| `exemplars` | string | | Path to exemplars directory (contains `.md` files showing the voice) |

The directive file (typically `TONE.md`) should be under 2000 characters. Tones are injected into every response — brevity matters.

#### `[tone.intensity]`

| Field | Type | Required | Description |
|---|---|---|---|
| `design` | string | | Intensity during design/creative work: `full` (default), `muted`, `off` |
| `coding` | string | | Intensity during coding/execution: `full`, `muted` (default), `off` |

---

### `[skill]` — Skill plugins only

| Field | Type | Required | Description |
|---|---|---|---|
| `guidance` | string | ✅ | Path to the skill guidance markdown file |

The guidance file (typically `SKILL.md`) must have a `# Title` heading and at least one `## Section`.

---

### `[detect]` — Optional, any type

File-signature-based auto-detection. When present, Omegon can suggest activating this plugin when matching files are found in a project.

| Field | Type | Required | Description |
|---|---|---|---|
| `file_patterns` | string[] | | Glob patterns to match (e.g. `*.kicad_pcb`, `Cargo.toml`) |
| `directories` | string[] | | Directory names to match (e.g. `gerbers/`, `src/`) |
| `default` | boolean | | If `true`, this plugin is activated when no other plugin matches |

Detection is **suggest-only** — the operator must confirm activation. Once confirmed for a project, the choice persists in project settings.

---

## Directory Layout

```
my-plugin/
├── plugin.toml           # manifest (required)
├── PERSONA.md            # persona directive (persona type)
├── TONE.md               # tone directive (tone type)
├── SKILL.md              # skill guidance (skill type)
├── mind/                 # persona mind store
│   ├── facts.jsonl       # seed facts
│   └── episodes.jsonl    # seed episodes
├── exemplars/            # tone voice exemplars
│   └── *.md
├── skills/               # bundled skills (persona type)
│   └── sub-skill/
│       ├── plugin.toml
│       └── SKILL.md
└── README.md             # human-readable description
```

## Installation

```bash
# From git URL
omegon plugin install https://github.com/org/repo

# From git URL, specific subdirectory
omegon plugin install https://github.com/org/repo/personas/tutor

# From local path
omegon plugin install ./path/to/plugin

# List installed plugins
omegon plugin list

# Show plugin details
omegon plugin info <id>

# Remove a plugin
omegon plugin remove <id>

# Update from source
omegon plugin update <id>
```

## Validation Rules

1. `plugin.type` must be one of: `persona`, `tone`, `skill`, `extension`
2. `plugin.id` must have at least 3 dot-separated segments
3. `plugin.version` must be valid semver
4. `plugin.description` must be non-empty and under 200 characters
5. All file paths in the manifest must resolve to existing files within the plugin directory
6. Plugin IDs must be unique across all installed plugins
7. Mind store JSONL lines must have `section`, `content`, and `confidence` (0.0–1.0) fields
8. `TONE.md` should be under 2000 characters
9. `PERSONA.md` must include an anti-pattern section
10. Tool names in `disable`/`enable` must be recognized by the Omegon tool registry
