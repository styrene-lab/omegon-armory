# Profile Schema v1

This document defines the public Armory profile manifest contract. Profiles are meta-packages: they describe a curated environment by referencing other Armory artifacts instead of copying dependency payloads.

## File layout

A profile lives at:

```text
profiles/<slug>/
├── profile.toml
├── README.md
└── LOCK.json          # optional
```

`<slug>` is the public package ID and must match `profile.slug`.

## Manifest structure

```toml
[profile]
schema = "dev.styrene.omegon.profile.v1"
id = "dev.styrene.omegon.profile.python-shop"
slug = "python-shop"
name = "Python Shop"
version = "1.0.0"
description = "Curated Python engineering stack for code review, feature work, testing, packaging, and secure service development."
category = "engineering"
license = "MIT"
min_omegon = "0.21.0"

[defaults]
posture = "architect"
thinking_level = "medium"
max_turns = 50
persona = "systems-engineer"
tone = "concise"

[export]
default_format = "generic-markdown"
include_optional = false
include_native_notes = true

[[dependencies]]
kind = "persona"
id = "systems-engineer"
version = ">=1.0.0"
required = true
activate = "always"
scope = "global"
purpose = "Default systems-engineering persona."
portable = true
```

## `[profile]`

| Field | Required | Rule |
|---|---:|---|
| `schema` | recommended now, required later | Must be `dev.styrene.omegon.profile.v1` when present. |
| `id` | yes | Must be `dev.styrene.omegon.profile.<slug>`. |
| `slug` | yes | Must match the directory name. |
| `name` | yes | Human label. |
| `version` | yes | Strict semver `MAJOR.MINOR.PATCH`. |
| `description` | yes | Public description, max 220 chars. |
| `category` | yes | Controlled public category. |
| `license` | yes | SPDX-style license string. |
| `min_omegon` | yes | Minimum native Omegon version, `MAJOR.MINOR.PATCH`. |

Allowed categories for public Armory v1:

```text
engineering
knowledge
operations
review
```

## `[defaults]`

Defaults describe native Omegon runtime posture. They are hints for degraded exports.

| Field | Required | Rule |
|---|---:|---|
| `posture` | yes | `architect`, `implementer`, `reviewer`, `operator`, or `analyst`. |
| `thinking_level` | yes | `low`, `medium`, `high`, or `max`. |
| `max_turns` | yes | Integer 1–200. |
| `persona` | yes | Must match a required `persona` dependency. |
| `tone` | yes | Must match a required `tone` dependency. |

## `[export]`

Export settings describe non-native degradation defaults. This section is optional for backward compatibility; when absent, exporters use conservative defaults.

| Field | Default | Rule |
|---|---:|---|
| `default_format` | `generic-markdown` | `generic-markdown`, `agents-md`, `claude-md`, or `cursor-rules`. |
| `include_optional` | `false` | Whether optional portable dependencies are included by default. |
| `include_native_notes` | `true` | Whether native-only extension setup notes are rendered. |

## `[[dependencies]]`

| Field | Required | Rule |
|---|---:|---|
| `kind` | yes | `skill`, `persona`, `tone`, `extension`, `agent`, or `profile`. |
| `id` | yes | Armory package ID; no paths or URLs. |
| `version` | yes | Semver range or exact version. |
| `required` | yes | Required dependencies must resolve before native activation. |
| `activate` | yes | `always`, `auto`, or `manual`. |
| `scope` | recommended | `global`, `project`, or `session`. Defaults to `global`. |
| `purpose` | recommended | Short public rationale for why the dependency exists. |
| `portable` | recommended | Whether degraded exporters may include the dependency as content. |
| `source` | no | Named Armory source for multi-index installs. |

Dependency portability defaults by kind:

| Kind | Default portable | Degraded behavior |
|---|---:|---|
| `skill` | true | Include `SKILL.md` as instructions. |
| `persona` | true | Include `PERSONA.md` as role/system prompt. |
| `tone` | true | Include `TONE.md` as style guidance. |
| `profile` | true | Resolve recursively if cycle-free. |
| `agent` | false | Include blueprint note only unless explicitly portable. |
| `extension` | false | Native setup note only unless a portable interface is declared. |

## Resolver invariants

A valid public profile must satisfy:

1. `profile.slug` matches the directory name.
2. `profile.id` matches `dev.styrene.omegon.profile.<slug>`.
3. `defaults.persona` is a required persona dependency.
4. `defaults.tone` is a required tone dependency.
5. Dependencies are unique by `(kind, id)`.
6. Required dependency references resolve in the current public Armory registry.
7. Profile dependencies are acyclic.
8. Extension dependencies may be optional unless the runtime truly cannot operate without them.
9. Native-only dependencies are not silently included in degraded exports.
10. Public payload lint passes for `profile.toml`, `README.md`, and optional `LOCK.json`.

## Lock file shape

Official profile releases should eventually publish `LOCK.json` for reproducibility:

```json
{
  "schema": "dev.styrene.omegon.profile.lock.v1",
  "profile": "python-shop",
  "resolvedAt": "2026-05-17T00:00:00Z",
  "dependencies": [
    {
      "kind": "skill",
      "id": "python",
      "version": "1.0.0",
      "ref": "ghcr.io/styrene-lab/omegon-armory/skills/python:1.0.0",
      "digest": "sha256:..."
    }
  ]
}
```

Profiles may remain floating during early public Armory development. Locked official releases are the target state before treating profiles as reproducible install units.

## Exporter implementation

The repo-local exporter renders profile dependencies into degraded prompt/config formats:

```bash
python3 scripts/export-profile.py python-shop --format generic-markdown --out dist/exports/python-shop.md
python3 scripts/export-profile.py security-review --format agents-md --out dist/exports/AGENTS.md
python3 scripts/export-profile.py typescript-shop --format claude-md --out dist/exports/CLAUDE.md
python3 scripts/export-profile.py docs-vault --format cursor-rules --out dist/exports/.cursorrules
```

Rules:

- required portable dependencies are included by default;
- optional portable dependencies require `--include-optional` unless the profile export config says otherwise;
- native extensions render as setup notes, not prompt content;
- exports include provenance and generated-file headers;
- profile dependency recursion, lockfile resolution, OCI registry resolution, and memory fact export are intentionally deferred.

## Exporter implications

Exporters should:

- include required portable dependencies by default;
- include optional portable dependencies only when requested or when `export.include_optional = true`;
- render native-only extensions as setup notes, not prompt instructions;
- include provenance for every included dependency;
- preserve profile defaults as metadata;
- fail on unresolved required dependencies.
