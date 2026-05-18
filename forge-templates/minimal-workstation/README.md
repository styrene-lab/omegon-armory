# Minimal Workstation Forge Template

A safe public Nex forge-template example for building a non-destructive workstation image plan.

This package demonstrates Armory distribution metadata for Nex-owned forge payloads. The canonical payload is `forge.pkl`; `forge.toml` is Armory packaging metadata.

Safety posture:

- no fixed raw disk target;
- no cluster or join tokens;
- no private hostnames or static private IPs;
- no reusable first-server `clusterInit` overlay.

Nex validates and evaluates forge semantics. Armory validates package shape, provenance, and public-safety constraints.
