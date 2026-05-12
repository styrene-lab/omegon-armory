# Omegon Armory

Official plugin and extension repository for [Omegon](https://github.com/styrene-lab/omegon) — the terminal-native AI agent harness.

Armory is also the source tree for OCI-packaged ecosystem artifacts. The first distribution target is GHCR; the self-hosted target is a zot registry backed by Cloudflare R2. See [docs/oci-registry-stack.md](docs/oci-registry-stack.md) and [deploy/zot-r2](deploy/zot-r2/).

Build the OCI payloads locally:

```bash
python3 scripts/build-oci-artifacts.py
```

Publish after logging in with ORAS:

```bash
python3 scripts/publish-oci-artifacts.py --sign
```

Run the public catalog site locally:

```bash
cd site
npm install
npm run dev
```

## Extensions

Install enabled extensions by name:

```bash
omegon extension install flynt
```

| Extension | Category | Description |
|-----------|----------|-------------|
| [flynt](https://github.com/styrene-lab/flynt) | knowledge | Vault documents, tasks, knowledge graph, design nodes |

Candidate extensions remain in `registry.toml` with `enabled = false` until their name-based install path and release artifacts have been tested.

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
| `skills/security` | skill | Security checklist for code review |

Install plugins:

```bash
git clone https://github.com/styrene-lab/omegon-armory
omegon plugin install ./omegon-armory/personas/tutor
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
