# Self-Hosting Omegon Armory

Armory is designed to be self-hosted as two separable surfaces:

```text
1. Static catalog site/API
2. OCI artifact registry
```

Operators can run either surface independently, but a full mirror runs both.

## Modes

### Static-Only Catalog

Use this when you want a browsable internal catalog and generated API, but artifacts can still point to GHCR or another upstream registry.

Build:

```sh
cd site
npm install
npm run build
```

Serve `site/dist/` with Caddy, Nginx, Cloudflare Pages, GitHub Pages, Netlify, S3/R2 static hosting, or any static web server.

This mode provides:

- human package catalog
- `/api/index.json`
- install commands
- provenance and source links

It does not mirror OCI blobs unless the site data was generated against a self-hosted registry and artifacts were published there.

### Full Mirror

Use this when you want your own catalog plus your own OCI artifact storage.

```text
Static site/API          -> https://armory.example.com
OCI registry            -> registry.example.com/omegon-armory/*
Armory index artifact   -> registry.example.com/omegon-armory/index:latest
```

Build artifacts for the destination namespace:

```sh
python3 scripts/build-oci-artifacts.py \
  --registry registry.example.com/omegon-armory \
  --out dist/oci
```

Generate site/API data from that artifact index:

```sh
python3 scripts/generate-site-data.py \
  --oci dist/oci \
  --out site/src/data/armory.json \
  --api site/public/api/index.json
```

Build the static site:

```sh
cd site && npm run build
```

Publish artifacts:

```sh
oras login registry.example.com
python3 scripts/publish-oci-artifacts.py --out dist/oci --sign
```

### Private/Federated Armory

Organizations often need:

```text
official Styrene packages
+ private profiles
+ private skills/personas/tones
+ private catalog agents
+ private extensions
```

The preferred first implementation is a single merged index published at the private registry:

```text
registry.example.com/omegon-armory/index:latest
```

A private profile can then reference both official and private dependencies through the merged index:

```text
profile/acme-secure-dev
  -> official skill/security
  -> official skill/typescript
  -> private skill/acme-compliance
  -> private persona/acme-engineer
  -> private extension/acme-jira
```

Multi-index federation can come later. Start with one merged index because it keeps profile dependency resolution deterministic and easy to explain.

## Local Full Mirror with Compose

A local self-host stack should provide:

```text
http://localhost:8080              # static Armory catalog
http://localhost:8080/api/index.json
http://localhost:5000/v2/          # OCI registry API
localhost:5000/omegon-armory/*     # OCI artifacts
```

Recommended files:

```text
deploy/selfhost/
├── compose.yml
├── zot-config.json
├── Caddyfile
├── README.md
└── .env.example
```

Minimal compose shape:

```yaml
services:
  registry:
    image: ghcr.io/project-zot/zot-linux-amd64:v2.1.4
    command: ["serve", "/etc/zot/config.json"]
    ports:
      - "5000:5000"
    volumes:
      - ./zot-config.json:/etc/zot/config.json:ro
      - registry-data:/var/lib/registry

  site:
    image: caddy:2
    ports:
      - "8080:80"
    volumes:
      - ../../site/dist:/usr/share/caddy:ro
      - ./Caddyfile:/etc/caddy/Caddyfile:ro

volumes:
  registry-data:
```

Minimal zot config:

```json
{
  "distSpecVersion": "1.1.0",
  "storage": {
    "rootDirectory": "/var/lib/registry"
  },
  "http": {
    "address": "0.0.0.0",
    "port": "5000"
  },
  "log": {
    "level": "info"
  }
}
```

Minimal Caddyfile:

```caddyfile
:80 {
  root * /usr/share/caddy
  file_server
}
```

## Production zot + Cloudflare R2

The Kubernetes deployment in `deploy/zot-r2/` runs zot with Cloudflare R2 as S3-compatible object storage.

Architecture:

```text
OCI client
  -> registry.example.com
      -> zot Deployment
          -> Cloudflare R2 bucket
```

Use this when you want:

- cheap blob storage
- public anonymous pulls
- authenticated pushes
- Cloudflare edge controls/rate limiting
- Kubernetes deployment ownership

Deploy:

```sh
cp deploy/zot-r2/secret.example.yaml deploy/zot-r2/secret.yaml
# fill AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
# edit deploy/zot-r2/configmap.yaml for R2 endpoint and bucket
# optionally configure ingress
kubectl apply -k deploy/zot-r2
```

Verify:

```sh
kubectl -n omegon-armory rollout status deploy/omegon-armory-zot
kubectl -n omegon-armory port-forward svc/omegon-armory-zot 5000:5000
curl -s http://localhost:5000/v2/
```

## Registry Path Layout

Mirrors should preserve upstream path layout:

```text
registry.example.com/omegon-armory/index:latest
registry.example.com/omegon-armory/skills/security:1.0.0
registry.example.com/omegon-armory/personas/tutor:1.0.0
registry.example.com/omegon-armory/tones/concise:1.0.0
registry.example.com/omegon-armory/catalog/styrene.coding-agent:1.0.0
registry.example.com/omegon-armory/profiles/alpharius:1.0.0
```

Preserving paths lets the index be rewritten by namespace rather than by package semantics.

## Mirror Workflow

A future mirror command should:

1. Pull upstream `index:latest`.
2. Pull every artifact listed in the index.
3. Push artifacts to the destination namespace.
4. Rewrite `ref` fields in the destination index.
5. Push destination `index:latest`.
6. Copy or regenerate signatures and attestations according to local trust policy.

Expected command shape:

```sh
python3 scripts/mirror-oci-artifacts.py \
  --from ghcr.io/styrene-lab/omegon-armory \
  --to registry.example.com/omegon-armory
```

## Trust Policy

Self-hosted Armory must make trust explicit.

Official public installs should verify Styrene signatures. Private installs should use the operator's trust policy. Local development may allow unsigned artifacts only with an explicit flag.

Example policy:

```toml
[trust]
allow_unsigned = false

[[trust.identities]]
issuer = "https://token.actions.githubusercontent.com"
subject = "repo:styrene-lab/omegon-armory:*"

[[trust.keys]]
name = "acme"
public_key = "cosign.pub"
```

Recommended behavior:

- public official registry: require official signature
- private registry: verify configured keyless identity or public key
- local development: require `--allow-unsigned` for unsigned artifacts

## Authentication

Local development can run without auth.

Production should use:

- anonymous pull + authenticated push for public mirrors
- authenticated pull/push for private mirrors
- ingress auth, token service, mTLS, or network restriction depending on environment

Typical commands:

```sh
oras login registry.example.com
cosign login registry.example.com
```

If Omegon adds native registry auth, it should mirror this UX:

```sh
omegon registry login registry.example.com
```

## Backup and Restore

Static site:

- rebuild from source
- redeploy `site/dist/`

OCI registry:

- back up registry blob storage volume or bucket
- back up signing keys if key-based signing is used
- preserve source repo and generated release metadata

For zot + R2, the R2 bucket is the artifact store and the repo can regenerate the index and site.

## Implementation Tasks

1. Add `deploy/selfhost/` compose stack for local zot + Caddy.
2. Add `scripts/selfhost-build.py` to wrap artifact build, site data generation, site build, and optional publish.
3. Add `scripts/mirror-oci-artifacts.py` to mirror upstream artifacts into a destination namespace.
4. Add environment/config support for `ARMORY_REGISTRY` and `ARMORY_SITE_URL`.
5. Add justfile or Makefile targets:
   - `selfhost-build`
   - `selfhost-up`
   - `selfhost-down`
   - `selfhost-publish`
   - `selfhost-mirror`
6. Add docs for static-only, full mirror, R2/zot, auth, trust, backup, and private overlays.
7. Extend the Armory index/site model to include profiles and profile dependencies.
