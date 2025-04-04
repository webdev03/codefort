import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Hono } from "hono";

import { languages } from "./languages";
import { execute } from "./execute";

const app = new Hono();

app.get("/", (c) =>
  c.json({
    service: "Codefort",
    help: "https://github.com/webdev03/codefort",
  }),
);

app.get("/v1/languages", (c) => c.json(languages.map((x) => x.id)));

app.post(
  "/v1/run",
  zValidator(
    "json",
    z
      .object({
        language: z.enum(languages.map((x) => x.id) as [string, ...string[]]),
        version: z.string(),
        code: z.string(),
        stdin: z.string().default(""),
        compileTimeout: z.number().default(10_000),
        compileMemoryLimit: z.number().default(512),
        runTimeout: z.number().default(10_000),
        runMemoryLimit: z.number().default(512),
      })
      .refine((data) => {
        // TODO: Add versions
        //data.version;
        return true;
      }),
  ),
  async (c) => {
    const data = c.req.valid("json");
    const result = await execute({
      language: data.language,
      version: data.version,
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

export default app;
