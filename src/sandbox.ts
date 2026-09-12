import { randomUUID } from 'node:crypto';
import { BusyError, MAX_CONCURRENT_JOBS, SandboxError } from './limits';
import { runProcess } from './process';

const containers = new Set<string>();
let unhealthy = false;
const podman = ['podman', '--remote=false'];
const controlTimeout = 15_000;

async function control(args: string[], input = '') {
  const result = await runProcess([...podman, ...args], controlTimeout, input, 64 * 1024);
  if (result.exitCode !== 0) {
    // Available to CLI callers/tests; the API always returns a generic 503.
    throw new SandboxError(`Sandbox ${args[0]} failed (${result.exitCode}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

export class Sandbox {
  readonly name = `codefort-${randomUUID()}`;

  constructor() {
    if (unhealthy) throw new SandboxError('Sandbox cleanup failed; operator intervention required');
    // Reject excess work instead of retaining an unbounded queue of source/input.
    if (containers.size >= MAX_CONCURRENT_JOBS) throw new BusyError('Execution capacity reached');
    containers.add(this.name);
  }

  async start(memory: number) {
    await control([
      'run', '--detach', '--name', this.name, '--label', 'app=codefort',
      '--pull=never', '--http-proxy=false', '--network=none', '--pid=private', '--ipc=private', '--cgroupns=private',
      '--cgroups=enabled', '--read-only', '--read-only-tmpfs=false', '--cap-drop=ALL',
      '--security-opt=no-new-privileges', '--user=65534:65534', '--workdir=/work',
      '--memory', `${memory}m`, '--memory-swap', `${memory}m`, '--cpus=1', '--pids-limit=64',
      '--ulimit=nofile=256:256', '--ulimit=core=0:0', '--log-driver=none', '--shm-size=1m',
      '--tmpfs=/work:rw,exec,nosuid,nodev,size=64m,mode=0700,uid=65534,gid=65534',
      '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777',
      '--env=HOME=/work', '--env=TMPDIR=/tmp', '--env=PATH=/usr/local/bin:/usr/bin:/bin',
      // Conmon enforces a lifetime even if the API process is abruptly killed.
      '--timeout=120', '--entrypoint=/bin/sleep',
      process.env['CODEFORT_IMAGE'] || 'localhost/codefort-sandbox:local', '120',
    ]);
    await this.verifyLimits(memory);
  }

  async verifyLimits(memory: number) {
    // Fail closed on unsupported/undelegated controllers; flags alone are not proof.
    const result = await control(['exec', this.name, '/bin/cat',
      '/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory.swap.max',
      '/sys/fs/cgroup/pids.max', '/sys/fs/cgroup/cpu.max']);
    const [max, swap, pids, cpu] = result.split('\n');
    const [quota, period] = (cpu || '').split(' ').map(Number);
    if (Number(max) !== memory * 1024 * 1024 || swap !== '0' || pids !== '64' ||
        !quota || !period || quota / period > 1) {
      throw new SandboxError('Required cgroup limits are unavailable');
    }
  }

  async setMemory(memory: number) {
    await control(['update', '--memory', `${memory}m`, '--memory-swap', `${memory}m`, this.name]);
    await this.verifyLimits(memory);
  }

  async writeSource(fileName: string, code: string) {
    // The filename is trusted metadata, but is still checked before shell use.
    if (!/^[a-zA-Z0-9_.-]+$/.test(fileName) || fileName === '.' || fileName === '..') {
      throw new SandboxError('Invalid source filename');
    }
    await control(['exec', '-i', this.name, '/bin/bash', '-c', 'cat > "$1"', 'write-source', `/work/${fileName}`], code);
  }

  run(script: string, timeout: number, stdin = '') {
    return runProcess([...podman, 'exec', '-i', this.name, '/bin/bash', script], timeout, stdin);
  }

  async close() {
    try {
      // Removes the entire container/cgroup, including detached descendants.
      await control(['rm', '--force', '--time=0', '--ignore', this.name]);
    } catch {
      unhealthy = true;
      throw new SandboxError('Sandbox cleanup failed; execution disabled');
    } finally {
      containers.delete(this.name);
    }
  }
}
