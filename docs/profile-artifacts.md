# Profile Artifacts

Omegon profiles are Armory meta-packages: they describe an operator or project environment by referencing other Armory packages. A profile is a 1:N composition object, not a bundle that copies its dependencies.

## Purpose

A profile answers: "what should Omegon load by default for this operator, team, or project?"

A profile may reference:

- personas
- tones
- skills
- extensions
- catalog agents
- other profiles, if cycle-free
- model/tool/default-session settings

Profiles sit above plugins and agents:

```text
Profile
├── default persona
├── default tone
├── default posture/model/tool policy
├── required skills
├── optional skills
├── required extensions
└── optional catalog agents
```

An agent is a runnable configured agent bundle. A profile is an environment composition. Do not collapse profiles into personas; persona identity and environment configuration have different owners and different update lifecycles.

## Source Layout

Profiles live under `profiles/<slug>/`:

```text
profiles/
└── alpharius/
    ├── profile.toml
    ├── README.md
    └── LOCK.json          # optional, for reproducible dependency resolution
```

## Manifest

`profile.toml` is the source of truth.

```toml
[profile]
id = "dev.styrene.omegon.profile.alpharius"
slug = "alpharius"
name = "Alpharius Engineering Profile"
version = "1.0.0"
description = "Systems-engineering Omegon profile with strict evidence and coding posture."
license = "MIT"
min_omegon = "0.21.0"

[defaults]
posture = "architect"
thinking_level = "medium"
max_turns = 50
persona = "systems-engineer"
tone = "concise"

[[dependencies]]
kind = "persona"
id = "systems-engineer"
version = ">=1.0.0"
required = true

[[dependencies]]
kind = "tone"
id = "concise"
version = ">=1.0.0"
required = true

[[dependencies]]
kind = "skill"
id = "security"
version = ">=1.0.0"
required = true
activate = "always"

[[dependencies]]
kind = "skill"
id = "typescript"
version = ">=1.0.0"
required = false
activate = "auto"

[[dependencies]]
kind = "extension"
id = "flynt"
version = ">=0.15"
required = false
```

### Dependency Fields

| Field | Required | Description |
|---|---:|---|
| `kind` | yes | `skill`, `persona`, `tone`, `extension`, `agent`, or `profile` |
| `id` | yes | Armory package ID, not a file path |
| `version` | no | Semver version or range |
| `required` | yes | Install fails if an unresolved required dependency exists |
| `activate` | no | `always`, `auto`, or `manual` |
| `scope` | no | `global`, `project`, or `session` |
| `source` | no | Optional Armory source name for multi-index installs |

Rules:

- `required = true` dependencies must resolve before the profile can be activated.
- `required = false` dependencies warn and continue.
- `activate = always` means the dependency is active whenever the profile is active.
- `activate = auto` means install it, then use detection/context to activate.
- `activate = manual` means install it only; operator controls activation.
- Profile-to-profile dependencies are allowed only when the graph is acyclic.

## OCI Representation

A profile is an OCI artifact, not a container image.

Registry path:

```text
ghcr.io/styrene-lab/omegon-armory/profiles/<slug>:<version>
```

Example:

```text
ghcr.io/styrene-lab/omegon-armory/profiles/alpharius:1.0.0
```

Artifact media type:

```text
application/vnd.styrene.omegon.profile.v1+tar
```

Payload:

```text
profile.toml
README.md
LOCK.json        # optional
```

Required annotations:

```text
io.styrene.omegon.kind=profile
io.styrene.omegon.id=alpharius
io.styrene.omegon.name=Alpharius Engineering Profile
io.styrene.omegon.description=Systems-engineering Omegon profile with strict evidence and coding posture.
io.styrene.omegon.version=1.0.0
io.styrene.omegon.min_omegon=0.21.0
io.styrene.omegon.source=https://github.com/styrene-lab/omegon-armory
org.opencontainers.image.source=https://github.com/styrene-lab/omegon-armory
org.opencontainers.image.licenses=MIT
```

Dependency data remains in `profile.toml` and the Armory index. Do not make OCI annotations the source of truth for dependency graphs; annotations are string metadata and are a poor fit for structured resolver state.

## Armory Index Entry

The Armory index is the resolver map. A profile entry includes the artifact ref and its dependency graph:

```json
{
  "kind": "profile",
  "id": "alpharius",
  "manifest_id": "dev.styrene.omegon.profile.alpharius",
  "name": "Alpharius Engineering Profile",
  "version": "1.0.0",
  "description": "Systems-engineering Omegon profile with strict evidence and coding posture.",
  "category": "profile",
  "ref": "ghcr.io/styrene-lab/omegon-armory/profiles/alpharius:1.0.0",
  "source_path": "profiles/alpharius",
  "payload": "payloads/profiles/alpharius-1.0.0.tar.gz",
  "payload_digest": "sha256:...",
  "artifact_type": "application/vnd.styrene.omegon.profile.v1+tar",
  "dependencies": [
    { "kind": "persona", "id": "systems-engineer", "version": ">=1.0.0", "required": true },
    { "kind": "tone", "id": "concise", "version": ">=1.0.0", "required": true },
    { "kind": "skill", "id": "security", "version": ">=1.0.0", "required": true, "activate": "always" }
  ]
}
```

## Lock Files

Profiles may be floating or locked.

Floating profile:

- `profile.toml` declares version ranges.
- Omegon resolves the newest matching dependency from the configured Armory index.
- Lower maintenance, but behavior can drift.

Locked profile:

- `LOCK.json` records exact refs and digests.
- Omegon installs dependencies by digest.
- Higher reproducibility and better auditability.

Example `LOCK.json`:

```json
{
  "resolvedAt": "2026-05-16T13:30:00Z",
  "dependencies": [
    {
      "kind": "skill",
      "id": "security",
      "version": "1.0.0",
      "ref": "ghcr.io/styrene-lab/omegon-armory/skills/security:1.0.0",
      "digest": "sha256:..."
    }
  ]
}
```

Official profiles should publish locked releases. Local and third-party profiles may start floating.

## Installer Flow

`omegon profile install alpharius` should:

1. Pull the configured Armory index, normally `index:latest`.
2. Find `kind=profile`, `id=alpharius`.
3. Verify the profile artifact signature according to trust policy.
4. Pull and unpack the profile payload.
5. Parse `profile.toml`.
6. If `LOCK.json` exists, install exact refs by digest.
7. Otherwise resolve dependency ranges through the index.
8. For `skill`, `persona`, `tone`, and `agent`, pull OCI artifacts and verify them.
9. For `extension`, use the extension registry install path.
10. Write installed profile metadata locally.
11. Activate the profile only when requested with `omegon profile use <id>` or an explicit install flag.

OCI registries do not natively perform package-manager dependency resolution. The dependency graph lives in `profile.toml`, `LOCK.json`, the Armory index, and the Omegon resolver.

## Implementation Tasks

1. Add `profile` to Armory site/API types.
2. Add `profiles/` scanning to the OCI builder.
3. Add `application/vnd.styrene.omegon.profile.v1+tar` to artifact media types.
4. Add profile parsing and dependency emission to site data generation.
5. Add validation for profile manifests, dependency resolution, version ranges, and cycles.
6. Add `/profiles/` and package detail pages to the site.
7. Add runtime support for `omegon profile install`, `omegon profile use`, and profile trust policy.
