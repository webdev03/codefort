# codefort

Next-generation code isolation system.

## Technology

Code execution is sandboxed with [bubblewrap](https://github.com/containers/bubblewrap)
(one-shot `bwrap` jails per compile/run: no network, private pid/uts/ipc
namespaces, read-only system mounts, writable scratch dir only).

## API auth

Set `CODEFORT_TOKEN` to require `Authorization: Bearer <token>` on
`POST /v1/run` (executing code). `GET /v1/languages` stays public by design
(non-sensitive, used by container healthchecks). With no token configured the
API is open — only expose it on a private network then.

## Limits

- Timeouts (`compileTimeout`/`runTimeout`) are enforced per process.
- Request sizes, timeouts, and memory values are clamped at the API boundary.
- Per-job memory limits are admission-only today; enforcement is at the
  container level (`mem_limit` in docker-compose.yml).
