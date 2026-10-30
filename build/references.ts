import { getJsonSchemaRefParserDefaultOptions, type Plugin } from '@apidevtools/json-schema-ref-parser';
import { pathToFileURL } from 'node:url';
import { pointerEscape } from '../src/lib/openapi.ts';

// Remember where each parsed object came from before bundle() moves it into the entry.
// A surviving ../openapi.yaml reference must be resolved against its original file.
export function rootReferenceTracker(entry: string, excluded: (path: string, value?: unknown) => boolean) {
  const root = pathToFileURL(entry);
  const origins = new WeakMap<object, URL>();
  function remember(value: any, source: URL, seen = new WeakSet<object>(), namedResource = false) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    // $id establishes a schema resource scope rather than a physical file scope.
    namedResource ||= typeof value.$id === 'string';
    if (!namedResource) origins.set(value, source);
    for (const child of Object.values(value)) remember(child, source, seen, namedResource);
  }
  const defaults = getJsonSchemaRefParserDefaultOptions().parse;
  const parsers = Object.fromEntries(['json', 'yaml'].map((name) => {
    const plugin = defaults[name] as Plugin;
    const parse = plugin.parse;
    return [name, {
      ...plugin,
      async parse(file) {
        const value = typeof parse === 'function' ? await parse.call(this, file) : parse;
        // The parser supplies URL-encoded paths, including drive paths on Windows.
        const source = new URL(file.url.replace(/^([a-z]):\//i, 'file:///$1:/'), root);
        remember(value, source);
        return value;
      },
    } satisfies Plugin];
  }));
  function internalize(document: unknown) {
    const seen = new WeakSet<object>();
    function visit(value: any, path = '#') {
      if (!value || typeof value !== 'object' || excluded(path, value) || seen.has(value)) return;
      seen.add(value);
      if (typeof value.$ref === 'string' && !value.$ref.startsWith('#')) {
        const source = origins.get(value);
        const target = source ? new URL(value.$ref, source) : undefined;
        if (target && target.href.split('#')[0] === root.href) value.$ref = target.hash || '#';
        // Never ship a structural reference the offline reader cannot resolve.
        if (!value.$ref.startsWith('#'))
          throw new Error(`契约合并后仍有外部引用：${path}/$ref → ${value.$ref}`);
      }
      for (const [key, child] of Object.entries(value)) visit(child, `${path}/${pointerEscape(key)}`);
    }
    visit(document);
  }
  return { parsers, internalize };
}
