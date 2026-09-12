import 'zod-openapi/extend';
import { z } from 'zod';
import { languages } from './languages';
import { ExecuteOptions } from './limits';
import { Sandbox } from './sandbox';

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

export async function execute(optionsRaw: z.input<typeof ExecuteOptions>): Promise<z.infer<typeof ExecuteSchema>> {
  const options = ExecuteOptions.parse(optionsRaw);
  const language = languages.find((x) => x.id === options.language)!;
  const sandbox = new Sandbox();
  let compile: { realTime: number; stdout: string; stderr: string } | null = null;
  try {
    await sandbox.start(language.compilePath ? options.compileMemoryLimit : options.runMemoryLimit);
    await sandbox.writeSource(language.meta.fileName, options.code);
    if (language.compilePath) {
      const result = await sandbox.run(language.compilePath, options.compileTimeout);
      compile = { realTime: result.realTime, stdout: result.stdout, stderr: result.stderr };
      if (result.exitCode !== 0) {
        return { exitCode: result.exitCode, stdout: '', stderr: '', stats: { compile, run: { realTime: 0 } } };
      }
      await sandbox.setMemory(options.runMemoryLimit);
    }
    const result = await sandbox.run(language.runPath, options.runTimeout, options.stdin);
    return {
      exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
      stats: { compile, run: { realTime: result.realTime } },
    };
  } finally {
    // Includes failed startup, source writes, compilation, execution and pipe deadlines.
    await sandbox.close();
  }
}
