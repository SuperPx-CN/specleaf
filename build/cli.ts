#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractEntry } from './contract.ts';
import { generate, projectRoot } from './generate.ts';

const help = `用法：specleaf <input> [-o <output.html>]

把本地 OpenAPI 3.0 / 3.1 YAML 或 JSON 转为单个离线 HTML。
输入、输出路径相对调用目录解析，默认输出 ./openapi.html。

选项：
  -o, --output <文件>  指定输出文件
  -h, --help           显示帮助
  -v, --version        显示版本
`;

export function parseArguments(args: string[]): { input?: string; output: string; help?: boolean; version?: boolean } {
  let input: string | undefined;
  let output = 'openapi.html';
  let positional = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!positional && (argument === '--help' || argument === '-h')) return { output, help: true };
    if (!positional && (argument === '--version' || argument === '-v')) return { output, version: true };
    if (!positional && argument === '--') { positional = true; continue; }
    if (!positional && (argument === '-o' || argument === '--output')) {
      const value = args[++index];
      if (!value || value.startsWith('-')) throw new Error(`${argument} 缺少输出文件路径。`);
      output = value;
    } else if (!positional && argument.startsWith('--output=')) {
      output = argument.slice('--output='.length);
      if (!output) throw new Error('--output 缺少输出文件路径。');
    } else if (!positional && argument.startsWith('-')) {
      throw new Error(`未知参数：${argument}`);
    } else if (input) throw new Error(`只能指定一个输入文件，多余输入：${argument}`);
    else input = argument;
  }
  if (!input) throw new Error('缺少 OpenAPI 输入文件。');
  return { input, output };
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) process.stdout.write(help);
  else if (args.version) {
    const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    process.stdout.write(`${version}\n`);
  }
  else {
    // npm changes cwd to the package directory; INIT_CWD retains the invocation directory.
    const sourceCommand = fileURLToPath(import.meta.url) === resolve(projectRoot, 'build/cli.ts');
    if (process.platform === 'win32') process.stdout.write(`Invocation diagnostics: ${JSON.stringify({ sourceCommand, module: fileURLToPath(import.meta.url), source: resolve(projectRoot, 'build/cli.ts'), event: process.env.npm_lifecycle_event, initial: process.env.INIT_CWD, cwd: process.cwd(), environment: Object.entries(process.env).filter(([key]) => /^(INIT_CWD|npm_lifecycle_event)$/i.test(key)) })}\n`);
    const cwd = sourceCommand && process.env.npm_lifecycle_event === 'generate'
      ? process.env.INIT_CWD || process.cwd() : process.cwd();
    const output = await generate(contractEntry(cwd, args.input!), resolve(cwd, args.output));
    process.stdout.write(`已生成离线 HTML：${output}\n`);
  }
} catch (error) {
  process.stderr.write(`错误：${(error as Error).message}\n运行 specleaf --help 查看用法。\n`);
  process.exitCode = 1;
}
