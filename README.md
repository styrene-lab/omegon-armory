# Omegon Armory

Official plugin repository for [Omegon](https://omegon.styrene.dev) — personas, tones, skills, and tool configs.

## What's Here

This repo contains reference plugins for Omegon's unified plugin system. Each plugin is a directory with a `plugin.toml` manifest.

| Plugin | Type | Description |
|---|---|---|
| `personas/systems-engineer` | persona | Systems engineering harness — the default Omegon identity |
| `personas/tutor` | persona | Socratic tutor — guides through questioning, never lectures |
| `tones/concise` | tone | Terse, direct output — minimal filler |
| `tones/alan-watts` | tone | Philosophical, paradox-friendly, gently irreverent |
| `skills/typescript` | skill | TypeScript development conventions |
| `skills/rust` | skill | Rust development guidance |
| `skills/security` | skill | Security checklist for code review |

## Installation

```bash
# Install a single plugin
omegon plugin install https://github.com/styrene-lab/omegon-armory/personas/tutor

# Install from a local clone
omegon plugin install ./omegon-armory/personas/tutor

# Install all plugins from the armory
omegon plugin install https://github.com/styrene-lab/omegon-armory
```

## Plugin Types

### Persona (`type = "persona"`)

A persona bundles expertise, a mind store, skills, and tool profile overrides.

```
personas/tutor/
├── plugin.toml       # manifest
├── PERSONA.md        # behavioral directive
├── mind/
│   └── facts.jsonl   # pre-populated domain knowledge
└── skills/           # optional bundled skills
```

### Tone (`type = "tone"`)

A tone changes the conversational voice without changing expertise.

```
tones/alan-watts/
├── plugin.toml       # manifest
├── TONE.md           # voice directive
└── exemplars/        # curated passages showing the voice
    ├── on-technology.md
    └── on-learning.md
```

### Skill (`type = "skill"`)

A skill provides domain knowledge loaded on demand.

```
skills/typescript/
├── plugin.toml       # manifest
└── SKILL.md          # guidance document
```

## Creating Your Own Plugin

See [Plugin Authoring Guide](docs/authoring.md) for the full `plugin.toml` specification.

## License

Apache-2.0
