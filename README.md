# codefort

Run Bash, C++, JavaScript and TypeScript in disposable Linux sandboxes.

## Setup

Requires Bun 1.4.2+, Podman and cgroup v2 with delegated memory, swap, CPU and PID controllers. Run `./setup.bash` to install dependencies and build the local runtime image. Run setup and the API under the same dedicated account; rootless Podman is recommended. Jobs fail closed when required cgroup limits cannot be verified.

Set `CODEFORT_API_KEY` to a randomly generated secret of at least 32 characters, then run `bun start`. Send `Authorization: Bearer <key>` to `POST /v1/run`. The server binds to `127.0.0.1` by default; configure `HOST` explicitly for a reverse proxy and terminate TLS there. Keep the bearer key on your backend, not in browser code. `PORT` defaults to 3000. `CODEFORT_IMAGE` can select an operator-built local image; requests cannot select images or host mounts.

## Execution limits

- At most two jobs per API process; excess requests receive 429 without entering a queue.
- Source and stdin each have a 256 KiB UTF-8 limit; raw requests are capped at 1 MiB.
- Compile/run timeouts are integer milliseconds from 1 to 20,000 (default 10,000).
- Compile/run memory limits are integer MiB from 128 to 512 (default 512), enforced with cgroup v2; swap is disabled.
- Each job gets one CPU, at most 64 processes/threads, a 64 MiB workspace and 16 MiB temporary directory. Tmpfs usage also counts toward memory limits.
- Combined stdout/stderr is capped at 2 MiB per phase. Exit code 124 indicates a deadline; 125 can indicate output overflow or a runtime failure.
- Jobs use a read-only container image, private PID/IPC/network namespaces, no network access, no host mounts, an unprivileged UID, dropped capabilities and no-new-privileges. Podman's default seccomp policy remains enabled.
- Container removal is awaited on every exit path, including timeouts. A cleanup failure disables further execution in that API process; inspect/remove remaining containers labelled `app=codefort` before restarting. A 120-second container lifetime limits execution if the API is abruptly killed; stopped container metadata may still require removal.

Compilation failure is returned in `stats.compile` and skips execution. Code and stdin are not logged. Custom language runtimes must be installed in the image; the old `neededDirs` host-path allowances are no longer used. Rebuild the image after changing language scripts. Runtime images must contain no secrets.

Containers still share the host kernel. Use a dedicated, patched worker host for hostile workloads, and size total worker capacity across API processes. The previous Landrun-only backend is not used.

## Tests

`bun test` runs the unit suite (integration tests skip unless opted in). After building the image, run `bun run test:integration` on a Linux host with the required controllers. The integration suite exercises real execution, cross-job/host file isolation, network denial, resource limits, output/deadline handling and container cleanup. Run it under a dedicated account with no other Codefort jobs, since it asserts that no labelled containers remain. GitHub Actions runs both suites and TypeScript checking.
