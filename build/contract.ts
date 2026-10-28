import $RefParser from '@apidevtools/json-schema-ref-parser';
import { isAbsolute, resolve } from 'node:path';
import type { ApiObject } from '../src/lib/openapi.ts';
import { pointerEscape } from '../src/lib/openapi.ts';

export interface Contract {
  document: ApiObject;
  files: string[];
  entry: string;
}
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
    throw new Error('OpenAPI 入口必须是本地 YAML / JSON 文件路径。');
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
    throw new Error(
      [
        `OpenAPI 契约解析失败：${entry}`,
        error.message,
        error.source ? `来源文件：${error.source}` : '',
        error.path?.length ? `引用位置：#/${error.path.map(pointerEscape).join('/')}` : '',
        context.length ? `引用上下文：\n${context.join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      { cause },
    );
  }
}
