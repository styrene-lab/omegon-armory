# zot + Cloudflare R2 Deployment

This directory contains a minimal Kubernetes deployment for running a self-hosted Omegon Armory OCI registry.

It runs [zot](https://zotregistry.dev/) as the OCI registry server and stores blobs in Cloudflare R2 through R2's S3-compatible API.

## Components

- `namespace.yaml` — optional namespace for the registry.
- `secret.example.yaml` — template for R2 credentials.
- `configmap.yaml` — zot `config.json` using S3-compatible storage.
- `deployment.yaml` — single-replica zot deployment.
- `service.yaml` — ClusterIP service.
- `ingress.example.yaml` — hostname/TLS template.
- `kustomization.yaml` — base kustomize entrypoint.

## Prerequisites

- Kubernetes cluster.
- Ingress controller or gateway for HTTPS.
- Cloudflare R2 bucket.
- R2 access key with read/write access to that bucket.
- A DNS name such as `registry.example.com`.

## Configure

Copy the secret template and replace placeholders:

```sh
cp secret.example.yaml secret.yaml
```

Required values:

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```

Edit `configmap.yaml`:

```json
"regionendpoint": "https://<account-id>.r2.cloudflarestorage.com",
"bucket": "omegon-armory-registry"
```

zot reads S3 credentials from the standard AWS environment variables. R2 is S3-compatible, so the deployment uses `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` even though the backing store is Cloudflare R2.

Edit `ingress.example.yaml` for your hostname and TLS issuer, then either apply it directly or copy it to `ingress.yaml` and add it to `kustomization.yaml`.

## Deploy

```sh
kubectl apply -k deploy/zot-r2
```

Check health:

```sh
kubectl -n omegon-armory rollout status deploy/omegon-armory-zot
kubectl -n omegon-armory port-forward svc/omegon-armory-zot 5000:5000
curl -s http://localhost:5000/v2/
```

The `/v2/` endpoint should return `{}` or an empty successful response.

## Publish Test Artifact

After TLS and auth are configured:

```sh
oras login registry.example.com
oras push registry.example.com/omegon-armory/skills/security:1.0.0 \
  --artifact-type application/vnd.styrene.omegon.skill.v1+tar \
  --annotation io.styrene.omegon.kind=skill \
  --annotation io.styrene.omegon.id=security \
  security.tar.gz
```

## Security Notes

- Allow anonymous pulls only if this registry is intended to be public.
- Require authentication for pushes.
- Prefer ingress-managed auth or a token service before exposing write access.
- Store R2 credentials in a real secret manager for production deployments.
- Restrict the R2 access key to the Armory bucket.

## Production Hardening

- Add registry auth before public exposure.
- Add resource requests/limits appropriate for expected pull volume.
- Add NetworkPolicy for egress only to R2 and ingress only from the gateway.
- Add metrics scraping once zot metrics are enabled.
- Define a tag retention and garbage collection policy.
- Back up zot config and protect the R2 bucket from accidental deletion.
