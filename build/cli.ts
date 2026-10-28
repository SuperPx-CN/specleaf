import { resolve } from 'node:path';
import { contractEntry } from './contract.ts';
import { generate } from './generate.ts';

const help = `用法：npm run generate -- <input> [-o <output.html>]

把本地 OpenAPI 3.0 / 3.1 YAML 或 JSON 转为单个离线 HTML。
输入、输出路径相对调用目录解析，默认输出 ./openapi.html。

选项：
  -o, --output <文件>  指定输出文件
  -h, --help           显示帮助
`;

export function parseArguments(args: string[]): { input?: string; output: string; help?: boolean } {
  let input: string | undefined;
  let output = 'openapi.html';
  let positional = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!positional && (argument === '--help' || argument === '-h')) return { output, help: true };
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
  else {
    // npm changes cwd to the package directory; INIT_CWD retains the invocation directory.
    const cwd = process.env.npm_lifecycle_event === 'generate'
      ? process.env.INIT_CWD || process.cwd() : process.cwd();
    const output = await generate(contractEntry(cwd, args.input!), resolve(cwd, args.output));
    process.stdout.write(`已生成离线 HTML：${output}\n`);
  }
} catch (error) {
  process.stderr.write(`错误：${(error as Error).message}\n运行 npm run generate -- --help 查看用法。\n`);
  process.exitCode = 1;
}
