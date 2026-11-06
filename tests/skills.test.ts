import { execFile } from 'node:child_process';
import { access, link, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { projectRoot } from '../build/generate';
import { installSkill, parseSkillArguments } from '../build/skills';

const exec = promisify(execFile);
const directories: string[] = [];
const cli = resolve(projectRoot, 'build/cli.ts');
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'specleaf skill 中文 空格-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('skill 安装参数', () => {
  it('默认选择全部工具，支持逗号、重复参数、去重和用户级安装', () => {
    expect(parseSkillArguments([])).toEqual({ agents: ['codex', 'claude', 'opencode'], global: false, force: false });
    expect(parseSkillArguments(['--agent', 'opencode,codex', '--agent=claude', '--agent', 'codex', '-g', '--force']))
      .toEqual({ agents: ['opencode', 'codex', 'claude'], global: true, force: true });
    expect(parseSkillArguments(['--agent', 'all']).agents).toEqual(['codex', 'claude', 'opencode']);
    expect(parseSkillArguments(['--help']).help).toBe(true);
  });

  it.each([['--agent'], ['--agent='], ['--agent', '--global'], ['--agent', 'unknown'], ['--agent', 'codex,'], ['--unknown'], ['extra']])
    ('拒绝无效参数 %j', (...args) => {
      expect(() => parseSkillArguments(args)).toThrow();
    });
});

describe('skill 安装文件', () => {
  it('默认在项目安装两份完整 skill，Codex 与 OpenCode 共享一份，并记录 CLI 版本', async () => {
    const directory = await fixture();
    const results = await installSkill(parseSkillArguments([]), { cwd: directory });
    expect(results).toEqual([
      { agents: ['codex', 'opencode'], directory: join(directory, '.agents/skills/specleaf'), status: 'installed' },
      { agents: ['claude'], directory: join(directory, '.claude/skills/specleaf'), status: 'installed' },
    ]);
    const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
    for (const result of results) {
      for (const name of ['SKILL.md', 'agents/openai.yaml'])
        expect(await readFile(join(result.directory, name), 'utf8'))
          .toBe(await readFile(join(projectRoot, 'skills/specleaf', name), 'utf8'));
      expect(JSON.parse(await readFile(join(result.directory, 'specleaf.json'), 'utf8'))).toEqual({ version: manifest.version });
    }
    expect((await readdir(directory)).sort()).toEqual(['.agents', '.claude']);
  });

  it.each(['codex', 'claude', 'opencode'])('可以只为 %s 安装，不创建其他工具目录', async (agent) => {
    const directory = await fixture();
    const results = await installSkill(parseSkillArguments(['--agent', agent]), { cwd: directory });
    expect(results).toHaveLength(1);
    expect(results[0].agents).toEqual([agent]);
    expect(await readdir(directory)).toEqual([agent === 'claude' ? '.claude' : '.agents']);
  });

  it('--global 使用用户目录，保持项目目录不变', async () => {
    const directory = await fixture();
    const userDirectory = await fixture();
    const results = await installSkill(parseSkillArguments(['--global']), { cwd: directory, homeDirectory: userDirectory });
    expect(results.map((result) => result.directory)).toEqual([
      join(userDirectory, '.agents/skills/specleaf'), join(userDirectory, '.claude/skills/specleaf'),
    ]);
    expect(await readdir(directory)).toEqual([]);
    for (const result of results) await expect(access(join(result.directory, 'SKILL.md'))).resolves.toBeUndefined();
  });

  it('重复安装跳过相同内容，不重写文件且保留额外文件', async () => {
    const directory = await fixture();
    const options = parseSkillArguments([]);
    const first = await installSkill(options, { cwd: directory });
    const path = join(first[0].directory, 'SKILL.md');
    const before = await stat(path);
    await writeFile(join(first[0].directory, 'notes.md'), '用户备注');
    const repeated = await installSkill(options, { cwd: directory });
    expect(repeated.map((result) => result.status)).toEqual(['unchanged', 'unchanged']);
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
    expect(await readFile(join(first[0].directory, 'notes.md'), 'utf8')).toBe('用户备注');
  });

  it('先检查所有目标的冲突，--force 更新内容并保留用户额外文件', async () => {
    const directory = await fixture();
    const [existing] = await installSkill(parseSkillArguments(['--agent', 'claude']), { cwd: directory });
    const skill = join(existing.directory, 'SKILL.md');
    await writeFile(skill, '用户修改');
    await writeFile(join(existing.directory, 'notes.md'), '保留');
    await expect(installSkill(parseSkillArguments([]), { cwd: directory })).rejects.toThrow('--force');
    expect(await readFile(skill, 'utf8')).toBe('用户修改');
    await expect(access(join(directory, '.agents'))).rejects.toMatchObject({ code: 'ENOENT' });
    const forced = await installSkill(parseSkillArguments(['--force']), { cwd: directory });
    expect(forced.map((result) => result.status)).toEqual(['installed', 'updated']);
    expect(await readFile(skill, 'utf8')).toBe(await readFile(join(projectRoot, 'skills/specleaf/SKILL.md'), 'utf8'));
    expect(await readFile(join(existing.directory, 'notes.md'), 'utf8')).toBe('保留');
    expect((await readdir(existing.directory)).some((file) => file.endsWith('.tmp'))).toBe(false);
  });

  it('拒绝安装路径中的符号链接，--force 也不写入链接目标', async () => {
    const directory = await fixture();
    const outside = await fixture();
    const parent = join(directory, '.agents/skills');
    await mkdir(parent, { recursive: true });
    await symlink(outside, join(parent, 'specleaf'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(installSkill(parseSkillArguments(['--force']), { cwd: directory })).rejects.toThrow('符号链接');
    expect(await readdir(outside)).toEqual([]);
    await expect(access(join(directory, '.claude'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('拒绝已有文件链接和非目录路径', async () => {
    const directory = await fixture();
    const target = join(directory, '.agents/skills/specleaf');
    const outside = join(directory, 'outside.md');
    await mkdir(target, { recursive: true });
    await writeFile(outside, '保留');
    await symlink(outside, join(target, 'SKILL.md'), 'file');
    await expect(installSkill(parseSkillArguments(['--agent', 'codex', '--force']), { cwd: directory })).rejects.toThrow('符号链接');
    expect(await readFile(outside, 'utf8')).toBe('保留');
    await writeFile(join(directory, '.claude'), '普通文件');
    await expect(installSkill(parseSkillArguments(['--agent', 'claude']), { cwd: directory })).rejects.toThrow('非目录');
  });

  it('--force 原子替换硬链接文件，保持链接另一端内容不变', async () => {
    const directory = await fixture();
    const target = join(directory, '.agents/skills/specleaf');
    const outside = join(directory, 'original.md');
    await mkdir(target, { recursive: true });
    await writeFile(outside, '链接原文件');
    await link(outside, join(target, 'SKILL.md'));
    await installSkill(parseSkillArguments(['--agent', 'codex', '--force']), { cwd: directory });
    expect(await readFile(outside, 'utf8')).toBe('链接原文件');
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toContain('name: specleaf');
  });
});

describe('skill 安装命令', () => {
  it('通过源码 CLI 安装到调用目录，帮助不写入文件，无效参数以非零退出', async () => {
    const directory = await fixture();
    const help = await exec(process.execPath, [cli, 'install', 'skill', '--help'], { cwd: directory });
    expect(help.stdout).toContain('--agent');
    expect(await readdir(directory)).toEqual([]);
    await expect(exec(process.execPath, [cli, 'install', 'skill', '--agent', 'unknown'], { cwd: directory }))
      .rejects.toMatchObject({ code: 1 });
    expect(await readdir(directory)).toEqual([]);
    const result = await exec(process.execPath, [cli, 'install', 'skill'], { cwd: directory });
    expect(result.stderr).toBe('');
    expect(await readFile(join(directory, '.agents/skills/specleaf/SKILL.md'), 'utf8')).toContain('name: specleaf');
    expect(await readFile(join(directory, '.claude/skills/specleaf/SKILL.md'), 'utf8')).toContain('name: specleaf');
  });

  it('源码 npm generate 调用使用 INIT_CWD，-- 仍可指定名为 install 的契约文件', async () => {
    const directory = await fixture();
    await exec(process.execPath, [cli, 'install', 'skill', '--agent', 'codex'], {
      cwd: projectRoot,
      env: { ...process.env, npm_lifecycle_event: 'generate', INIT_CWD: directory },
    });
    await expect(access(join(directory, '.agents/skills/specleaf/SKILL.md'))).resolves.toBeUndefined();
    await writeFile(join(directory, 'install'), JSON.stringify({ openapi: '3.1.0', info: { title: '命令同名契约', version: '1' }, paths: {} }));
    await exec(process.execPath, [cli, '--', 'install'], { cwd: directory });
    expect(await readFile(join(directory, 'openapi.html'), 'utf8')).toContain('命令同名契约');
  });
});
