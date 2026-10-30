// OpenAPI and JSON Schema both allow extension vocabularies.
export type ApiObject = Record<string, any>;
export const METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'trace',
] as const;
export type Method = (typeof METHODS)[number];
export const API_STATUS_LABELS = {
  draft: '草稿',
  developing: '开发中',
  testing: '测试中',
  released: '已发布',
  deprecated: '已弃用',
} as const;
export type ApiStatus = keyof typeof API_STATUS_LABELS;

export interface Operation {
  id: string;
  method: Method;
  path: string;
  tags: string[];
  definition: ApiObject;
  parameters: ApiObject[];
  servers: ApiObject[];
}
export const object = (value: unknown): ApiObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
export const pointerEscape = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1');

export function getApiStatus(definition: ApiObject): ApiStatus | undefined {
  if (definition.deprecated === true) return 'deprecated';
  const status: unknown = definition['x-api-status'];
  return typeof status === 'string' && own(API_STATUS_LABELS, status)
    ? (status as ApiStatus)
    : undefined;
}

export function resolvePointer(document: ApiObject, reference: string): any {
  if (!reference.startsWith('#')) throw new Error(`仅支持已合并的内部引用：${reference}`);
  const pointer = decodeURIComponent(reference.slice(1));
  if (pointer === '') return document;
  if (!pointer.startsWith('/')) throw new Error(`无效 JSON Pointer：${reference}`);
  let current: any = document;
  for (const token of pointer.slice(1).split('/')) {
    if (/~(?:[^01]|$)/.test(token)) throw new Error(`无效 JSON Pointer 转义：${reference}`);
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === null || typeof current !== 'object' || !own(current, key))
      throw new Error(`引用不存在：${reference}（${key}）`);
    current = current[key];
  }
  return current;
}

export function resolveObject(
  document: ApiObject,
  value: any,
  visited = new Set<string>(),
): ApiObject {
  const node = object(value);
  if (typeof node.$ref !== 'string' || visited.has(node.$ref)) return node;
  const next = new Set(visited).add(node.$ref);
  const { $ref, ...siblings } = node;
  return { ...resolveObject(document, resolvePointer(document, $ref), next), ...siblings };
}

// Schema siblings constrain the referenced schema together in OpenAPI 3.1.
// Keep both branches rather than overwriting properties or required arrays.
export function resolveSchema(document: ApiObject, raw: any, visited = new Set<string>()): any {
  if (typeof raw === 'boolean') return raw;
  const node = object(raw);
  if (typeof node.$ref !== 'string' || visited.has(node.$ref)) return node;
  const next = new Set(visited).add(node.$ref);
  const { $ref, ...siblings } = node;
  const target = resolveSchema(document, resolvePointer(document, $ref), next);
  const annotations = new Set([
    'title',
    'summary',
    'description',
    'example',
    'examples',
    'deprecated',
    'readOnly',
    'writeOnly',
  ]);
  const hasConstraints = Object.keys(siblings).some(
    (key) => !annotations.has(key) && !key.startsWith('x-'),
  );
  if (hasConstraints)
    return {
      ...Object.fromEntries(Object.entries(siblings).filter(([key]) => annotations.has(key))),
      allOf: [target, siblings],
    };
  if (typeof target === 'boolean') return target;
  return { ...target, ...siblings };
}

export function collectOperations(document: ApiObject): Operation[] {
  const result: Operation[] = [];
  for (const [path, raw] of Object.entries(object(document.paths))) {
    const item = resolveObject(document, raw);
    for (const method of METHODS) {
      if (!item[method]) continue;
      const definition = resolveObject(document, item[method]);
      const parameters = new Map<string, ApiObject>();
      for (const rawParameter of [...(item.parameters || []), ...(definition.parameters || [])]) {
        const parameter = resolveObject(document, rawParameter);
        parameters.set(`${parameter.in}:${parameter.name}`, parameter);
      }
      result.push({
        id: `${method}:${path}`,
        method,
        path,
        definition,
        tags: definition.tags?.length ? definition.tags : ['未分组'],
        parameters: [...parameters.values()],
        servers: definition.servers ?? item.servers ?? document.servers ?? [],
      });
    }
  }
  return result;
}

export function collectTags(document: ApiObject, operations: Operation[]): string[] {
  return [
    ...new Set([
      ...(document.tags || []).map((tag: ApiObject) => tag.name),
      ...operations.flatMap((operation) => operation.tags),
    ]),
  ];
}
export const operationHash = (operation: Operation, moduleId?: string) =>
  `${moduleId === undefined ? '#' : `#/module/${encodeURIComponent(moduleId)}`}/operation/${encodeURIComponent(operation.id)}`;
export function operationIdFromHash(hash: string): string | undefined {
  try {
    return hash.startsWith('#/operation/') ? decodeURIComponent(hash.slice(12)) : undefined;
  } catch {
    return undefined;
  }
}
export function matchesOperation(operation: Operation, query: string, method: string, context = '') {
  const text = [
    operation.path,
    operation.method,
    operation.definition.summary,
    operation.definition.description,
    operation.definition.operationId,
    ...operation.tags,
    context,
  ]
    .join(' ')
    .toLocaleLowerCase();
  return (
    (!method || operation.method === method) &&
    query
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .every((token) => text.includes(token))
  );
}

export function schemaType(document: ApiObject, raw: any, seen = new Set<string>()): string {
  if (raw === true) return '任意类型';
  if (raw === false) return '禁止任何值';
  const node = object(raw);
  if (node.$ref && seen.has(node.$ref)) return '递归引用';
  const next = new Set(seen);
  if (node.$ref) next.add(node.$ref);
  const schema = resolveSchema(document, node);
  if (typeof schema === 'boolean') return schema ? '任意类型' : '禁止任何值';
  let type: string;
  if (Array.isArray(schema.type)) type = schema.type.join(' | ');
  else if (schema.type === 'array' || schema.items || schema.prefixItems)
    type = `array<${schemaType(document, schema.items ?? true, next)}>`;
  else if (schema.type) type = schema.type;
  else if (schema.allOf) type = 'allOf · 全部满足';
  else if (schema.oneOf) type = 'oneOf · 恰好一个';
  else if (schema.anyOf) type = 'anyOf · 至少一个';
  else if (schema.properties || own(schema, 'additionalProperties')) type = 'object';
  else if (own(schema, 'const')) type = schema.const === null ? 'null' : typeof schema.const;
  else type = '任意类型';
  return schema.nullable && !type.includes('null') ? `${type} | null` : type;
}

export interface SchemaEdge {
  name: string;
  schema: any;
  required: boolean;
}
export function schemaEdges(document: ApiObject, raw: any): SchemaEdge[] {
  const schema = object(resolveSchema(document, raw));
  const edges: SchemaEdge[] = Object.entries(object(schema.properties)).map(([name, value]) => ({
    name,
    schema: value,
    required: (schema.required || []).includes(name),
  }));
  if (own(schema, 'items'))
    edges.push({ name: '[] 数组元素', schema: schema.items, required: false });
  (schema.prefixItems || []).forEach((value: any, index: number) =>
    edges.push({ name: `[${index}] 元组元素`, schema: value, required: false }),
  );
  for (const composition of ['allOf', 'oneOf', 'anyOf']) {
    (schema[composition] || []).forEach((value: any, index: number) =>
      edges.push({ name: `${composition} · 分支 ${index + 1}`, schema: value, required: false }),
    );
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object')
    edges.push({ name: '[key] 额外属性', schema: schema.additionalProperties, required: false });
  for (const keyword of ['not', 'contains', 'if', 'then', 'else']) {
    if (own(schema, keyword))
      edges.push({ name: keyword, schema: schema[keyword], required: false });
  }
  return edges;
}

const CONSTRAINTS: Record<string, string> = {
  format: '格式',
  enum: '枚举',
  const: '固定值',
  default: '默认值',
  minimum: '最小值',
  maximum: '最大值',
  exclusiveMinimum: '排除下界',
  exclusiveMaximum: '排除上界',
  multipleOf: '倍数',
  minLength: '最短长度',
  maxLength: '最长长度',
  pattern: '正则',
  minItems: '最少元素',
  maxItems: '最多元素',
  uniqueItems: '元素唯一',
  minProperties: '最少属性',
  maxProperties: '最多属性',
  additionalProperties: '额外属性',
  readOnly: '只读',
  writeOnly: '只写',
  deprecated: '已弃用',
  nullable: '允许空值',
  discriminator: '判别字段',
  contentEncoding: '内容编码',
  contentMediaType: '内容格式',
  minContains: '最少匹配',
  maxContains: '最多匹配',
  dependentRequired: '依赖必填',
  unevaluatedProperties: '未评估属性',
};
export function schemaConstraints(document: ApiObject, raw: any): [string, any][] {
  const schema = object(resolveSchema(document, raw));
  return Object.entries(CONSTRAINTS)
    .filter(
      ([key]) =>
        own(schema, key) && !(key === 'additionalProperties' && typeof schema[key] === 'object'),
    )
    .map(([key, label]) => [`${label} · ${key}`, schema[key]]);
}


// Keep common constraints readable; exact schema keywords remain available in details.
export function schemaConstraintSummary(document: ApiObject, raw: any): [string, any][] {
  const schema = object(resolveSchema(document, raw));
  const summary: [string, any][] = [];
  const compact = new Set([
    'format', 'enum', 'const', 'default', 'minimum', 'maximum',
    'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    'readOnly', 'writeOnly', 'deprecated', 'nullable',
  ]);
  for (const [key, label] of Object.entries(CONSTRAINTS)) {
    if (!compact.has(key) || !own(schema, key)) continue;
    const value = schema[key];
    if (['readOnly', 'writeOnly', 'deprecated', 'nullable'].includes(key) && value === false)
      continue;
    summary.push([label, value]);
  }
  for (const [min, max, label, unit] of [
    ['minLength', 'maxLength', '长度', '字符'],
    ['minItems', 'maxItems', '数量', '项'],
    ['minProperties', 'maxProperties', '属性数量', '个'],
  ]) {
    if (!own(schema, min) && !own(schema, max)) continue;
    const lower = schema[min];
    const upper = schema[max];
    const value = lower === upper ? `${lower} ${unit}`
      : lower === undefined ? `最多 ${upper} ${unit}`
      : upper === undefined ? `至少 ${lower} ${unit}`
      : `${lower}–${upper} ${unit}`;
    summary.push([label, value]);
  }
  return summary;
}

export interface Example {
  name: string;
  value?: any;
  externalValue?: string;
  description?: string;
}
export function mediaExamples(document: ApiObject, media: ApiObject): Example[] {
  const examples: Example[] = Object.entries(object(media.examples)).map(([name, raw]) => {
    const example = resolveObject(document, raw);
    return { ...example, name: example.summary ? `${name} · ${example.summary}` : name };
  });
  if (own(media, 'example')) examples.unshift({ name: '默认示例', value: media.example });
  if (examples.length) return examples;
  const schema = resolveObject(document, media.schema);
  if (own(schema, 'example')) return [{ name: '模型示例', value: schema.example }];
  if (Array.isArray(schema.examples))
    return schema.examples.map((value: any, index: number) => ({
      name: `模型示例 ${index + 1}`,
      value,
    }));
  return [];
}
export function formatValue(value: any, mediaType = 'application/json'): string {
  if (typeof value === 'string' && !/(?:\+|\/)json\b/.test(mediaType)) return value;
  return JSON.stringify(value, null, 2) ?? '';
}
export const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

export function makeCurl(
  document: ApiObject,
  operation: Operation,
  mediaType?: string,
  example?: Example,
): string {
  const server = operation.servers[0];
  let base = server?.url || '/';
  base = base.replace(/\{([^}]+)\}/g, (match: string, name: string) =>
    String(server?.variables?.[name]?.default ?? match),
  );
  let path = operation.path;
  const query = new URLSearchParams();
  const headers: string[] = [];
  const cookies: string[] = [];
  for (const parameter of operation.parameters) {
    const schema = resolveObject(document, parameter.schema);
    const rawValue = own(parameter, 'example')
      ? parameter.example
      : own(schema, 'example')
        ? schema.example
        : own(schema, 'default')
          ? schema.default
          : `{${parameter.name}}`;
    const value = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);
    if (parameter.in === 'path') path = path.replaceAll(`{${parameter.name}}`, value);
    if (parameter.in === 'query') query.set(parameter.name, value);
    if (parameter.in === 'header') headers.push(`${parameter.name}: ${value}`);
    if (parameter.in === 'cookie') cookies.push(`${parameter.name}=${value}`);
  }
  let url = base.replace(/\/$/, '') + path;
  if (query.size) url += (url.includes('?') ? '&' : '?') + query.toString();
  const lines = [`curl --request ${operation.method.toUpperCase()} ${shellQuote(url)}`];
  const security = operation.definition.security ?? document.security ?? [];
  // Requirements are OR alternatives. Use only the first one in the template.
  for (const name of Object.keys(security[0] || {})) {
    const scheme = resolveObject(document, document.components?.securitySchemes?.[name]);
    if (
      (scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'bearer') ||
      ['oauth2', 'openIdConnect'].includes(scheme.type)
    )
      headers.push('Authorization: Bearer {token}');
    if (scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'basic')
      headers.push('Authorization: Basic {credentials}');
    if (scheme.type === 'apiKey' && scheme.in === 'header')
      headers.push(`${scheme.name}: {${name}}`);
    if (scheme.type === 'apiKey' && scheme.in === 'cookie')
      cookies.push(`${scheme.name}={${name}}`);
    if (scheme.type === 'apiKey' && scheme.in === 'query' && !query.has(scheme.name)) {
      lines[0] = lines[0].replace(
        shellQuote(url),
        shellQuote(
          url + (url.includes('?') ? '&' : '?') + encodeURIComponent(scheme.name) + `={${name}}`,
        ),
      );
      url += (url.includes('?') ? '&' : '?') + encodeURIComponent(scheme.name) + `={${name}}`;
    }
  }
  // cURL supplies the multipart boundary when --form is used.
  if (mediaType && !mediaType.includes('multipart/form-data'))
    headers.push(`Content-Type: ${mediaType}`);
  if (cookies.length) headers.push(`Cookie: ${cookies.join('; ')}`);
  for (const header of [...new Set(headers)]) lines.push(`  --header ${shellQuote(header)}`);
  if (example && own(example, 'value')) {
    if (
      mediaType?.includes('multipart/form-data') &&
      example.value &&
      typeof example.value === 'object'
    ) {
      for (const [key, value] of Object.entries(example.value))
        lines.push(
          `  --form ${shellQuote(`${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)}`,
        );
    } else if (
      mediaType?.includes('application/x-www-form-urlencoded') &&
      example.value &&
      typeof example.value === 'object'
    ) {
      for (const [key, value] of Object.entries(example.value))
        lines.push(
          `  --data-urlencode ${shellQuote(`${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)}`,
        );
    } else lines.push(`  --data-raw ${shellQuote(formatValue(example.value, mediaType))}`);
  }
  return lines.join(' \\\n');
}
