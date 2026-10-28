import { resolve } from 'node:path';
import { contractEntry } from './contract.ts';
import { generate, projectRoot } from './generate.ts';

try {
  const output = await generate(contractEntry(projectRoot), resolve(projectRoot, 'dist/index.html'));
  process.stdout.write(`已生成离线 HTML：${output}\n`);
} catch (error) {
  process.stderr.write(`错误：${(error as Error).message}\n`);
  process.exitCode = 1;
}
