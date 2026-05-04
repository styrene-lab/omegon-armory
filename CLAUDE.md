# CLAUDE.md

Development guidance for the Omegon Armory — the official extension registry.

## What This Is

**omegon-armory** is the extension registry for Omegon. It maps extension names to git repositories so operators can install extensions by name:

```bash
omegon extension install scribe    # instead of the full git URL
```

It also serves as the catalog of available extensions with metadata, tool listings, and integration documentation.

## Structure

```
omegon-armory/
├── registry.toml              # Extension name → repo mapping (the index)
├── catalog-registry.toml      # Agent catalog index (id → files + metadata)
├── extensions/
│   ├── scribe.toml            # Detailed metadata per extension
│   ├── scry.toml
│   ├── vox.toml
│   ├── aether.toml
│   └── codex.toml
├── catalog/
│   ├── styrene.bd-agent/      # Agent bundle files
│   │   ├── agent.toml
│   │   ├── agent.pkl
│   │   ├── PERSONA.md
│   │   └── mind/facts.jsonl
│   └── ...                    # One directory per bundled agent
└── docs/
    └── plugin-spec.md         # Plugin manifest specification
```

## Registry Format

`registry.toml` is the minimal index that omegon's CLI fetches for name resolution:

```toml
[extension-name]
repo = "https://github.com/org/repo"
description = "Short description"
category = "category"
maintainer = "Name"
license = "SPDX"
min_sdk = "0.15"
# Optional: if manifest.toml is not at the repo root
manifest_path = "path/to/manifest.toml"
```

Per-extension detail files (`extensions/*.toml`) provide richer metadata: tool listings, secret requirements, integration notes, widget descriptions. These are not required for install — only `registry.toml` is.

## How Resolution Works

When a user runs `omegon extension install scribe`:

1. Omegon fetches `registry.toml` from the configured armory (default: this repo)
2. Looks up `[scribe]` → gets `repo` URL
3. Clones the repo to `~/.omegon/extensions/scribe/`
4. Finds `manifest.toml` (at root, or at `manifest_path` if specified)
5. Runs `cargo build --release` for native extensions
6. Extension is ready — restart omegon to load it

## Adding an Extension

### First-party (Styrene Lab)

Edit `registry.toml` and add an `extensions/<name>.toml` detail file.

### Third-party

1. Create your extension: `omegon extension init my-ext`
2. Develop and test locally: `omegon extension install ./my-ext`
3. Push to a public git repo
4. Submit a PR to this repo adding your entry to `registry.toml`

## Private Armories (planned)

Private armory support is on the roadmap — operators will be able to configure a custom armory URL for internal extensions. For now, internal extensions can be installed by git URL directly:

```bash
omegon extension install https://git.internal/my-org/my-extension
```

## Naming

Extension names are globally unique in the flat namespace. If two authors want to publish extensions with the same name, the second must choose a different name (e.g., `acme-scribe` vs `scribe`).

This is intentional for simplicity — same model as homebrew formulae. If namespace collisions become a real problem, we can add org-scoped names (`styrene-lab/scribe`) later without breaking the flat names (which become aliases).

## License

MIT. Earlier plugin content was contributed under Apache-2.0; relicensed to MIT for consistency across the Styrene ecosystem. Both are permissive open-source.

## Agent Catalog

`catalog-registry.toml` is the index for `omegon catalog install`. It lists all available bundled agents, their metadata, and the files that comprise each bundle.

When a user runs `omegon catalog install`:

1. Omegon fetches `catalog-registry.toml` from the configured armory
2. For each agent, downloads the listed files from `catalog/<agent-id>/`
3. Writes them to `~/.omegon/catalog/<agent-id>/`
4. Falls back to the binary-bundled copies if the network is unavailable (airgap support)

### Adding an Agent to the Catalog

1. Create `catalog/<agent-id>/` with at minimum `agent.toml` and `PERSONA.md`
2. Add a **quoted** entry to `catalog-registry.toml` (see gotcha below)
3. Update `catalog.rs` in omegon to include the new agent in `BUNDLED` for airgap support

See [`docs/catalog-spec.md`](docs/catalog-spec.md) for the full spec.

### TOML Key Quoting — Gotcha

Agent IDs contain dots. `[styrene.bd-agent]` in TOML means nested tables, not a flat key — omegon's registry parser will error. **Always quote dotted IDs:**

```toml
# Correct
["styrene.bd-agent"]
files = [...]

# Wrong — TOML parses as nested tables
[styrene.bd-agent]
files = [...]
```

### Agent Bundle Files

| File | Required | Description |
|------|----------|-------------|
| `agent.toml` | Yes | Agent manifest (TOML format) |
| `agent.pkl` | No | Agent manifest (Pkl format, enables `amends` inheritance) |
| `PERSONA.md` | Yes | Persona directive |
| `mind/facts.jsonl` | No | Seed knowledge facts (JSONL) |

## Registered Extensions

| Name | Category | Description |
|------|----------|-------------|
| **scribe** | forge | Forge sync — GitHub/Forgejo issues, OAuth2, credential helper |
| **scry** | media | Local image generation — FLUX, SD, LoRA, ComfyUI |
| **vox** | comms | Communication bridge — Discord, Slack, Signal, email |
| **aether** | mesh | Agent-to-agent mesh comms — swarm coordination, RBAC |
| **codex** | knowledge | Vault documents, tasks, knowledge graph, design nodes |
