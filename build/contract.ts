import $RefParser from '@apidevtools/json-schema-ref-parser';
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ApiObject } from '../src/lib/openapi.ts';
import { pointerEscape } from '../src/lib/openapi.ts';
import type { DocumentationDocument, DocumentationModule } from '../src/lib/documentation.ts';

export interface Contract {
  document: ApiObject;
  files: string[];
  entry: string;
}
export interface Documentation {
  document: DocumentationDocument;
  files: string[];
  entry: string;
  directories: string[];
}
export class DocumentationLoadError extends Error {
  files: string[];
  directories: string[];
  constructor(message: string, files: string[], directories: string[], options?: ErrorOptions) {
    super(message, options);
    this.files = files;
    this.directories = directories;
  }
}
export const moduleEntryNames = new Set(['openapi.yaml', 'openapi.yml', 'openapi.json']);
export const ignoredDirectories = new Set(['node_modules', 'dist', 'build', 'coverage']);
const maps = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'schemas',
  'examples',
  'headers',
  'links',
  'paths',
  'responses',
  'callbacks',
  'securitySchemes',
  'requestBodies',
  'parameters',
  'dependentSchemas',
]);
// $ref inside literal data must remain data, including external-looking strings.
function literalPayload(path: string, value?: unknown) {
  const tokens = path.split('/');
  const key = tokens.at(-1)!;
  const parent = tokens.at(-2)!;
  if (maps.has(parent)) return false;
  return (
    key.startsWith('x-') ||
    key === 'example' ||
    key === 'default' ||
    key === 'const' ||
    (key === 'enum' && Array.isArray(value)) ||
    (key === 'examples' && Array.isArray(value)) ||
    (key === 'value' && tokens.at(-3) === 'examples')
  );
}
export function contractEntry(root: string, configured = process.env.OPENAPI_ENTRY): string {
  const entry = configured || 'examples/openapi.yaml';
  if (/^[a-z][a-z\d+.-]*:/i.test(entry) && !/^[a-z]:[\\/]/i.test(entry))
    throw new Error('OpenAPI 入口必须是本地 YAML / JSON 文件或模块目录路径。');
  return isAbsolute(entry) ? entry : resolve(root, entry);
}

function references(value: any, pointer = '#', result: string[] = []): string[] {
  if (!value || typeof value !== 'object') return result;
  if (typeof value.$ref === 'string') result.push(`${pointer}/$ref → ${value.$ref}`);
  for (const [key, child] of Object.entries(value))
    references(child, `${pointer}/${pointerEscape(key)}`, result);
  return result;
}

export async function loadContract(entry: string): Promise<Contract> {
  entry = contractEntry(process.cwd(), entry);
  const parser = new $RefParser();
  try {
    const document = (await parser.bundle(entry, {
      resolve: { http: false },
      parse: { binary: false, text: false },
      resolveExcludedPathMatcher: literalPayload,
      bundle: { excludedPathMatcher: literalPayload },
    })) as ApiObject;
    if (!/^3\.(0|1)\.\d+$/.test(document.openapi || ''))
      throw new Error(`仅支持 OpenAPI 3.0 / 3.1，当前版本：${document.openapi ?? '缺失'}`);
    if (
      !document.info?.title ||
      !document.paths ||
      typeof document.paths !== 'object' ||
      Array.isArray(document.paths)
    )
      throw new Error('契约必须包含 info.title 和 paths 对象。');
    return { document, files: parser.$refs.paths(), entry };
  } catch (cause) {
    const error = cause as Error & { source?: string; path?: string[]; targetToken?: string };
    const sources = parser.$refs.values();
    const locations = Object.entries(sources).flatMap(([file, value]) =>
      references(value).map((ref) => `${file} ${ref}`),
    );
    const relevant = locations.filter(
      (location) =>
        (error.targetToken && location.includes(error.targetToken)) ||
        (error.source && location.includes(error.source.split('/').at(-1)!)),
    );
    const context = (relevant.length ? relevant : locations).slice(0, 8);
    const files = new Set([entry, ...parser.$refs.paths()]);
    // Keep unresolved local targets watchable too, including references outside the entry directory.
    for (const [file, value] of Object.entries(sources)) {
      const visit = (node: any, pointer = '#') => {
        if (!node || typeof node !== 'object' || literalPayload(pointer, node)) return;
        if (typeof node.$ref === 'string') {
          const target = node.$ref.split('#')[0];
          if (target && !/^[a-z][a-z\d+.-]*:/i.test(target)) {
            try { files.add(resolve(dirname(file), decodeURIComponent(target))); } catch { /* Invalid path. */ }
          }
        }
        for (const [key, child] of Object.entries(node)) visit(child, `${pointer}/${pointerEscape(key)}`);
      };
      visit(value);
    }
    throw new DocumentationLoadError(
      [
        `OpenAPI 契约解析失败：${entry}`,
        error.message,
        error.source ? `来源文件：${error.source}` : '',
        error.path?.length ? `引用位置：#/${error.path.map(pointerEscape).join('/')}` : '',
        context.length ? `引用上下文：\n${context.join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      [...files], [...new Set([...files].map(dirname))], { cause },
    );
  }
}

export async function loadDocumentation(input: string): Promise<Documentation> {
  const entry = contractEntry(process.cwd(), input);
  const files = new Set<string>();
  const directories = new Set<string>([dirname(entry)]);
  try {
    if (!(await stat(entry)).isDirectory()) {
      const contract = await loadContract(entry);
      return { ...contract, directories: [...new Set(contract.files.map(dirname))] };
    }
    const entries: { id: string; entry: string }[] = [];
    const discover = async (directory: string) => {
      directories.add(directory);
      const children = await readdir(directory, { withFileTypes: true });
      const candidates = [];
      for (const child of children) {
        if (moduleEntryNames.has(child.name) && (child.isFile() ||
          (child.isSymbolicLink() && (await stat(join(directory, child.name))).isFile()))) candidates.push(child);
      }
      candidates.forEach((child) => files.add(join(directory, child.name)));
      if (candidates.length > 1)
        throw new Error(`模块目录存在多个 OpenAPI 入口：${directory}\n${candidates.map((child) => child.name).sort().join('、')}`);
      if (candidates.length) entries.push({
        id: relative(entry, directory).split(sep).join('/') || '.',
        entry: join(directory, candidates[0].name),
      });
      for (const child of children) {
        // Dirent.isDirectory excludes directory symlinks, so traversal cannot leave the tree or loop.
        if (child.isDirectory() && !child.name.startsWith('.') && !ignoredDirectories.has(child.name))
          await discover(join(directory, child.name));
      }
    };
    await discover(entry);
    if (!entries.length) throw new Error(`模块目录中未找到 openapi.yaml、openapi.yml 或 openapi.json：${entry}`);
    entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const modules: DocumentationModule[] = [];
    for (const module of entries) {
      try {
        const contract = await loadContract(module.entry);
        contract.files.forEach((file) => { files.add(file); directories.add(dirname(file)); });
        modules.push({ id: module.id, document: contract.document });
      } catch (cause) {
        if (cause instanceof DocumentationLoadError) {
          cause.files.forEach((file) => files.add(file));
          cause.directories.forEach((directory) => directories.add(directory));
        }
        throw new Error(`模块「${module.id}」解析失败\n${(cause as Error).message}`, { cause });
      }
    }
    return { document: { kind: 'specleaf/modules', title: basename(entry), modules }, files: [...files], entry, directories: [...directories] };
  } catch (cause) {
    if (cause instanceof DocumentationLoadError) throw cause;
    throw new DocumentationLoadError(`OpenAPI 文档加载失败：${entry}\n${(cause as Error).message}`, [...files, entry], [...directories], { cause });
  }
}
