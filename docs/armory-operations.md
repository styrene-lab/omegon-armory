# Armory Operations

This document is the operating runbook for publishing and maintaining the Omegon Armory public registry and catalog site.

## Production Surfaces

| Surface | Location | Owner | Purpose |
|---|---|---|---|
| Human catalog | `https://armory.styrene.io` | Cloudflare Pages | Browse packages, install commands, provenance, self-host docs |
| Static catalog API | `https://armory.styrene.io/api/index.json` | Cloudflare Pages | Machine-readable package metadata generated from manifests |
| Source of truth | `https://github.com/styrene-lab/omegon-armory` | GitHub | Review, pull requests, manifests, tests |
| OCI distribution | `ghcr.io/styrene-lab/omegon-armory/*` | GHCR | Signed OCI artifacts for skills, personas, tones, and catalog agents |
| Self-host mirror | zot + Cloudflare R2 | Operator | Optional registry mirror preserving the same OCI path layout |

## Source of Truth

Humans edit repository manifests and package source files:

- `registry.toml` — extension name registry
- `extensions/*.toml` — extension detail metadata
- `catalog-registry.toml` — catalog agent index
- `catalog/*` — catalog agent bundles
- `skills/*/plugin.toml` and `SKILL.md`
- `personas/*/plugin.toml` and `PERSONA.md`
- `tones/*/plugin.toml` and `TONE.md`

Generated outputs are build products:

- `dist/oci/**`
- `site/.cache/oci/**`
- `site/src/data/armory.json`
- `site/public/api/index.json`
- `site/dist/**`

The site and API must remain derived from manifests. Do not hand-edit generated catalog JSON as a source of truth.

## Distribution Model

Armory has two distribution classes:

1. **OCI artifacts** — skills, personas, tones, and catalog agents. These are packaged by `scripts/build-oci-artifacts.py`, published with ORAS, and signed with cosign.
2. **Registry installs** — extensions. These resolve by name through `registry.toml` and install from upstream repository/release metadata.

The public site exposes this distinction through each item's `distribution` field and badges.

## Local Validation

Run before merging registry, package, site, or workflow changes:

```sh
node --test tests/armory-entry-suite.mjs
cd site && npm run build
```

For a direct OCI artifact build check:

```sh
python3 scripts/build-oci-artifacts.py --out dist/oci-validate
python3 scripts/generate-site-data.py \
  --oci dist/oci-validate \
  --out /tmp/armory-site-check.json \
  --api /tmp/armory-api-check.json
```

## Site Deployment

Workflow: `.github/workflows/site.yml`

The site workflow runs on pull requests, pushes to `main`, and manual dispatch. It builds the Astro site from current manifests and publishes `site/dist` to Cloudflare Pages on `main` pushes.

Required GitHub secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Production project:

```text
Cloudflare Pages project: omegon-armory
Canonical URL: https://armory.styrene.io
```

## OCI Publishing

Workflow: `.github/workflows/publish-oci.yml`

The OCI workflow runs on artifact-producing changes and manual dispatch. It:

1. Builds payload tarballs and `dist/oci/index.json`.
2. Uploads the generated build output as a workflow artifact.
3. Logs in to GHCR when publishing to `ghcr.io/*`.
4. Pushes each artifact and the `index:latest` artifact with ORAS.
5. Signs published refs with cosign.
6. Fetches the published index manifest and pulls the index artifact.
7. Fetches one representative published manifest per package kind.

Manual dry run:

```text
GitHub Actions → Publish OCI Armory → Run workflow → dry_run=true
```

Manual publish to the default namespace:

```text
GitHub Actions → Publish OCI Armory → Run workflow → registry=ghcr.io/styrene-lab/omegon-armory, dry_run=false
```

## Adding an Extension

1. Add `[extension-name]` to `registry.toml` with `enabled = false`.
2. Add `extensions/<extension-name>.toml` with tool and integration metadata.
3. Prove the name-based install path locally.
4. Add `manifest_path` and `asset_prefix` before enabling.
5. Flip `enabled = true`.
6. Run validation and merge.

Enabled extensions must include:

- `asset_prefix`
- `manifest_path`

## Adding an OCI-backed Package

For skills, personas, tones, or catalog agents:

1. Add the package source directory and manifest.
2. Add or update the relevant registry file if needed.
3. Run local validation.
4. Merge to `main`.
5. Confirm the OCI publish workflow completed and smoke checks passed.
6. Confirm the site deploy shows the new package and `/api/index.json` includes it.

## Rollback

Site rollback:

1. Revert the source commit or use Cloudflare Pages deployment rollback.
2. Confirm `https://armory.styrene.io/api/index.json` reflects the intended catalog state.

OCI rollback:

1. Do not overwrite existing semver tags.
2. Publish a corrected patch version.
3. If `index:latest` points at a bad entry, revert/fix the manifest source and rerun the publish workflow to republish the index.

## Self-host Mirror

Operators can mirror the GHCR layout into a zot registry backed by Cloudflare R2. The deployment manifests live in `deploy/zot-r2/` and the architecture details live in `docs/oci-registry-stack.md`.

Mirrors should preserve path layout, for example:

```text
registry.example.com/omegon-armory/index:latest
registry.example.com/omegon-armory/skills/security:1.0.0
registry.example.com/omegon-armory/catalog/styrene.coding-agent:1.0.0
```
