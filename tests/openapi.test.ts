import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import grouping from './fixtures/grouping.json';
import { contractEntry, loadContract } from '../build/contract';
import {
  collectOperations,
  collectTags,
  formatValue,
  makeCurl,
  matchesOperation,
  mediaExamples,
  operationHash,
  operationIdFromHash,
  resolveObject,
  resolvePointer,
  resolveSchema,
  schemaConstraints,
  schemaEdges,
  schemaType,
  type ApiObject,
} from '../src/lib/openapi';

const directories: string[] = [];
async function fixture(files: Record<string, string | ApiObject>) {
  const directory = await mkdtemp(join(tmpdir(), 'specleaf-test-'));
  directories.push(directory);
  await Promise.all(
    Object.entries(files).map(([file, data]) =>
      writeFile(join(directory, file), typeof data === 'string' ? data : JSON.stringify(data)),
    ),
  );
  return join(directory, 'openapi.json');
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const base = { openapi: '3.1.0', info: { title: '测试', version: '1' }, paths: {} };

describe('本地契约合并', () => {
  it('合并 YAML / JSON 跨文件引用，正确转义路径并保留循环的内部引用', async () => {
    const entry = await fixture({
      'openapi.json': {
        ...base,
        paths: { '/items/{id}': { $ref: './paths.yaml#/~1items~1{id}' } },
        components: { schemas: { Tree: { $ref: './models.json#/Tree' } } },
      },
      'paths.yaml':
        '"/items/{id}":\n  get:\n    responses:\n      "200":\n        description: ok\n        content:\n          application/json:\n            schema:\n              $ref: ./models.json#/Tree\n',
      'models.json': { Tree: { type: 'object', properties: { child: { $ref: '#/Tree' } } } },
    });
    const { document, files } = await loadContract(entry);
    expect(files).toHaveLength(3);
    expect(() => JSON.stringify(document)).not.toThrow();
    const operation = collectOperations(document)[0];
    const tree = resolveObject(
      document,
      operation.definition.responses['200'].content['application/json'].schema,
    );
    expect(tree.type).toBe('object');
    expect(tree.properties.child.$ref).toMatch(/^#/);
    expect(resolveObject(document, tree.properties.child).type).toBe('object');
  });
  it('缺失文件的错误包含源文件和引用上下文', async () => {
    const entry = await fixture({
      'openapi.json': { ...base, paths: { '/test': { $ref: './missing.yaml#/test' } } },
    });
    await expect(loadContract(entry)).rejects.toThrow(/missing\.yaml/);
    await expect(loadContract(entry)).rejects.toThrow(/#\/paths\/~1test\/\$ref/);
  });
  it('无效指针的错误包含引用位置和目标字段', async () => {
    const entry = await fixture({
      'openapi.json': { ...base, paths: { '/test': { $ref: './models.json#/Missing' } } },
      'models.json': { Present: {} },
    });
    await expect(loadContract(entry)).rejects.toThrow(/Missing/);
    await expect(loadContract(entry)).rejects.toThrow(/#\/paths\/~1test\/\$ref/);
  });
  it('拒绝远程引用和远程入口', async () => {
    const entry = await fixture({
      'openapi.json': {
        ...base,
        paths: { '/test': { $ref: 'https://example.invalid/model.yaml#/test' } },
      },
    });
    await expect(loadContract(entry)).rejects.toThrow(/https:\/\/example.invalid/);
    expect(() => contractEntry('/project', 'https://example.com/api.yaml')).toThrow(/本地/);
  });
  it('原始示例、默认值与扩展数据中的 $ref 按字面保留，Schema 里的同名属性仍解析', async () => {
    const literal = { $ref: './not-a-real-file.json#/example' };
    const entry = await fixture({
      'openapi.json': {
        ...base,
        components: {
          schemas: {
            Sample: {
              type: 'object',
              default: literal,
              properties: { example: { $ref: './models.json#/String' } },
              examples: [literal],
            },
          },
        },
        paths: {
          '/test': {
            get: {
              'x-meta': literal,
              responses: {
                '200': {
                  description: 'ok',
                  content: {
                    'application/json': { example: literal, examples: { raw: { value: literal } } },
                  },
                },
              },
            },
          },
        },
      },
      'models.json': { String: { type: 'string' } },
    });
    const { document } = await loadContract(entry);
    expect(
      document.paths['/test'].get.responses['200'].content['application/json'].example,
    ).toEqual(literal);
    expect(
      document.paths['/test'].get.responses['200'].content['application/json'].examples.raw.value,
    ).toEqual(literal);
    expect(document.components.schemas.Sample.default).toEqual(literal);
    expect(
      resolveObject(document, document.components.schemas.Sample.properties.example).type,
    ).toBe('string');
  });
  it('支持 OpenAPI 3.0；不接受缺少元数据的契约或其他主版本', async () => {
    const entry = await fixture({ 'openapi.json': { ...base, openapi: '3.0.3' } });
    expect((await loadContract(entry)).document.openapi).toBe('3.0.3');
    const bad = await fixture({ 'openapi.json': { ...base, openapi: '2.0' } });
    await expect(loadContract(bad)).rejects.toThrow(/3.0 \/ 3.1/);
    const invalid = await fixture({ 'openapi.json': { openapi: '3.1.0', paths: {} } });
    await expect(loadContract(invalid)).rejects.toThrow(/info.title/);
  });
  it('相对入口按项目根目录解析', () => {
    const root = resolve('project', 'docs');
    const absolute = resolve('other', 'api.json');
    expect(contractEntry(root, './contract.yaml')).toBe(join(root, 'contract.yaml'));
    expect(contractEntry(root, absolute)).toBe(absolute);
  });
});

describe('文档模型', () => {
  it('JSON Pointer 支持 ~0、~1、URI 编码、空键，且只查找自有属性', () => {
    const document = { 'a/b': { '~name': { '': 42 } }, '~1': 'literal', 中文: false };
    expect(resolvePointer(document, '#/a~1b/~0name/')).toBe(42);
    expect(resolvePointer(document, '#/~01')).toBe('literal');
    expect(resolvePointer(document, '#/%E4%B8%AD%E6%96%87')).toBe(false);
    expect(resolvePointer(document, '#')).toBe(document);
    expect(() => resolvePointer(document, '#/toString')).toThrow(/引用不存在/);
    expect(() => resolvePointer(document, '#/~2')).toThrow(/无效/);
  });
  it('操作级参数覆盖同名同位置的路径级参数，同时保留其他位置的同名参数', () => {
    const document = {
      ...base,
      servers: [{ url: '/root' }],
      components: { parameters: { query: { name: 'id', in: 'query', required: true } } },
      paths: {
        '/x': {
          parameters: [
            { name: 'id', in: 'query', required: false },
            { name: 'id', in: 'header' },
          ],
          servers: [{ url: '/path' }],
          get: {
            parameters: [{ $ref: '#/components/parameters/query' }],
            servers: [{ url: '/operation' }],
          },
          post: {},
        },
      },
    };
    const [get, post] = collectOperations(document);
    expect(get.parameters).toHaveLength(2);
    expect(get.parameters[0]).toMatchObject({ name: 'id', in: 'query', required: true });
    expect(get.servers[0].url).toBe('/operation');
    expect(post.servers[0].url).toBe('/path');
    expect(get.tags).toEqual(['未分组']);
  });
  it('递归和互相引用可安全读取，引用兄弟约束保留', () => {
    const document = { A: { $ref: '#/B', description: 'A' }, B: { $ref: '#/A', type: 'object' } };
    expect(resolveObject(document, { $ref: '#/A', title: '标题' })).toMatchObject({
      description: 'A',
      title: '标题',
    });
    expect(() => schemaType(document, { type: 'array', items: { $ref: '#/A' } })).not.toThrow();
    const selfArray = { A: { type: 'array', items: { $ref: '#/A' } } };
    expect(schemaType(selfArray, { $ref: '#/A' })).toBe('array<递归引用>');
  });
  it('保留 allOf / oneOf / anyOf 的独立分支及必填、数组、空值和 false Schema', () => {
    const schema = {
      type: 'object',
      properties: { id: { type: ['string', 'null'] } },
      required: ['id'],
      allOf: [{ type: 'object' }, { type: 'object' }],
      oneOf: [{ type: 'string' }],
      anyOf: [{ type: 'number' }],
      additionalProperties: { type: 'boolean' },
    };
    const edges = schemaEdges({}, schema);
    expect(edges.map((edge) => edge.name)).toEqual([
      'id',
      'allOf · 分支 1',
      'allOf · 分支 2',
      'oneOf · 分支 1',
      'anyOf · 分支 1',
      '[key] 额外属性',
    ]);
    expect(edges[0].required).toBe(true);
    expect(schemaType({}, schema.properties.id)).toBe('string | null');
    expect(schemaType({}, { type: 'array', items: { type: 'integer' }, nullable: true })).toBe(
      'array<integer> | null',
    );
    expect(schemaType({}, false)).toBe('禁止任何值');
    expect(
      schemaConstraints({}, { default: false, minimum: 0, additionalProperties: false }),
    ).toHaveLength(3);
  });
  it('引用旁的 Schema 约束共同生效，不覆盖目标字段；布尔引用保持原义', () => {
    const document = {
      Base: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      Never: false,
    };
    const schema = resolveSchema(document, {
      $ref: '#/Base',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
    expect(schema.allOf[0].required).toEqual(['id']);
    expect(schema.allOf[1].required).toEqual(['name']);
    expect(schemaType(document, { $ref: '#/Never' })).toBe('禁止任何值');
  });
  it('示例保留 null / false / 字符串和外部链接，不生成假数据', () => {
    expect(mediaExamples({}, { example: null })[0].value).toBeNull();
    expect(mediaExamples({}, { example: false })[0].value).toBe(false);
    expect(
      mediaExamples({}, { schema: { examples: [0, null] } }).map((example) => example.value),
    ).toEqual([0, null]);
    expect(
      mediaExamples({}, { examples: { remote: { externalValue: './sample.json' } } })[0]
        .externalValue,
    ).toBe('./sample.json');
    expect(mediaExamples({}, { schema: { type: 'object' } })).toEqual([]);
    expect(formatValue('ok\n', 'text/plain')).toBe('ok\n');
    expect(formatValue('ok', 'application/json')).toBe('"ok"');
  });
  it('Hash 链接包含方法和编码后的路径，搜索覆盖中文、路径、方法与 operationId', () => {
    const [operation] = collectOperations({
      ...base,
      paths: {
        '/items/{id}': { get: { operationId: 'getItem', summary: '读取商品', tags: ['commerce'] } },
      },
    });
    expect(operationIdFromHash(operationHash(operation))).toBe(operation.id);
    expect(operationIdFromHash('#/operation/%xx')).toBeUndefined();
    expect(matchesOperation(operation, '商品 getItem', 'get')).toBe(true);
    expect(matchesOperation(operation, 'commerce', '')).toBe(true);
    expect(matchesOperation(operation, '订单', '')).toBe(false);
    expect(matchesOperation(operation, '商品', 'post')).toBe(false);
  });
  it('cURL 按 OR 鉴权方案、全局继承、表单和 shell 引号生成模板', () => {
    const document = {
      ...base,
      servers: [{ url: 'https://{region}.example.com', variables: { region: { default: 'api' } } }],
      security: [{ Token: [] }, { Cookie: [] }],
      components: {
        securitySchemes: {
          Token: { type: 'http', scheme: 'bearer' },
          Cookie: { type: 'apiKey', in: 'cookie', name: 'secret' },
        },
      },
      paths: { '/x/{id}': { post: { parameters: [{ in: 'path', name: 'id', example: 'x' }] } } },
    };
    const [operation] = collectOperations(document);
    const curl = makeCurl(document, operation, 'application/json', {
      name: 'raw',
      value: { name: "O'Brien" },
    });
    expect(curl).toContain('https://api.example.com/x/x');
    expect(curl).toContain('Authorization: Bearer {token}');
    expect(curl).not.toContain('Cookie:');
    expect(curl).toContain("O'\\''Brien");
    expect(
      makeCurl(document, operation, 'application/x-www-form-urlencoded', {
        name: 'form',
        value: { a: 'x y' },
      }),
    ).toContain("--data-urlencode 'a=x y'");
    const multipart = makeCurl(document, operation, 'multipart/form-data', {
      name: 'form',
      value: { a: 'x' },
    });
    expect(multipart).toContain("--form 'a=x'");
    expect(multipart).not.toContain('Content-Type:');
    expect(makeCurl(document, { ...operation, definition: { security: [] } })).not.toContain(
      'Authorization',
    );
  });
});

describe('通用分组契约', () => {
  const operations = collectOperations(grouping);

  it('按顶层声明顺序保留原始分组名，去重并包含尚无接口的分组', () => {
    expect(collectTags(grouping, [])).toEqual(['exports', '资源目录', 'unused']);
  });

  it('未声明分组按接口中首次出现的顺序追加，跨接口和单个接口内的重复分组只收录一次', () => {
    expect(collectTags(grouping, operations)).toEqual([
      'exports', '资源目录', 'unused', 'custom', 'reports', '未分组',
    ]);
  });

  it.each(['/health', '/empty'])('缺少或为空的 tags 归入未分组：%s', (path) => {
    expect(operations.find((operation) => operation.path === path)?.tags).toEqual(['未分组']);
  });

  it('没有顶层分组声明时按接口顺序收集，空契约不产生分组', () => {
    const document = { ...grouping, tags: [] };
    expect(collectTags(document, collectOperations(document))).toEqual([
      '资源目录', 'custom', 'reports', '未分组',
    ]);
    expect(collectTags(base, collectOperations(base))).toEqual([]);
  });
});
