import { Scalar } from '@scalar/hono-api-reference';
import { openAPISpecs, describeRoute } from 'hono-openapi';
import { resolver, validator } from 'hono-openapi/zod';
import 'zod-openapi/extend';
import { z } from 'zod';
import { Hono } from 'hono';

import { languages } from './languages';
import { execute, ExecuteSchema } from './execute';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ExecuteOptions, MAX_BODY_BYTES, BusyError } from './limits';

export function createApp(apiKey: string, runner: typeof execute = execute) {
if (apiKey.length < 32) throw new Error('CODEFORT_API_KEY must contain at least 32 characters');
const app = new Hono();
const expected = createHash('sha256').update(`Bearer ${apiKey}`).digest();
app.use('/v1/run', async (c, next) => {
  const actual = createHash('sha256').update(c.req.header('Authorization') || '').digest();
  if (!timingSafeEqual(actual, expected)) return c.json({ error: 'Unauthorized' }, 401);
  await next();
});
app.use('/v1/run', async (c, next) => {
  const reader = c.req.raw.body?.getReader();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          void reader.cancel().catch(() => {});
          return c.json({ error: 'Request too large' }, 413);
        }
        chunks.push(value);
      }
    } catch {
      return c.json({ error: 'Invalid request body' }, 400);
    } finally {
      reader.releaseLock();
    }
    // Count actual bytes, including chunked requests; do not trust Content-Length.
    c.req.raw = new Request(c.req.raw, { body: Buffer.concat(chunks) });
  }
  await next();
});
app.onError((error, c) => {
  if (error instanceof BusyError) {
    c.header('Retry-After', '1');
    return c.json({ error: 'Execution capacity reached' }, 429);
  }
  // Do not log source/stdin or return runtime/host diagnostics to clients.
  return c.json({ error: 'Sandbox unavailable' }, 503);
});

const v1 = new Hono();

v1.get(
  '/languages',
  describeRoute({
    description: 'Lists the languages that are available on this instance.',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: resolver(
              z
                .object({
                  id: z.string().openapi({
                    description: 'The ID of the language, which must be provided when executing code.',
                    example: 'cpp-gcc',
                  }),
                  name: z.string().openapi({
                    description: 'The human readable name given to the language.',
                    example: 'C++ (GCC)',
                  }),
                })
                .array()
                .openapi({
                  description: 'An array of language objects.',
                  example: [
                    { id: 'cpp-gcc', name: 'C++ (GCC)' },
                    { id: 'javascript-bun', name: 'JavaScript (Bun)' },
                  ],
                }),
            ),
          },
        },
      },
    },
  }),
  (c) =>
    c.json(
      languages.map((x) => ({
        id: x.id,
        name: x.meta.name,
      })),
    ),
);

v1.post(
  '/run',
  describeRoute({
    description: 'Executes code in the codefort sandbox.',
    responses: {
      200: {
        description: 'Successful response',
        content: {
          'application/json': { schema: resolver(ExecuteSchema) },
        },
      },
    },
  }),
  validator('json', ExecuteOptions),
  async (c) => {
    const data = c.req.valid('json');
    const result = await runner({
      language: data.language,
      code: data.code,
      stdin: data.stdin,
      compileTimeout: data.compileTimeout,
      compileMemoryLimit: data.compileMemoryLimit,
      runTimeout: data.runTimeout,
      runMemoryLimit: data.runMemoryLimit,
    });
    return c.json(result);
  },
);

app.route('/v1', v1);

app.get(
  '/openapi',
  openAPISpecs(app, {
    documentation: {
      info: {
        title: 'codefort',
        description: 'Next-generation code isolation system.',
      },
    },
  }),
);

app.get(
  '/',
  Scalar({
    theme: 'bluePlanet',
    url: '/openapi',
  }),
);

return app;
}
