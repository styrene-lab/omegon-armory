# Security Review Skill

Load this skill when reviewing code that handles user input, spawns processes, renders templates, or manages secrets.

## Checklist

### Input & Escaping
- [ ] All user input is validated and sanitized before use
- [ ] HTML output uses context-aware escaping (not just `htmlEscape()`)
- [ ] SQL queries use parameterized statements, never string concatenation
- [ ] Shell commands use array-form spawn, never `sh -c` with interpolation
- [ ] File paths are validated against a root directory (no `../` traversal)

### Process Safety
- [ ] Subprocess spawn uses explicit argv array, not shell interpolation
- [ ] Environment variables are explicitly filtered (not inherited wholesale)
- [ ] Timeouts are set on all external calls (HTTP, subprocess, DB)
- [ ] Resource limits (memory, file descriptors) are bounded

### Secrets Management
- [ ] Secrets never appear in logs, error messages, or stack traces
- [ ] API keys use environment variables or secure stores, not hardcoded strings
- [ ] Temporary credential files are cleaned up in `finally` blocks
- [ ] Auth tokens have expiry and refresh logic

### Dependencies
- [ ] No `eval()`, `Function()`, or equivalent dynamic code execution
- [ ] Dependencies are pinned to specific versions (lockfile present)
- [ ] No `http://` URLs in production — TLS everywhere
