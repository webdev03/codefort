import { z } from "zod";
import { languages } from "./languages";
import { mkdtemp } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { rm } from "fs/promises";
import { writeFile } from "fs/promises";

const ExecuteOptions = z.object({
  language: z.enum(languages.map((x) => x.id) as [string, ...string[]]),
  version: z.string(),
  code: z.string(),
  stdin: z.string().default(""),
  compileTimeout: z.number(),
  compileMemoryLimit: z.number(),
  runTimeout: z.number(),
  runMemoryLimit: z.number(),
});

const projectRootPath = resolve(import.meta.dir, "../");

export async function execute(optionsRaw: z.infer<typeof ExecuteOptions>) {
  const options = ExecuteOptions.parse(optionsRaw); // we might make the zod schema change the values

  const language = languages.find(
    (x) => x.id.toLowerCase() === options.language.toLowerCase(),
  );
  if (!language) throw Error("Language not found");

  const tempDir = await mkdtemp(join(tmpdir(), "codefort-exec-"));

  // write code
  writeFile(join(tempDir, language.meta.fileName), options.code);

  let compileTime = 0;

  if (language.compilePath) {
    let startCompileTime = Date.now();
    const compileProc = Bun.spawn(
      [
        // START - disable network
        "unshare",
        "-r",
        "-n",
        // END - disable network
        resolve(projectRootPath, "./landrun/landrun"),
        // START - permissions
        "--rox",
        "/usr",
        "--rox",
        "/lib",
        "--rox",
        "/lib64",
        "--rox",
        "/bin",
        "--rox",
        "/dev",
        "--rox",
        "/sys/devices/system/cpu",
        "--rox",
        "/proc",
        "--rox",
        resolve(projectRootPath, "./languages"),
        ...language.meta.neededDirs.flatMap((x) => ["--rox", x]),
        "--rwx",
        tempDir,
        // END - permissions

        // vvvvvvvvvvvvv Good for debugging a new language!
        //
        //"strace",
        //"-f",
        //"-t",
        //"-e",
        //"trace=file",

        Bun.which("bash")!,
        resolve(
          projectRootPath,
          "./languages/",
          language.id,
          language.compilePath,
        ),
      ],
      {
        cwd: tempDir,
        timeout: options.compileTimeout,
        killSignal: "SIGKILL",
      },
    );

    await compileProc.exited;
    compileTime = (Date.now() - startCompileTime) / 1000;
  }

  const runStartTime = Date.now();
  const runProc = Bun.spawn(
    [
      // START - disable network
      "unshare",
      "-r",
      "-n",
      // END - disable network
      resolve(projectRootPath, "./landrun/landrun"),
      // START - permissions
      "--rox",
      "/usr",
      "--rox",
      "/lib",
      "--rox",
      "/lib64",
      "--rox",
      "/bin",
      "--rox",
      "/dev",
      "--rox",
      "/sys/devices/system/cpu",
      "--rox",
      "/proc",
      "--rox",
      resolve(projectRootPath, "./languages"),
      ...language.meta.neededDirs.flatMap((x) => ["--rox", x]),
      "--rwx",
      tempDir,
      // END - permissions

      // vvvvvvvvvvvvv Good for debugging a new language!
      //
      //"strace",
      //"-f",
      //"-t",
      //"-e",
      //"trace=file",

      Bun.which("bash")!,
      resolve(projectRootPath, "./languages/", language.id, language.runPath),
    ],
    {
      cwd: tempDir,
      stdin: new Response(options.stdin),
      timeout: options.runTimeout,
      killSignal: "SIGKILL",
    },
  );

  await runProc.exited;

  await rm(tempDir, {
    recursive: true,
    force: true,
  });

  return {
    exitCode: runProc.exitCode!, // the process has exited, ! is fine
    stdout: await new Response(runProc.stdout).text(),
    stderr: await new Response(runProc.stderr).text(),
    stats: {
      compile: language.compilePath
        ? {
            realTime: compileTime,
          }
        : null,
      run: {
        realTime: (Date.now() - runStartTime) / 1000,
      },
    },
  };
}
