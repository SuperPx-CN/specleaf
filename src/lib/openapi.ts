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

const DISPLAY_INPUT = Symbol('display schema input');
const DISPLAY_SCHEMA = Symbol('display schema');

export interface DisplaySchema {
  schema: any;
  forbidden: boolean;
  references: string[];
  recursiveReferences: string[];
  notices: string[];
  combinationConstraints: any[];
  alternatives: { keyword: string; branches: any[] }[];
}

// Carry each branch's own reference path into its children. A shared model used
// by two independent branches is not a cycle. These wrappers never enter exports.
function displayInput(raw: any, ancestors: Set<string>): any {
  return { [DISPLAY_INPUT]: { raw, ancestors } };
}

const schemaIdentity = (value: any): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
      : item,
  );

/** Resolve and intersect only the current display row; children remain lazy. */
export function displaySchema(document: ApiObject, raw: any): DisplaySchema {
  if (raw?.[DISPLAY_SCHEMA]) return raw[DISPLAY_SCHEMA];
  const parts: { schema: any; ancestors: Set<string> }[] = [];
  const references = new Set<string>();
  const recursiveReferences = new Set<string>();
  const notices = new Set<string>();
  const flatten = (value: any, ancestors: Set<string>, depth: number) => {
    if (value?.[DISPLAY_INPUT]) {
      const input = value[DISPLAY_INPUT];
      flatten(input.raw, input.ancestors, depth);
      return;
    }
    if (depth >= 32) {
      notices.add('组合结构已达到展示深度上限，完整规则请查看组合约束。');
      parts.push({ schema: value, ancestors });
      return;
    }
    if (typeof value === 'boolean') {
      parts.push({ schema: value, ancestors });
      return;
    }
    const { $ref, allOf, ...local } = object(value);
    let path = ancestors;
    if (typeof $ref === 'string') {
      references.add($ref);
      if (ancestors.has($ref)) recursiveReferences.add($ref);
      else {
        path = new Set(ancestors).add($ref);
        flatten(resolvePointer(document, $ref), path, depth + 1);
      }
    }
    if (Object.keys(local).length) parts.push({ schema: local, ancestors: path });
    if (Array.isArray(allOf)) {
      for (const branch of allOf) flatten(branch, path, depth + 1);
    }
  };
  flatten(raw, new Set(), 0);

  const schema: ApiObject = {};
  const alternatives: DisplaySchema['alternatives'] = [];
  const values = new Map<string, any[]>();
  const children = new Map<string, any[]>();
  const properties = new Map<string, any[]>();
  const required = new Set<string>();
  let hasProperties = false;
  let hasPrefixItems = false;
  let forbidden = false;
  for (const part of parts) {
    if (part.schema === false) forbidden = true;
    for (const [key, value] of Object.entries(object(part.schema))) {
      if (key === 'properties') {
        hasProperties = true;
        for (const [name, child] of Object.entries(object(value))) {
          properties.set(name, [...(properties.get(name) || []), displayInput(child, part.ancestors)]);
        }
      } else if (key === 'required') {
        for (const name of value as string[]) required.add(name);
      } else if (['items', 'additionalProperties', 'not', 'contains', 'if', 'then', 'else'].includes(key)) {
        children.set(key, [...(children.get(key) || []), displayInput(value, part.ancestors)]);
        values.set(key, [...(values.get(key) || []), value]);
      } else if (key === 'oneOf' || key === 'anyOf') {
        alternatives.push({
          keyword: key,
          branches: (value as any[]).map((branch) => displayInput(branch, part.ancestors)),
        });
      } else if (key === 'prefixItems') {
        hasPrefixItems = true;
        (value as any[]).forEach((child, index) => {
          const name = `prefixItems:${index}`;
          children.set(name, [...(children.get(name) || []), displayInput(child, part.ancestors)]);
        });
      } else {
        values.set(key, [...(values.get(key) || []), value]);
      }
    }
  }
  const intersect = (inputs: any[]) => inputs.length === 1 ? inputs[0] : { allOf: inputs };
  if (hasProperties)
    schema.properties = Object.fromEntries(
      [...properties].map(([name, inputs]) => [name, intersect(inputs)]),
    );
  if (required.size) schema.required = [...required];

  // These keywords evaluate the schema in which they were written. Moving them
  // across allOf boundaries (especially closed objects) changes their meaning.
  const scoped = new Set([
    'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems',
    'patternProperties', 'dependentSchemas', 'if', 'then', 'else', 'contains', 'minContains', 'maxContains',
  ]);
  const annotations = new Set([
    'title', 'summary', 'description', 'example', 'examples', '$id', '$schema', '$anchor', '$comment',
  ]);
  const lower = new Set(['minimum', 'exclusiveMinimum', 'minLength', 'minItems', 'minProperties', 'minContains']);
  const upper = new Set(['maximum', 'exclusiveMaximum', 'maxLength', 'maxItems', 'maxProperties', 'maxContains']);
  const additionalScopesSafe = !parts.some((part) => own(object(part.schema), 'patternProperties')) &&
    parts.filter((part) => own(object(part.schema), 'additionalProperties')).every((part) =>
      [...properties.keys()].every((name) => own(object(part.schema.properties), name)),
    );
  const booleanBounds = parts.length > 1 && ['exclusiveMinimum', 'exclusiveMaximum']
    .some((key) => (values.get(key) || []).some((value) => typeof value === 'boolean'));
  const tupleItems = parts.length > 1 && children.has('items') && hasPrefixItems;
  for (const [key, entries] of values) {
    const distinct = [...new Map(entries.map((value) => [schemaIdentity(value), value])).values()];
    if (
      (scoped.has(key) && parts.length > 1 && !(key === 'additionalProperties' && additionalScopesSafe)) ||
      (tupleItems && key === 'items') ||
      (booleanBounds && ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'].includes(key))
    ) {
      notices.add('部分规则依赖原始分支的作用域，需同时满足组合约束中的各个来源。');
    } else if (key === 'type' || key === 'nullable') {
      // Type and nullable must be intersected together below.
    } else if (key === 'description' || key === 'title' || key === 'summary') {
      schema[key] = distinct.join('\n\n');
    } else if (key === 'enum') {
      schema[key] = entries.reduce((left, right) =>
        left.filter((item: any) => right.some((other: any) => schemaIdentity(item) === schemaIdentity(other))),
      );
      if (!schema[key].length) notices.add('枚举约束没有共同取值，禁止任何值。');
    } else if ((lower.has(key) || upper.has(key)) && entries.every((value) => typeof value === 'number')) {
      schema[key] = lower.has(key) ? Math.max(...entries) : Math.min(...entries);
    } else if (['uniqueItems', 'readOnly', 'writeOnly', 'deprecated'].includes(key)) {
      schema[key] = entries.some(Boolean);
    } else if (distinct.length === 1) {
      schema[key] = children.has(key) && !(key === 'additionalProperties' && typeof distinct[0] === 'boolean')
        ? intersect(children.get(key)!) : distinct[0];
    } else if (key === 'items') {
      schema.items = intersect(children.get(key)!);
    } else if (key === 'additionalProperties') {
      schema.additionalProperties = entries.includes(false) ? false : intersect(children.get(key)!);
    } else {
      notices.add(`${CONSTRAINTS[key] || key}存在多个约束，需同时满足所有来源。`);
    }
    if (
      !annotations.has(key) && !key.startsWith('x-') &&
      !own(CONSTRAINTS, key) && !['type', 'items', 'not', 'contains', 'if', 'then', 'else'].includes(key)
    ) {
      notices.add('其他校验规则保留在组合约束中。');
    }
  }
  let types: string[] | undefined;
  for (const { schema: part } of parts) {
    if (!object(part).type) continue;
    const allowed: string[] = Array.isArray(part.type) ? [...part.type] : [part.type];
    if (part.nullable === true && !allowed.includes('null')) allowed.push('null');
    types = types === undefined ? allowed : types.flatMap((type) => {
      if (allowed.includes(type)) return [type];
      if (type === 'integer' && allowed.includes('number')) return ['integer'];
      if (type === 'number' && allowed.includes('integer')) return ['integer'];
      return [];
    });
    types = [...new Set(types)];
  }
  if (types) {
    schema.type = types.length === 1 ? types[0] : types;
    if (!types.length) notices.add('类型约束没有交集，禁止任何值。');
    if (types.includes('null') && values.has('nullable')) schema.nullable = true;
  } else if (values.has('nullable')) schema.nullable = values.get('nullable')!.every(Boolean);
  const tuples = [...children].filter(([key]) => key.startsWith('prefixItems:'));
  if (hasPrefixItems) schema.prefixItems = tuples.map(([, inputs]) => intersect(inputs));
  if (
    alternatives.filter(({ keyword }) => keyword === 'oneOf').length > 1 ||
    alternatives.filter(({ keyword }) => keyword === 'anyOf').length > 1
  ) {
    notices.add('存在多组备选约束，每组均需独立满足。');
  }
  const view: DisplaySchema = {
    schema,
    forbidden,
    references: [...references],
    recursiveReferences: [...recursiveReferences],
    notices: [...notices],
    combinationConstraints: notices.size ? parts.map((part) => part.schema) : [],
    alternatives,
  };
  Object.defineProperty(schema, DISPLAY_SCHEMA, { value: view });
  return view;
}

export function schemaType(document: ApiObject, raw: any, seen = new Set<string>(), depth = 0): string {
  if (depth >= 32) return '已达到展示深度上限';
  if (raw === true) return '任意类型';
  if (raw === false) return '禁止任何值';
  const view = displaySchema(document, raw);
  if (view.references.some((reference) => seen.has(reference))) return '递归引用';
  const schema = view.schema;
  if (view.forbidden) return '禁止任何值';
  if ((Array.isArray(schema.type) && !schema.type.length) || schema.enum?.length === 0)
    return '禁止任何值';
  if (!Object.keys(schema).length && view.recursiveReferences.length) return '递归引用';
  let type: string;
  if (Array.isArray(schema.type))
    type = schema.type.map((type: string) => type === 'array'
      ? `array<${schemaType(document, schema.items ?? true, seen, depth + 1)}>` : type).join(' | ');
  else if (schema.type === 'array')
    type = `array<${schemaType(document, schema.items ?? true, seen, depth + 1)}>`;
  else if (schema.type) type = schema.type;
  else if (own(schema, 'items') || schema.prefixItems)
    type = `array<${schemaType(document, schema.items ?? true, seen, depth + 1)}>`;
  else if (view.alternatives.some(({ keyword }) => keyword === 'oneOf')) type = 'oneOf · 恰好一个';
  else if (view.alternatives.some(({ keyword }) => keyword === 'anyOf')) type = 'anyOf · 至少一个';
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
  const view = displaySchema(document, raw);
  const schema = object(view.schema);
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
  for (const [group, { keyword, branches }] of view.alternatives.entries()) {
    const multiple = view.alternatives.filter((alternative) => alternative.keyword === keyword).length > 1;
    branches.forEach((value: any, index: number) =>
      edges.push({
        name: `${keyword}${multiple ? ` · 组合 ${group + 1}` : ''} · 分支 ${index + 1}`,
        schema: value,
        required: false,
      }),
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
  const schema = object(displaySchema(document, raw).schema);
  return Object.entries(CONSTRAINTS)
    .filter(
      ([key]) =>
        own(schema, key) && !(key === 'additionalProperties' && typeof schema[key] === 'object'),
    )
    .map(([key, label]) => [`${label} · ${key}`, schema[key]]);
}


// Keep common constraints readable; exact schema keywords remain available in details.
export function schemaConstraintSummary(document: ApiObject, raw: any): [string, any][] {
  const schema = object(displaySchema(document, raw).schema);
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
