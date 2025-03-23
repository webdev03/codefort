import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) =>
  c.json({
    service: "Codefort",
    help: "https://github.com/webdev03/codefort",
  }),
);

export default app;
