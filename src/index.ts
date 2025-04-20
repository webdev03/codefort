import { Scalar } from '@scalar/hono-api-reference';
import { openAPISpecs, describeRoute } from 'hono-openapi';
import { resolver, validator } from 'hono-openapi/zod';
import 'zod-openapi/extend';
import { z } from 'zod';
import { Hono } from 'hono';

import { languages } from './languages';
import { execute, ExecuteSchema } from './execute';

const app = new Hono();

app.get(
  '/v1/languages',
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

app.post(
  '/v1/run',
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
      code: z.string().openapi({
        description: 'The code that will be executed.',
        example: 'console.log("Hello, world!");',
      }),
      stdin: z.string().default('').openapi({
        description: 'The standard input given to the run process.',
      }),
      compileTimeout: z.number().default(10_000).openapi({
        description: 'The time limit of the compile process, in milliseconds.',
      }),
      compileMemoryLimit: z.number().default(512).openapi({
        description: 'The memory limit of the compile process, in megabytes.',
      }),
      runTimeout: z.number().default(10_000).openapi({
        description: 'The time limit of the run process, in milliseconds.',
      }),
      runMemoryLimit: z.number().default(512).openapi({
        description: 'The memory limit of the run process, in megabytes.',
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

export default app;
