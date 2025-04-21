import 'zod-openapi/extend';
import { z } from 'zod';
import { languages } from './languages';
import { mkdtemp } from 'fs/promises';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { rm } from 'fs/promises';
import { writeFile } from 'fs/promises';

const ExecuteOptions = z.object({
  language: z.enum(languages.map((x) => x.id) as [string, ...string[]]),
  code: z.string(),
  stdin: z.string().default(''),
  compileTimeout: z.number(),
  compileMemoryLimit: z.number(),
  runTimeout: z.number(),
  runMemoryLimit: z.number(),
});

const projectRootPath = resolve(import.meta.dir, '../');

export const ExecuteSchema = z.object({
  exitCode: z.number().openapi({
    description: 'The numeric exit code given by the code when executed.',
  }),
  stdout: z.string().openapi({
    description: 'The stdout given by the code when executed.',
  }),
  stderr: z.string().openapi({
    description: 'The stderr given by the code when executed.',
  }),
  stats: z.object({
    compile: z
      .object({
        realTime: z.number().openapi({
          description: 'The amount of time taken to compile the program, in milliseconds.',
        }),
        stdout: z.string(),
        stderr: z.string(),
      })
      .nullable()
      .openapi({
        description: 'Information about the compile process, if applicable to the language.',
        example: {
          realTime: 9,
          stdout: 'Compiled successfully!',
          stderr: '',
        },
      }),
    run: z
      .object({
        realTime: z.number(),
      })
      .openapi({
        description: 'Information about the run process.',
        example: {
          realTime: 8,
        },
      }),
  }),
});

export async function execute(optionsRaw: z.infer<typeof ExecuteOptions>): Promise<z.infer<typeof ExecuteSchema>> {
  const options = ExecuteOptions.parse(optionsRaw); // we might make the zod schema change the values

  const language = languages.find((x) => x.id.toLowerCase() === options.language.toLowerCase());
  if (!language) throw Error('Language not found');

  const tempDir = await mkdtemp(join(tmpdir(), 'codefort-exec-'));

  // write code
  writeFile(join(tempDir, language.meta.fileName), options.code);

  let compileTime = 0;
  let compileStdout = '';
  let compileStderr = '';

  if (language.compilePath) {
    let startCompileTime = Date.now();
    const compileProc = Bun.spawn(
      [
        // START - disable network
        'unshare',
        '-r',
        '-n',
        // END - disable network
        resolve(projectRootPath, './landrun/landrun'),
        // START - permissions
        '--rox',
        '/usr',
        '--rox',
        '/lib',
        '--rox',
        '/lib64',
        '--rox',
        '/bin',
        '--rox',
        '/dev',
        '--rox',
        '/proc',
        '--rox',
        '/etc',
        '--rox',
        '/tmp',
        '--rox',
        resolve(projectRootPath, './languages'),
        ...language.meta.neededDirs.flatMap((x) => ['--rox', x]),
        '--rwx',
        tempDir,
        // END - permissions

        // vvvvvvvvvvvvv Good for debugging a new language!
        //
        //"strace",
        //"-f",
        //"-t",
        //"-e",
        //"trace=file",

        Bun.which('bash')!,
        resolve(projectRootPath, './languages/', language.id, language.compilePath),
      ],
      {
        cwd: tempDir,
        timeout: options.compileTimeout,
        killSignal: 'SIGKILL',
        stdout: 'pipe',
        stderr: 'pipe',
        maxBuffer: 2 * 1024 * 1024, // 2mb
      },
    );

    await compileProc.exited;
    compileTime = Date.now() - startCompileTime;
    compileStdout = await new Response(compileProc.stdout).text();
    compileStderr = await new Response(compileProc.stderr).text();
  }

  const runStartTime = Date.now();
  const runProc = Bun.spawn(
    [
      // START - disable network
      'unshare',
      '-r',
      '-n',
      // END - disable network
      resolve(projectRootPath, './landrun/landrun'),
      // START - permissions
      '--rox',
      '/usr',
      '--rox',
      '/lib',
      '--rox',
      '/lib64',
      '--rox',
      '/bin',
      '--rox',
      '/dev',
      '--rox',
      '/proc',
      '--rox',
      '/etc',
      '--rox',
      '/tmp',
      '--rox',
      resolve(projectRootPath, './languages'),
      ...language.meta.neededDirs.flatMap((x) => ['--rox', x]),
      '--rwx',
      tempDir,
      // END - permissions

      // vvvvvvvvvvvvv Good for debugging a new language!
      //
      //"strace",
      //"-f",
      //"-t",
      //"-e",
      //"trace=file",

      Bun.which('bash')!,
      resolve(projectRootPath, './languages/', language.id, language.runPath),
    ],
    {
      cwd: tempDir,
      timeout: options.runTimeout,
      killSignal: 'SIGKILL',
      stdin: new Response(options.stdin),
      stdout: 'pipe',
      stderr: 'pipe',
      maxBuffer: 2 * 1024 * 1024, // 2mb
    },
  );
  console.log(options);
  const exitCode = await runProc.exited;

  await rm(tempDir, {
    recursive: true,
    force: true,
  });

  return {
    exitCode,
    stdout: await new Response(runProc.stdout).text(),
    stderr: await new Response(runProc.stderr).text(),
    stats: {
      compile: language.compilePath
        ? {
            realTime: compileTime,
            stdout: compileStdout,
            stderr: compileStderr,
          }
        : null,
      run: {
        realTime: Date.now() - runStartTime,
      },
    },
  };
}
