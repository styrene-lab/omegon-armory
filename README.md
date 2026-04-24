# Omegon Armory

The official extension registry for [Omegon](https://github.com/styrene-lab/omegon) — the terminal-native AI agent harness.

## Install extensions by name

```bash
omegon extension install scribe
omegon extension install scry
omegon extension install vox
```

## Available extensions

| Extension | Category | Description |
|-----------|----------|-------------|
| [scribe](https://github.com/styrene-lab/scribe) | forge | Forge sync — GitHub/Forgejo issue tracking, OAuth2, credential helper |
| [scry](https://github.com/styrene-lab/scry) | media | Local image generation — FLUX, Stable Diffusion, LoRA, ComfyUI |
| [vox](https://github.com/styrene-lab/vox) | comms | Communication bridge — Discord, Slack, Signal, email |
| [aether](https://github.com/styrene-lab/aether) | mesh | Agent-to-agent mesh communication — swarm coordination, RBAC |
| [codex](https://github.com/styrene-lab/codex) | knowledge | Vault documents, tasks, knowledge graph, design nodes |

## Search from the CLI

```bash
omegon extension search           # list all
omegon extension search forge     # filter by name, category, or description
```

## Submit an extension

1. Build your extension: `omegon extension init my-ext`
2. Test locally: `omegon extension install ./my-ext`
3. Push to a public git repo
4. Open a PR adding your entry to `registry.toml`

See [CLAUDE.md](CLAUDE.md) for the registry format and detailed guidelines.

## License

MIT
