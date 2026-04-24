# Omegon Armory

Official plugin and extension repository for [Omegon](https://github.com/styrene-lab/omegon) — the terminal-native AI agent harness.

## Extensions

Install extensions by name:

```bash
omegon extension install scribe
omegon extension install scry
omegon extension install vox
```

| Extension | Category | Description |
|-----------|----------|-------------|
| [scribe](https://github.com/styrene-lab/scribe) | forge | Forge sync — GitHub/Forgejo issue tracking, OAuth2, credential helper |
| [scry](https://github.com/styrene-lab/scry) | media | Local image generation — FLUX, Stable Diffusion, LoRA, ComfyUI |
| [vox](https://github.com/styrene-lab/vox) | comms | Communication bridge — Discord, Slack, Signal, email |
| [aether](https://github.com/styrene-lab/aether) | mesh | Agent-to-agent mesh communication — swarm coordination, RBAC |
| [codex](https://github.com/styrene-lab/codex) | knowledge | Vault documents, tasks, knowledge graph, design nodes |

Search from the CLI:

```bash
omegon extension search           # list all
omegon extension search forge     # filter by name, category, or description
```

## Plugins

Plugins provide personas, tones, and skills — declarative TOML manifests with no binary required.

| Plugin | Type | Description |
|---|---|---|
| `personas/systems-engineer` | persona | Systems engineering harness — the default Omegon identity |
| `personas/tutor` | persona | Socratic tutor — guides through questioning, never lectures |
| `tones/concise` | tone | Terse, direct output — minimal filler |
| `tones/alan-watts` | tone | Philosophical, paradox-friendly, gently irreverent |
| `skills/typescript` | skill | TypeScript development conventions |
| `skills/rust` | skill | Rust development guidance |
| `skills/security` | skill | Security checklist for code review |

Install plugins:

```bash
omegon plugin install https://github.com/styrene-lab/omegon-armory/personas/tutor
omegon plugin install ./omegon-armory/tones/alan-watts
```

## Submit

### Extensions
1. Build: `omegon extension init my-ext`
2. Test: `omegon extension install ./my-ext`
3. Push to a public git repo
4. PR adding your entry to `registry.toml`

### Plugins
1. Create a directory with `plugin.toml` following the [plugin spec](docs/plugin-spec.md)
2. PR adding your plugin directory

## License

MIT
