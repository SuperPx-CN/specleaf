import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

// Write beside the destination so replacement stays on the same filesystem.
export async function atomicWriteFile(
  path: string,
  content: string | Buffer,
  beforeReplace?: () => Promise<void>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: 'wx' });
    await beforeReplace?.();
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
