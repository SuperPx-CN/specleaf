import { lstat, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFile } from './files.ts';

export const skillAgents = ['codex', 'claude', 'opencode'] as const;
export type SkillAgent = (typeof skillAgents)[number];
export interface SkillOptions {
  agents: SkillAgent[];
  global: boolean;
  force: boolean;
  help?: boolean;
}

export const skillHelp = `用法：specleaf install skill [选项]

安装随包提供的 specleaf skill，默认面向 Codex、Claude Code 和 OpenCode。
默认安装到调用目录；--global 安装到用户目录。安装过程无需联网。
Codex 与 OpenCode 共用 .agents/skills/specleaf，Claude Code 使用 .claude/skills/specleaf。

选项：
  --agent <名称>     选择 codex、claude、opencode 或 all；可重复或用逗号分隔
  -g, --global      安装到用户目录，供所有项目使用
  --force           替换内容不同的 skill 文件，保留其他文件
  -h, --help        显示帮助
`;

export function parseSkillArguments(args: string[]): SkillOptions {
  const options: SkillOptions = { agents: [], global: false, force: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { ...options, help: true };
    if (argument === '--global' || argument === '-g') options.global = true;
    else if (argument === '--force') options.force = true;
    else if (argument === '--agent' || argument.startsWith('--agent=')) {
      const value = argument === '--agent' ? args[++index] : argument.slice('--agent='.length);
      if (!value || value.startsWith('-')) throw new Error('--agent 缺少工具名称。');
      for (const name of value.split(',').map((name) => name.trim())) {
        if (name === 'all') options.agents.push(...skillAgents);
        else if (skillAgents.includes(name as SkillAgent)) options.agents.push(name as SkillAgent);
        else throw new Error(`未知工具：${name || '（空）'}。支持 codex、claude、opencode 或 all。`);
      }
    } else throw new Error(`未知 skill 安装参数：${argument}`);
  }
  options.agents = options.agents.length ? [...new Set(options.agents)] : [...skillAgents];
  return options;
}

// OpenCode supports the same .agents directory as Codex, so both share one copy.
const skillDirectories: Record<SkillAgent, string> = {
  codex: '.agents',
  claude: '.claude',
  opencode: '.agents',
};

export interface SkillInstallation {
  agents: SkillAgent[];
  directory: string;
  status: 'installed' | 'updated' | 'unchanged';
}

const statIfPresent = (path: string) => lstat(path).catch((error: NodeJS.ErrnoException) => {
  if (error.code !== 'ENOENT') throw error;
  return undefined;
});

async function readSkillFiles(directory: string, prefix = ''): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) {
      for (const [name, content] of await readSkillFiles(directory, path)) files.set(name, content);
    } else if (entry.isFile()) files.set(path, await readFile(join(directory, path)));
    else throw new Error(`skill 资源必须为普通文件或目录：${join(directory, path)}`);
  }
  return files;
}

async function checkDirectories(base: string, relative: string, checked: Set<string>) {
  let path = base;
  for (const part of relative.split(sep)) {
    if (!part || part === '.') continue;
    path = join(path, part);
    if (checked.has(path)) continue;
    const existing = await statIfPresent(path);
    if (existing && !existing.isDirectory())
      throw new Error(`skill 安装目录不能是符号链接或非目录：${path}`);
    checked.add(path);
  }
}

export async function installSkill(
  options: SkillOptions,
  context: { cwd: string; homeDirectory?: string },
): Promise<SkillInstallation[]> {
  const source = fileURLToPath(new URL('../skills/specleaf/', import.meta.url));
  const files = await readSkillFiles(source);
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  // Preserve the CLI version even when installation used a transient npx package.
  files.set('specleaf.json', Buffer.from(`${JSON.stringify({ version }, null, 2)}\n`));

  const base = resolve(options.global ? context.homeDirectory ?? homedir() : context.cwd);
  const targets = new Map<string, SkillAgent[]>();
  for (const agent of options.agents) {
    const relative = join(skillDirectories[agent], 'skills', 'specleaf');
    targets.set(relative, [...(targets.get(relative) ?? []), agent]);
  }

  // Check every destination before writing any files, including shared installations.
  const checkedDirectories = new Set<string>();
  const plans: { result: SkillInstallation; changes: { path: string; content: Buffer }[] }[] = [];
  for (const [relative, agents] of targets) {
    await checkDirectories(base, relative, checkedDirectories);
    const directory = join(base, relative);
    const changes = [];
    let hasFiles = false;
    for (const [name, content] of files) {
      await checkDirectories(base, join(relative, dirname(name)), checkedDirectories);
      const path = join(directory, name);
      const existing = await statIfPresent(path);
      if (existing) {
        if (!existing.isFile())
          throw new Error(`skill 文件不能是符号链接或非普通文件：${path}`);
        hasFiles = true;
        if ((await readFile(path)).equals(content)) continue;
        if (!options.force)
          throw new Error(`已有 skill 文件内容不同：${path}\n使用 --force 替换 skill 文件；其他文件会保留。`);
      }
      changes.push({ path, content });
    }
    plans.push({
      result: { agents, directory, status: changes.length ? hasFiles ? 'updated' : 'installed' : 'unchanged' },
      changes,
    });
  }

  for (const { changes } of plans) {
    for (const { path, content } of changes) {
      await atomicWriteFile(path, content);
    }
  }
  return plans.map(({ result }) => result);
}
