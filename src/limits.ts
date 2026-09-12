import 'zod-openapi/extend';
import { z } from 'zod';
import { languages } from './languages';

export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
export const MAX_CONCURRENT_JOBS = 2;
export const MAX_TIMEOUT_MS = 20_000;

const text = z.string().refine((value) => Buffer.byteLength(value) <= 256 * 1024, 'Maximum size is 256 KiB');
const timeout = z.number().int().min(1).max(MAX_TIMEOUT_MS).default(10_000);
const memory = z.number().int().min(128).max(512).default(512);

// Shared by the HTTP boundary and direct callers. Defaults are not security ceilings.
export const ExecuteOptions = z.object({
  language: z.enum(languages.map((x) => x.id) as [string, ...string[]]),
  code: text,
  stdin: text.default(''),
  compileTimeout: timeout,
  compileMemoryLimit: memory,
  runTimeout: timeout,
  runMemoryLimit: memory,
});

export class BusyError extends Error {}
export class SandboxError extends Error {}
