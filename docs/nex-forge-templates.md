# Nex Forge Templates in Armory

Armory can distribute Nex forge templates as OCI artifacts while keeping Nex as the owner of forge semantics.

## Boundary

- **Armory owns:** package metadata, OCI payload construction, catalog/API rendering, provenance, signature/verification fields, and public-payload safety linting.
- **Nex owns:** Pkl schema, evaluation, image-build behavior, destructive operation controls, and runtime validation.

Armory must not become a forge evaluator. It only indexes and packages canonical Nex payloads.

## Package Layout

```text
forge-templates/<slug>/
├── forge.toml
├── forge.pkl
└── README.md
```

`forge.toml` is Armory metadata. `forge.pkl` is the canonical Nex-owned payload.

## OCI Reference

```text
ghcr.io/styrene-lab/omegon-armory/forge-templates/<slug>:<version>
```

Media type:

```text
application/vnd.styrene.nex.forge-template.v1+tar
```

## Public Safety Rules

Public forge templates must not include:

- fixed raw disk targets;
- private hostnames or IPs;
- join tokens, cluster tokens, or secrets;
- reusable first-server cluster-init overlays;
- site-local deployment topology.

Public examples should be non-destructive blueprints for operator review. Private or site-specific forge templates belong in a private/federated Armory.
