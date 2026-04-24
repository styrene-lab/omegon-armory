# Omegon Plugin Specification

This document describes the `plugin.toml` manifest format for omegon plugins (personas, tones, skills, and tool configs). For native extensions (binaries with JSON-RPC), see the [Extension SDK](https://github.com/styrene-lab/omegon/blob/main/EXTENSION_SDK.md).

## Plugin vs Extension

- **Plugin** (`plugin.toml`): Declarative TOML manifest. Provides personas, tones, skills, context injection, and HTTP-backed tools. No binary required.
- **Extension** (`manifest.toml`): Native binary or OCI container. Communicates via JSON-RPC over stdio. Provides tools, widgets, and persistent state.

Both are distributed through the armory, but they use different manifest formats and different runtime mechanisms.

## Plugin Manifest Format

```toml
[plugin]
name = "my-plugin"
version = "0.1.0"
description = "A helpful plugin"

# ── Activation ──────────────────────────────────────────────────
[activation]
marker_files = [".my-plugin"]      # Activate when this file exists in project tree
env_vars = ["MY_PLUGIN_URL"]       # Activate when this env var is set

# ── Context injection ───────────────────────────────────────────
[context]
local_file = ".my-plugin"          # Read this file and inject into system prompt
ttl_turns = 30                     # Re-inject every N turns
priority = 35                      # Priority in system prompt ordering

# ── Tools ───────────────────────────────────────────────────────
[[tools]]
name = "my_tool"
description = "Does something useful"
endpoint = "{MY_PLUGIN_URL}/api/do-thing"
method = "POST"
timeout_secs = 10
parameters = { type = "object", required = ["input"], properties = { input = { type = "string" } } }

# ── Event forwarding ───────────────────────────────────────────
[events]
turn_end = "{MY_PLUGIN_URL}/api/events/turn"
session_start = "{MY_PLUGIN_URL}/api/events/start"
```

## Registry Entry Format

To list a plugin or extension in the armory, add an entry to `registry.toml`:

```toml
[my-extension]
repo = "https://github.com/org/repo"
description = "Short description for search and listing"
category = "category"               # forge, media, comms, mesh, knowledge, etc.
maintainer = "Name or organization"
license = "MIT"                     # SPDX identifier
min_sdk = "0.15"                    # Minimum omegon SDK version
# manifest_path = "path/to/manifest.toml"  # Only if not at repo root
```

## Categories

| Category | Description |
|----------|-------------|
| forge | Git forge integration (issues, PRs, CI) |
| media | Image, audio, video generation and processing |
| comms | Communication channels (chat, email, messaging) |
| mesh | Styrene mesh networking and agent-to-agent |
| knowledge | Documents, notes, knowledge management |
| infra | Infrastructure, deployment, monitoring |
| dev | Development tools, linting, testing |

## Submitting

1. Fork this repo
2. Add your entry to `registry.toml`
3. Add a detail file to `extensions/your-name.toml`
4. Open a PR — CI validates TOML syntax, required fields, and repo reachability
