# Public Launch Checklist

This checklist tracks the work required to move Omegon Armory from release candidate to public launch.

## Launch Target

Publish the first public Armory release with:

- static catalog at `https://armory.styrene.io`
- machine-readable API at `https://armory.styrene.io/api/index.json`
- OCI artifacts at `ghcr.io/styrene-lab/omegon-armory/*`
- enabled extension installs for entries that pass live install smoke tests
- clear documentation for staged candidates, self-hosting, and profile roadmap

## Current Release Candidate Contents

Expected generated catalog:

```text
22 site/API entries
20 OCI artifacts
2 registry-install extensions
```

Expected kinds:

```text
skill:     10
agent:      6
extension:  2
persona:    2
tone:       2
```

Enabled extension gate:

```text
flynt
shuttle
```

Staged but disabled candidates:

```text
scry
vox
omegon-browser
```

## Publication Gates

### 1. Local Static Validation

Run:

```sh
node --test tests/armory-entry-suite.mjs
cd site && npm run build
```

Pass criteria:

- all non-network tests pass
- site builds successfully
- generated API contains expected entry counts

### 2. Local Omegon Install Validation

Run with the release candidate Omegon binary:

```sh
OMEGON_BIN=/path/to/omegon node --test tests/armory-entry-suite.mjs
```

Pass criteria:

- text plugin installs pass in a sandboxed `OMEGON_HOME`
- catalog agent install checks pass where supported
- no local runtime state is committed

### 3. Live Network Install Validation

Run:

```sh
OMEGON_BIN=/path/to/omegon ARMORY_TEST_NETWORK=1 node --test tests/armory-entry-suite.mjs
```

Pass criteria:

- every enabled extension installs by name
- `flynt` passes
- `shuttle` passes or is disabled before publication
- disabled candidates do not block launch

Decision rule:

```text
If shuttle live install fails, set shuttle.enabled = false and publish without it.
```

### 4. GitHub Actions Validation

Run or wait for:

```text
Validate Registry
Deploy Armory Site
Publish OCI Armory dry_run=true
```

Pass criteria:

- TOML validation passes
- OCI dry-run emits valid ORAS/cosign commands
- site build passes in Actions
- disabled/private staged repos do not fail reachability checks

### 5. OCI Publication

Run manual workflow:

```text
GitHub Actions -> Publish OCI Armory
registry=ghcr.io/styrene-lab/omegon-armory
dry_run=false
```

Pass criteria:

- GHCR login succeeds
- every artifact pushes
- `index:latest` pushes
- cosign signing succeeds
- published index manifest fetch succeeds
- representative artifact manifest fetches succeed

Manual smoke commands:

```sh
oras manifest fetch ghcr.io/styrene-lab/omegon-armory/index:latest
rm -rf /tmp/armory-index-smoke
mkdir -p /tmp/armory-index-smoke
oras pull ghcr.io/styrene-lab/omegon-armory/index:latest --output /tmp/armory-index-smoke
test -f /tmp/armory-index-smoke/index.json
cosign verify ghcr.io/styrene-lab/omegon-armory/index:latest
```

### 6. Site Publication

Confirm GitHub secrets exist:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Push or manually dispatch `.github/workflows/site.yml`.

Pass criteria:

```sh
curl -fsSL https://armory.styrene.io/ >/tmp/armory-home.html
curl -fsSL https://armory.styrene.io/api/index.json | jq '.items | length'
```

Expected API count:

```text
22
```

### 7. Production Install Smoke

After site and OCI publish:

```sh
omegon extension install flynt
omegon extension install shuttle
```

If Shuttle was disabled, verify it is not presented as an enabled install target:

```sh
omegon extension search shuttle
```

Also verify OCI-backed packages are discoverable through the published index once Omegon has native Armory/OCI install support.

## Launch Decision

Launch is approved only when:

- local validation is green
- Actions validation is green
- OCI workflow published and smoke-tested
- Cloudflare Pages deployment is live
- enabled extension install smoke tests pass
- `shuttle` is either proven installable or disabled

## Post-Launch Checks

Immediately after public launch:

1. Fetch `https://armory.styrene.io/api/index.json` and archive the response for release evidence.
2. Pull `ghcr.io/styrene-lab/omegon-armory/index:latest` and verify it contains the same registry namespace.
3. Install each enabled extension from a clean `OMEGON_HOME`.
4. Confirm docs pages render:
   - `/docs/armory-operations/`
   - `/docs/oci-registry-stack/`
5. Confirm no disabled candidates appear as installable public extension cards.
6. Open follow-up issues for any launch deferrals.

## Known Deferrals

Not required for first public launch:

- profile artifacts in the live builder/site
- turnkey self-host compose stack
- OCI-backed extension binaries
- multi-index federation
- native Omegon OCI package installer

These are documented roadmap items, not launch blockers.
