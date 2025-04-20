import { readFile, readdir } from "fs/promises";
import { resolve } from "path";
import { z } from "zod";

export const LanguageMeta = z.object({
  "#comment": z.string().optional(),
  name: z.string(), // fancy name of language
  fileName: z.string(),
  neededDirs: z.string().array().default([]),
  compileScript: z.string().optional(),
  runScript: z.string(),
});

const projectRootPath = resolve(import.meta.dir, "../");

export const languages = await Promise.all(
  (
    await readdir(resolve(projectRootPath, "languages"), {
      withFileTypes: true,
    })
  )
    .filter((x) => x.isDirectory())
    .map(async (x) => {
      const meta = LanguageMeta.parse(
        JSON.parse(
          (
            await readFile(resolve(x.parentPath, x.name, "meta.json"))
          ).toString(),
        ),
      );
      return {
        id: x.name,
        runPath: resolve(x.parentPath, x.name, meta.runScript),
        compilePath: meta.compileScript
          ? resolve(x.parentPath, x.name, meta.compileScript)
          : null,
        meta,
      };
    }),
);
