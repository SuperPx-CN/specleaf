import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { projectRoot } from '../build/generate';
import { serializeContract } from '../build/serialize';

const exec = promisify(execFile);
const directories: string[] = [];
const base = { openapi: '3.1.0', info: { title: '通用测试', version: '1' }, paths: {} };
const cli = resolve(projectRoot, 'build/cli.ts');
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), '中文 空格 specleaf-'));
  directories.push(directory);
  await writeFile(join(directory, '契约 文件.json'), JSON.stringify(base));
  return directory;
}
async function run(cwd: string, ...args: string[]) {
  try {
    const result = await exec(process.execPath, [cli, ...args], { cwd, timeout: 30000 });
    return { code: 0, ...result };
  } catch (error) {
    return error as Error & { code: number; stdout: string; stderr: string };
  }
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('生成命令', () => {
  it('显示帮助，缺少输入、未知参数和多余输入以中文报错并退出', async () => {
    const directory = await fixture();
    const help = await run(directory, '--help');
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('用法：');
    expect(help.stdout).toContain('specleaf <input>');
    const { version } = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'));
    for (const option of ['--version', '-v']) {
      const result = await run(directory, option);
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe(version);
    }
    for (const args of [[], ['--unknown'], ['契约 文件.json', '-o'], ['契约 文件.json', 'extra.json']]) {
      const result = await run(directory, ...args);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('错误：');
    }
    expect(await readdir(directory)).toEqual(['契约 文件.json']);
  });

  it('JSON 默认输出相对调用目录，保留同目录文件且所有资源内嵌', async () => {
    const directory = await fixture();
    await writeFile(join(directory, 'keep.txt'), 'preserved');
    const result = await run(directory, '契约 文件.json');
    expect(result.code, result.stderr).toBe(0);
    const html = await readFile(join(directory, 'openapi.html'), 'utf8');
    expect(html).toContain('<title>通用测试 · API 文档</title>');
    expect(html).toContain('data:image/svg+xml,');
    expect(html).toContain('<style>');
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(JSON.parse(html.match(/<script id="specleaf-contract" type="application\/json">(.*?)<\/script>/s)![1])).toEqual(base);
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+(?:stylesheet|modulepreload)/i);
    expect(await readFile(join(directory, 'keep.txt'), 'utf8')).toBe('preserved');
    expect((await readdir(directory)).sort()).toEqual(['keep.txt', 'openapi.html', '契约 文件.json']);
  }, 30000);

  it('npm --prefix 从调用目录读取 YAML，合并跨文件循环引用并支持 -o 中文空格路径', async () => {
    const directory = await fixture();
    await writeFile(join(directory, '入口.yaml'), `openapi: 3.0.3\ninfo:\n  title: 跨文件示例\n  version: '1'\npaths: {}\ncomponents:\n  schemas:\n    Tree:\n      $ref: './模型 文件.json#/Tree'\n`);
    await writeFile(join(directory, '模型 文件.json'), JSON.stringify({ Tree: { type: 'object', properties: { child: { $ref: '#/Tree' } } } }));
    const env = { ...process.env };
    // Vitest can expose uppercase lifecycle keys on Windows. Remove the parent
    // event so it cannot shadow npm's new lowercase keys when spawning a child.
    for (const key of Object.keys(env)) if (/^npm_lifecycle_/i.test(key)) delete env[key];
    const result = await exec(process.execPath, [process.env.npm_execpath!, '--prefix', projectRoot, 'run', 'generate', '--', '入口.yaml', '-o', '输出 目录/文档.html'], { cwd: directory, env, timeout: 30000 }).catch((error) => {
      throw new Error(`${error.message}\n${error.stdout}`, { cause: error });
    });
    expect(result.stderr).toBe('');
    const html = await readFile(join(directory, '输出 目录/文档.html'), 'utf8');
    expect(html).toContain('跨文件示例');
    expect(html).not.toContain('./模型 文件.json');
    expect(html).toContain('#/components/schemas/Tree');
    expect(await readdir(join(directory, '输出 目录'))).toEqual(['文档.html']);
    const second = await run(directory, '契约 文件.json', '--output=other.html');
    expect(second.code, second.stderr).toBe(0);
  }, 30000);

  it('拒绝覆盖入口、引用文件及其符号链接和硬链接', async () => {
    const directory = await fixture();
    const entry = join(directory, '契约 文件.json');
    const models = join(directory, 'models.json');
    await writeFile(models, JSON.stringify({ Item: { type: 'string' } }));
    await writeFile(entry, JSON.stringify({ ...base, components: { schemas: { Item: { $ref: './models.json#/Item' } } } }));
    await symlink(models, join(directory, 'symbolic.html'));
    await link(models, join(directory, 'hard.html'));
    const original = await readFile(entry, 'utf8');
    for (const output of ['契约 文件.json', 'models.json', 'symbolic.html', 'hard.html']) {
      const result = await run(directory, entry, '-o', output);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('禁止输出覆盖入口或引用文件');
    }
    expect(await readFile(entry, 'utf8')).toBe(original);
    expect(JSON.parse(await readFile(models, 'utf8'))).toEqual({ Item: { type: 'string' } });
  });

  it('解析和写入失败保留原产物，远程入口及引用被拒绝且临时文件被清理', async () => {
    const directory = await fixture();
    const entry = join(directory, '契约 文件.json');
    const output = join(directory, 'existing.html');
    await writeFile(output, 'previous document');
    for (const reference of ['./missing.json#/X', 'https://example.invalid/remote.json#/X']) {
      await writeFile(entry, JSON.stringify({ ...base, components: { schemas: { X: { $ref: reference } } } }));
      const result = await run(directory, entry, '-o', output);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('OpenAPI 契约解析失败');
      expect(result.stderr).toContain(reference);
      expect(await readFile(output, 'utf8')).toBe('previous document');
    }
    const remote = await run(directory, 'https://example.invalid/api.yaml');
    expect(remote.code).not.toBe(0);
    expect(remote.stderr).toContain('入口必须是本地');
    await writeFile(entry, JSON.stringify(base));
    await mkdir(join(directory, 'blocked.html'));
    await writeFile(join(directory, 'blocked.html/keep.txt'), 'keep');
    const failed = await run(directory, entry, '-o', 'blocked.html');
    expect(failed.code).not.toBe(0);
    expect(failed.stderr).toContain('HTML 生成或写入失败');
    expect(await readFile(join(directory, 'blocked.html/keep.txt'), 'utf8')).toBe('keep');
    expect((await readdir(directory)).some((file) => file.endsWith('.tmp'))).toBe(false);
    const replaced = await run(directory, entry, '--output', output);
    expect(replaced.code, replaced.stderr).toBe(0);
    expect(await readFile(output, 'utf8')).toContain('<!doctype html>');
  }, 30000);

  it('安全序列化保留特殊描述、示例、Unicode 和 __proto__ 字面键', () => {
    const document = JSON.parse('{"__proto__":{"polluted":true}}');
    document.value = '</sCrIpT><script>attack()</script><!--<script> & > \u2028\u2029';
    const serialized = serializeContract(document);
    expect(serialized).not.toContain('<');
    const restored = JSON.parse(serialized);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(document));
    expect(Object.hasOwn(restored, '__proto__')).toBe(true);
  });

  it('HTML 数据块安全保存元数据和原始示例，界面脚本可跨契约复用', async () => {
    const directory = await fixture();
    const payload = '</sCrIpT><script>globalThis.INJECTED=true</script><!--<script> & > \u2028\u2029';
    const document = {
      ...base,
      info: { title: payload, version: '1', description: '" data-injected="true' },
      'x-literal': JSON.parse('{"__proto__":{"polluted":true}}'),
      paths: { '/safe': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { example: payload } } } } } } },
    };
    const entry = join(directory, '特殊.json');
    await writeFile(entry, JSON.stringify(document));
    expect((await run(directory, entry, '-o', 'special.html')).code).toBe(0);
    expect((await run(directory, '契约 文件.json')).code).toBe(0);
    const special = await readFile(join(directory, 'special.html'), 'utf8');
    const ordinary = await readFile(join(directory, 'openapi.html'), 'utf8');
    const data = special.match(/<script id="specleaf-contract" type="application\/json">(.*?)<\/script>/s)![1];
    expect(data).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(data)).toEqual(document);
    expect(special.match(/<\/script>/g)).toHaveLength(2);
    expect(special.match(/<script>(.*?)<\/script>/s)![1]).toBe(ordinary.match(/<script>(.*?)<\/script>/s)![1]);
    expect(special).toContain('&quot; data-injected=&quot;true');
  });
});
