import 'zod-openapi/extend';
import { z } from 'zod';
import { languages } from './languages';
import { mkdtemp } from 'fs/promises';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { rm } from 'fs/promises';
import { writeFile } from 'fs/promises';
import { existsSync } from 'fs';

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

/**
 * Returns the path to the Bubblewrap executable, preferring 'bubblewrap' over 'bwrap'.
 *
 * @returns The absolute path to the Bubblewrap executable.
 * @throws If neither 'bubblewrap' nor 'bwrap' is found in the system PATH.
 */
function getBwrapPath() {
  // First try 'bubblewrap', then fallback to 'bwrap'
  const bubblewrapPath = Bun.which('bubblewrap');
  if (bubblewrapPath) return bubblewrapPath;
  
  const bwrapPath = Bun.which('bwrap');
  if (bwrapPath) return bwrapPath;
  
  throw new Error('Bubblewrap not found. Please install it using your system package manager.');
}

/**
 * Constructs the argument list for running a command inside a Bubblewrap sandbox with minimal permissions.
 *
 * The generated arguments configure namespace isolation, restrict network access, mount essential system directories as read-only, bind the temporary working directory with write access, and set up the environment for secure code execution. Additional directories required by the language are mounted read-only if they exist.
 *
 * @param tempDir - The temporary directory to be mounted with read-write access inside the sandbox
 * @param language - The language configuration object specifying metadata and required directories
 * @param command - The shell command to execute within the sandbox
 * @returns An array of arguments to be passed to the Bubblewrap executable
 */
function createBwrapArgs(tempDir, language, command) {
  const args = [
    // Base bubblewrap command
    getBwrapPath(),
    
    // Disable network access but don't unshare everything
    // this avoids some permission issues
    '--unshare-net',
    '--unshare-pid',
    '--unshare-uts',
    '--unshare-ipc',
    
    // Don't try to mount proc or dev, use the host's
    '--die-with-parent',
    
    // Mount read-only directories
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/lib', '/lib',
  ];

  // Only include /lib64 if it exists
  if (existsSync('/lib64')) {
    args.push('--ro-bind', '/lib64', '/lib64');
  }

  // Continue with other paths
  args.push(
    '--ro-bind', '/bin', '/bin',
    '--ro-bind', '/etc', '/etc',
    '--ro-bind', '/proc', '/proc' // Use host's proc rather than trying to mount a new one
  );
  
  if (existsSync('/dev')) {
    args.push('--ro-bind', '/dev', '/dev'); // Use host's dev rather than trying to mount a new one
  }
  
  args.push(
    '--ro-bind', '/tmp', '/tmp',
    '--ro-bind', resolve(projectRootPath, './languages'), resolve(projectRootPath, './languages')
  );
  
  // Mount needed directories from language.meta.neededDirs
  for (const dir of language.meta.neededDirs) {
    if (existsSync(dir)) {
      args.push('--ro-bind', dir, dir);
    }
  }
  
  // Read-write access to the temporary directory
  args.push('--bind', tempDir, tempDir);
  
  // Set up environment
  args.push('--setenv', 'PATH', process.env.PATH || '/usr/bin:/bin');
  
  // Limit capabilities
  args.push('--new-session');
  
  // Add the command to run
  args.push(
    Bun.which('bash') || '/bin/bash',
    command
  );
  
  return args;
}

/**
 * Compiles and executes code in a specified programming language within a sandboxed environment.
 *
 * Validates input options, writes the provided code to a temporary directory, and runs compilation and execution commands under Bubblewrap isolation with resource limits. Captures and returns the exit code, standard output, standard error, and timing statistics for both compile and run phases.
 *
 * @returns An object containing the exit code, stdout, stderr, and statistics for compilation and execution.
 */
export async function execute(optionsRaw: z.infer<typeof ExecuteOptions>): Promise<z.infer<typeof ExecuteSchema>> {
  const options = ExecuteOptions.parse(optionsRaw); // we might make the zod schema change the values

  const language = languages.find((x) => x.id.toLowerCase() === options.language.toLowerCase());
  if (!language) throw Error('Language not found');

  const tempDir = await mkdtemp(join(tmpdir(), 'codefort-exec-'));

  // write code
  await writeFile(join(tempDir, language.meta.fileName), options.code);

  let compileTime = 0;
  let compileStdout = '';
  let compileStderr = '';

  if (language.compilePath) {
    let startCompileTime = Date.now();
    const compileCommand = resolve(projectRootPath, './languages/', language.id, language.compilePath);
    const compileArgs = createBwrapArgs(tempDir, language, compileCommand);
    
    const compileProc = Bun.spawn(
      compileArgs,
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
  const runCommand = resolve(projectRootPath, './languages/', language.id, language.runPath);
  const runArgs = createBwrapArgs(tempDir, language, runCommand);
  
  const runProc = Bun.spawn(
    runArgs,
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
