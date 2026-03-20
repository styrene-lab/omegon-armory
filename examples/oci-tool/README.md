# OCI Tool Example: CSV Analyzer

A minimal example of a containerized Omegon tool plugin.

## What This Shows

- `plugin.toml` — declares an OCI-backed tool with `runner = "oci"`
- `Containerfile` — builds the tool image with frozen dependencies
- `tool.py` — the tool implementation using the JSON stdin/stdout contract

## The Contract

Every OCI tool follows the same contract:

1. **Input**: JSON on stdin — `{"path": "data.csv", "query": "describe"}`
2. **Output**: JSON on stdout — `{"result": "...", "error": null}`
3. **Exit code**: 0 = success, non-zero = error
4. **Working directory**: `/work` (operator's cwd is mounted here if `mount_cwd = true`)

## Build & Test

```bash
# Build the image
podman build -t omegon-tool-csv-analyzer -f Containerfile .

# Test with a CSV file
echo '{"path": "test.csv", "query": "describe"}' | \
  podman run --rm -i -v "$PWD:/work:ro" omegon-tool-csv-analyzer

# Test column listing
echo '{"path": "test.csv", "query": "columns"}' | \
  podman run --rm -i -v "$PWD:/work:ro" omegon-tool-csv-analyzer

# Test error handling (missing file)
echo '{"path": "nope.csv"}' | \
  podman run --rm -i -v "$PWD:/work:ro" omegon-tool-csv-analyzer
```

## How Omegon Runs It

When the agent calls the `analyze_csv` tool, the harness:

1. Checks if the image exists locally (pulls if needed)
2. Runs: `podman run --rm -i --network=none -v "$CWD:/work:ro" <image>`
3. Pipes the tool arguments as JSON to stdin
4. Reads JSON result from stdout
5. Kills after `timeout_secs` if the tool hangs

The operator's files are mounted read-only (`:ro`) by default. Tools that need to write (e.g., exporters) can use `:rw` — declared in the plugin.toml.

## Security Model

| Setting | Default | Effect |
|---|---|---|
| `mount_cwd` | `false` | Container can't see host files unless enabled |
| `network` | `false` | Container has no network access unless enabled |
| `timeout_secs` | `30` | Hard kill after timeout |

This is **defense in depth**: even if the tool code has a bug, it can't exfiltrate data (no network) or tamper with files outside the mounted directory.

## Adapting This Example

To create your own OCI tool:

1. Copy this directory
2. Edit `plugin.toml` — change name, description, parameters
3. Edit `Containerfile` — install your dependencies
4. Edit `tool.py` (or use any language) — implement your tool logic
5. Build: `podman build -t my-tool -f Containerfile .`
6. Test: `echo '{"arg": "value"}' | podman run --rm -i my-tool`
7. Publish: `podman push my-tool ghcr.io/your-org/my-tool:latest`
