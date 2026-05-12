# Omegon Armory Site

Static public catalog for Armory packages.

## Local Development

```sh
npm install
npm run dev
```

`npm run generate` builds OCI package metadata into `site/.cache/oci`, then writes:

- `src/data/armory.json` for Astro pages
- `public/api/index.json` for consumers

## Build

```sh
npm run build
```

The static site is emitted to `site/dist`.

## Deployment

The `Deploy Armory Site` GitHub workflow builds the site and publishes `site/dist` to Cloudflare Pages.

Required repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The default project name is `omegon-armory`.
