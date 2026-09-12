import { Scalar } from '@scalar/hono-api-reference';
import { openAPISpecs, describeRoute } from 'hono-openapi';
import { resolver, validator } from 'hono-openapi/zod';
import 'zod-openapi/extend';
import { z } from 'zod';
import { Hono } from 'hono';

import { languages } from './languages';
import { execute, ExecuteSchema } from './execute';

const app = new Hono();

const v1 = new Hono();

// Optional shared-secret auth for code execution. Set CODEFORT_TOKEN to the
// same value on the caller (happyjudge sends it as a Bearer token). When
// unset, the API is open — only deploy it on a private network then.
// NOTE: only /run is guarded; /languages stays public (non-sensitive, and
// container healthchecks hit it without credentials).
v1.use('/run', async (c, next) => {
  const expected = process.env['CODEFORT_TOKEN'];
  if (expected && c.req.header('authorization') !== `Bearer ${expected}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

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
  validator(
    'json',
    z.object({
      language: z.enum(languages.map((x) => x.id) as [string, ...string[]]).openapi({
        description: 'The ID of the language that the code is written in.',
        example: 'cpp-gcc',
      }),
      // Defense in depth: happyjudge caps these client-side, but the sandbox
      // must not trust callers. Rejects oversized payloads with 400.
      code: z.string().max(1_000_000).openapi({
        description: 'The code that will be executed.',
        example: 'console.log("Hello, world!");',
      }),
      stdin: z.string().max(1_000_000).default('').openapi({
        description: 'The standard input given to the run process.',
      }),
      compileTimeout: z.number().min(1).max(120_000).default(10_000).openapi({
        description: 'The time limit of the compile process, in milliseconds.',
      }),
      compileMemoryLimit: z.number().min(0).max(4096).default(512).openapi({
        description:
          'The memory limit of the compile process, in megabytes. NOTE: currently admission-only, enforced at the container level.',
      }),
      runTimeout: z.number().min(1).max(120_000).default(10_000).openapi({
        description: 'The time limit of the run process, in milliseconds.',
      }),
      runMemoryLimit: z.number().min(0).max(4096).default(512).openapi({
        description:
          'The memory limit of the run process, in megabytes. NOTE: currently admission-only, enforced at the container level.',
      }),
    }),
  ),
  async (c) => {
    const data = c.req.valid('json');
    const result = await execute({
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

export default {
  port: process.env['PORT'] || 3000,
  fetch: app.fetch,
};
