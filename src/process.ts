import { spawn } from 'node:child_process';
import { MAX_OUTPUT_BYTES } from './limits';

export type ProcessResult = { exitCode: number; stdout: string; stderr: string; realTime: number };

// Drain both pipes concurrently and keep the deadline active until their EOFs.
// Do not rely on Bun.spawn's version-dependent buffering/timeout behaviour.
export function runProcess(
  command: string[],
  timeout: number,
  input = '',
  maxOutput = MAX_OUTPUT_BYTES,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const proc = spawn(command[0]!, command.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    const output: Buffer[][] = [[], []];
    let bytes = 0;
    let finished = false;
    const finish = (exitCode: number, stop = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (stop) {
        proc.kill('SIGKILL');
        proc.stdin.destroy();
        proc.stdout.destroy();
        proc.stderr.destroy();
      }
      resolve({
        exitCode,
        stdout: Buffer.concat(output[0]!).toString(),
        stderr: Buffer.concat(output[1]!).toString(),
        realTime: Date.now() - start,
      });
    };
    const timer = setTimeout(() => finish(124, true), timeout);
    for (const [index, stream] of [proc.stdout, proc.stderr].entries()) {
      stream.on('data', (chunk: Buffer) => {
        if (finished) return;
        const remaining = maxOutput - bytes;
        output[index]!.push(chunk.subarray(0, Math.max(0, remaining)));
        bytes += chunk.length;
        if (bytes > maxOutput) finish(125, true);
      });
    }
    proc.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });
    proc.on('close', (code) => finish(code ?? 137));
    // An early-exiting program is allowed not to consume all of stdin.
    proc.stdin.on('error', () => {});
    proc.stdin.end(input);
  });
}
