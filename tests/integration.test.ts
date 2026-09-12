import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute } from '../src/execute';
import { Sandbox } from '../src/sandbox';
import { runProcess } from '../src/process';
import { BusyError, MAX_OUTPUT_BYTES } from '../src/limits';

const integration = process.env['CODEFORT_INTEGRATION'] === '1' ? describe : describe.skip;
integration('real Podman sandbox', () => {
  afterEach(async () => {
    const result = await runProcess(['podman', '--remote=false', 'ps', '-aq', '--filter=label=app=codefort'], 15000);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  test('all languages execute and stdin is preserved', async () => {
    for (const [language, code] of [
      ['bash', 'read -r line; printf "%s" "$line"'],
      ['javascript-bun', 'process.stdout.write(await Bun.stdin.text())'],
      ['typescript-bun', 'const input: string = await Bun.stdin.text(); process.stdout.write(input)'],
      ['cpp-gcc', '#include <iostream>\n#include <string>\nint main(){std::string s;std::getline(std::cin,s);std::cout<<s;}'],
    ]) {
      const result = await execute({ language: language!, code: code!, stdin: 'hello' });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello');
    }
  }, 120000);

  test('cannot read host files or a concurrent job workspace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codefort-exec-'));
    // Make the canary readable so Unix permissions cannot mask a mount leak.
    await chmod(dir, 0o755);
    await writeFile(join(dir, 'secret'), 'host-canary');
    const other = new Sandbox();
    try {
      await other.start(128);
      await other.writeSource('private.txt', 'other-job-canary');
      const result = await execute({ language: 'bash', code: `
        test ! -e '${dir}/secret' || exit 1
        test ! -e /work/private.txt || exit 2
        test ! -e /run/podman/podman.sock || exit 3
        test ! -e /var/run/docker.sock || exit 4
        echo isolated
      ` });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('isolated');
    } finally {
      await other.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);

  test('network, host environment, privilege escalation and rootfs writes are blocked', async () => {
    process.env['CODEFORT_TEST_SECRET'] = 'must-not-enter-container';
    try {
      const result = await execute({ language: 'bash', code: `
        set -eu
        test -z "\${CODEFORT_TEST_SECRET:-}"
        test "$(id -u)" = 65534
        grep -q 'NoNewPrivs:.*1' /proc/self/status
        grep -q 'CapEff:.*0000000000000000' /proc/self/status
        ! touch /etc/codefort-test
        python3 -c 'import socket; s=socket.socket(); s.settimeout(1); s.connect(("1.1.1.1",443))' && exit 1
        echo isolated
      ` });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('isolated');
    } finally { delete process.env['CODEFORT_TEST_SECRET']; }
  }, 30000);

  test('actual cgroup memory limit kills an over-budget allocation', async () => {
    const result = await execute({ language: 'bash', runMemoryLimit: 128,
      code: `python3 -c 'x=bytearray(256*1024*1024); print("survived")'` });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain('survived');
  }, 30000);

  test('run memory is lowered after compilation', async () => {
    const result = await execute({ language: 'cpp-gcc', compileMemoryLimit: 512, runMemoryLimit: 128,
      code: '#include <fstream>\n#include <iostream>\nint main(){std::ifstream f("/sys/fs/cgroup/memory.max");std::cout<<f.rdbuf();}' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(String(128 * 1024 * 1024));
  }, 30000);

  test('temporary storage is bounded', async () => {
    const result = await execute({ language: 'bash', code: 'dd if=/dev/zero of=/work/full bs=1M count=80 status=none' });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('No space left on device');
  }, 30000);

  test('PID limit rejects a bounded attempt to exceed 64 processes', async () => {
    const result = await execute({ language: 'bash', code: `python3 - <<'PY'
import subprocess
children=[]
try:
    for _ in range(80): children.append(subprocess.Popen(['sleep','5']))
    print('unlimited')
except OSError:
    print('limited')
finally:
    for p in children: p.kill()
    for p in children: p.wait()
PY` });
    expect(result.stdout.trim()).toBe('limited');
  }, 30000);

  test('deadline removes detached descendants and inherited pipes', async () => {
    const result = await execute({ language: 'bash', runTimeout: 500,
      code: 'setsid bash -c "sleep 60" & wait' });
    expect(result.exitCode).toBe(124);
  }, 30000);

  test('successful parent exit also removes background descendants', async () => {
    const result = await execute({ language: 'bash', code: 'setsid sleep 60 </dev/null >/dev/null 2>&1 & echo done' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('done');
  }, 30000);

  test('output flood is bounded and cleaned up', async () => {
    const result = await execute({ language: 'bash', code: 'yes' });
    expect(result.exitCode).toBe(125);
    expect(Buffer.byteLength(result.stdout + result.stderr)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  }, 30000);

  test('failed compilation never starts execution', async () => {
    const result = await execute({ language: 'cpp-gcc', code: 'not valid C++' });
    expect(result.exitCode).not.toBe(0);
    expect(result.stats.compile!.stderr.length).toBeGreaterThan(0);
    expect(result.stats.run.realTime).toBe(0);
  }, 30000);

  test('compile deadline also tears down the container', async () => {
    const result = await execute({ language: 'cpp-gcc', compileTimeout: 1, code: 'int main(){}' });
    expect(result.exitCode).toBe(124);
    expect(result.stats.run.realTime).toBe(0);
  }, 30000);

  test('capacity rejects excess work, then recovers', async () => {
    const first = new Sandbox();
    const second = new Sandbox();
    try { expect(() => new Sandbox()).toThrow(BusyError); }
    finally { await first.close(); await second.close(); }
    const next = new Sandbox();
    await next.close();
  }, 30000);

  test('startup failure cleans up and releases capacity', async () => {
    const previous = process.env['CODEFORT_IMAGE'];
    process.env['CODEFORT_IMAGE'] = 'localhost/codefort-nonexistent:test';
    try { await expect(execute({ language: 'bash', code: 'true' })).rejects.toThrow(); }
    finally {
      if (previous === undefined) delete process.env['CODEFORT_IMAGE'];
      else process.env['CODEFORT_IMAGE'] = previous;
    }
    expect((await execute({ language: 'bash', code: 'true' })).exitCode).toBe(0);
  }, 60000);
});
