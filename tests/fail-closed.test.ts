import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Run fault injection in a separate process so a poisoned worker cannot affect other tests.
async function fault(script: string, scenario: string) {
  const dir = await mkdtemp(join(tmpdir(), 'codefort-fault-'));
  try {
    await writeFile(join(dir, 'podman'), `#!/bin/sh\n${script}\n`, { mode: 0o700 });
    const proc = Bun.spawn([process.execPath, '-e', `
      import { Sandbox } from ${JSON.stringify(resolve(import.meta.dir, '../src/sandbox.ts'))};
      ${scenario}
    `], { env: { ...process.env, PATH: `${dir}:${process.env['PATH']}` }, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('passed');
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('cleanup failure disables further execution', async () => {
  await fault('exit 1', `
    const box = new Sandbox();
    let cleanupFailed = false;
    try { await box.close(); } catch { cleanupFailed = true; }
    if (!cleanupFailed) throw new Error('cleanup silently succeeded');
    let disabled = false;
    try { new Sandbox(); } catch { disabled = true; }
    if (!disabled) throw new Error('worker still accepts jobs');
    console.log('passed');
  `);
});

test('missing cgroup enforcement fails closed', async () => {
  await fault('printf "max\\nmax\\nmax\\nmax 100000\\n"', `
    const box = new Sandbox();
    let rejected = false;
    try { await box.verifyLimits(128); } catch { rejected = true; }
    await box.close();
    if (!rejected) throw new Error('unlimited cgroup accepted');
    console.log('passed');
  `);
});
