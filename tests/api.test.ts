import { describe, expect, test } from 'bun:test';
import { createApp } from '../src/app';
import { ExecuteOptions, BusyError } from '../src/limits';

const key = 'test-key-'.repeat(8);
const response = { exitCode: 0, stdout: '', stderr: '', stats: { compile: null, run: { realTime: 1 } } };
const request = (body: unknown, authorization = `Bearer ${key}`) => new Request('http://localhost/v1/run', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body: JSON.stringify(body),
});

describe('API security boundary', () => {
  test('refuses to start without a strong key', () => {
    expect(() => createApp('')).toThrow();
    expect(() => createApp('short')).toThrow();
  });
  test('rejects missing and incorrect credentials before execution', async () => {
    let calls = 0;
    const app = createApp(key, async () => { calls++; return response; });
    for (const credential of ['', 'Bearer wrong', key]) {
      expect((await app.request(request({ language: 'bash', code: 'true' }, credential))).status).toBe(401);
    }
    expect(calls).toBe(0);
  });
  test('valid request retains defaults and stdin', async () => {
    const app = createApp(key, async (options) => {
      expect(options.runTimeout).toBe(10_000);
      expect(options.runMemoryLimit).toBe(512);
      expect(options.stdin).toBe('hello');
      return response;
    });
    expect((await app.request(request({ language: 'bash', code: 'cat', stdin: 'hello' }))).status).toBe(200);
  });
  test('rejects unsafe resource values, oversized strings and unknown languages', async () => {
    const app = createApp(key, async () => { throw new Error('Must not execute'); });
    for (const override of [
      { runTimeout: 0 }, { compileTimeout: -1 }, { runTimeout: 20_001 }, { compileTimeout: 1.5 },
      { runMemoryLimit: 0 }, { compileMemoryLimit: 513 }, { runMemoryLimit: 128.5 },
      { code: 'x'.repeat(256 * 1024 + 1) }, { stdin: 'é'.repeat(256 * 1024) }, { language: '../../bash' },
    ]) {
      expect((await app.request(request({ language: 'bash', code: 'true', ...override }))).status).toBe(400);
    }
    expect(ExecuteOptions.safeParse({ language: 'bash', code: '', runTimeout: Infinity }).success).toBe(false);
  });
  test('limits the raw body even when Content-Length is absent', async () => {
    const app = createApp(key);
    const bytes = new TextEncoder().encode('x'.repeat(1024 * 1024 + 1));
    const body = new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
    const req = new Request('http://localhost/v1/run', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body,
    });
    expect((await app.request(req)).status).toBe(413);
  });
  test('returns bounded capacity errors and hides internal diagnostics', async () => {
    for (const [error, status] of [[new BusyError(), 429], [new Error('secret host path'), 503]] as const) {
      const app = createApp(key, async () => { throw error; });
      const res = await app.request(request({ language: 'bash', code: 'true' }));
      expect(res.status).toBe(status);
      expect(await res.text()).not.toContain('secret host path');
    }
  });
});
