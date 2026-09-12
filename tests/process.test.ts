import { expect, test } from 'bun:test';
import { runProcess } from '../src/process';

test('drains stdout and stderr without deadlocking', async () => {
  const result = await runProcess(['/bin/bash', '-c', 'head -c 200000 /dev/zero; head -c 200000 /dev/zero >&2'], 5000);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.length).toBe(200000);
  expect(result.stderr.length).toBe(200000);
});
test('caps aggregate output while the producer is still running', async () => {
  const result = await runProcess(['/usr/bin/yes'], 5000, '', 4096);
  expect(result.exitCode).toBe(125);
  expect(Buffer.byteLength(result.stdout + result.stderr)).toBeLessThanOrEqual(4096);
});
test('enforces a deadline', async () => {
  const result = await runProcess(['/bin/sleep', '5'], 100);
  expect(result.exitCode).toBe(124);
  expect(result.realTime).toBeLessThan(3000);
});
test('handles programs closing stdin early', async () => {
  expect((await runProcess(['/bin/true'], 2000, 'x'.repeat(256 * 1024))).exitCode).toBe(0);
});
