import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Hono } from "hono";

import { languages } from "./languages";

const app = new Hono();

app.get("/", (c) =>
  c.json({
    service: "Codefort",
    help: "https://github.com/webdev03/codefort",
  }),
);

app.post(
  "/v1/run",
  zValidator(
    "json",
    z.object({
      lang: z.enum(languages.map((x) => x.id) as [string, ...string[]]),
      code: z.string(),
      stdin: z.string().default(""),
    }),
  ),
  async (c) => {
    const data = c.req.valid("json");
    // TODO: Execution logic
    return c.json({});
  },
);

export default app;
