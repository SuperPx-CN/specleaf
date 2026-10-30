import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDocumentation, type Documentation } from './contract.ts';
import { documentationTitle, isModuleCollection } from '../src/lib/documentation.ts';
import { serializeContract } from './serialize.ts';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

export async function renderHtml(contract: Pick<Documentation, 'document'>): Promise<string> {
  const assets = new URL('../lib/assets/', import.meta.url);
  const [javascript, stylesheet, favicon] = await Promise.all(
    ['ui.js', 'ui.css', 'favicon.svg'].map((file) => readFile(new URL(file, assets), 'utf8')),
  );
  const script = javascript.replace(/<\/script/gi, '<\\/script');
  const css = stylesheet.replace(/<\/style/gi, '\\3c /style');
  const title = escapeHtml(documentationTitle(contract.document));
  const description = escapeHtml(isModuleCollection(contract.document) ? contract.document.title
    : contract.document.info.description || contract.document.info.title);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#7357e8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="description" content="${description}">
<title>${title} · API 文档</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(favicon)}">
<style>${css}</style>
</head>
<body><div id="root"></div><script id="specleaf-contract" type="application/json">${serializeContract(contract.document)}</script><script>${script}</script></body>
</html>\n`;
}

// Resolve existing ancestors as well as symlink targets when the output does not exist yet.
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonical(parent), basename(path));
  }
}

async function protectSources(output: string, sources: string[]) {
  const target = await canonical(output);
  const targetStat = await stat(output).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  for (const source of sources) {
    const sourceStat = await stat(source);
    if (target === await canonical(source) ||
      (targetStat && targetStat.dev === sourceStat.dev && targetStat.ino === sourceStat.ino))
      throw new Error(`禁止输出覆盖入口或引用文件：${output}\n来源文件：${source}`);
  }
}

export async function generate(input: string, destination: string): Promise<string> {
  const contract = await loadDocumentation(input);
  const output = resolve(destination);
  let temporary: string | undefined;
  try {
    await protectSources(output, contract.files);
    const html = await renderHtml(contract);
    await mkdir(dirname(output), { recursive: true });
    temporary = join(dirname(output), `.${basename(output)}.${randomUUID()}.tmp`);
    await writeFile(temporary, html, { encoding: 'utf8', flag: 'wx' });
    // Recheck after rendering and replace only once the full document has been written.
    await protectSources(output, contract.files);
    await rename(temporary, output);
    return output;
  } catch (cause) {
    throw new Error(`HTML 生成或写入失败：${output}\n${(cause as Error).message}`, { cause });
  } finally {
    if (temporary) await rm(temporary, { force: true });
  }
}
