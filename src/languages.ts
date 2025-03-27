import { readFile, readdir } from "fs/promises";
import { resolve } from "path";
import { z } from "zod";

export const LanguageMeta = z.object({
  fileName: z.string(),
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
        runPath: resolve(x.parentPath, x.name, "run.bash"),
        meta,
      };
    }),
);
