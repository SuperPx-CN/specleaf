import { describe, expect, it } from 'vitest';
import contract from './fixtures/allof.json';
import {
  displaySchema, mediaExamples, resolveSchema, schemaConstraintSummary,
  schemaConstraints, schemaEdges, schemaType, type ApiObject,
} from '../src/lib/openapi';

const response = { $ref: '#/components/schemas/CouponResponse' };
const child = (document: ApiObject, raw: any, name: string) =>
  schemaEdges(document, raw).find((edge) => edge.name === name)!.schema;

describe('allOf 展示合并', () => {
  it('优惠券响应根节点恰好四个必填字段，数据说明、数组元素和分页完整', () => {
    const edges = schemaEdges(contract, response);
    expect(edges.map(({ name }) => name)).toEqual(['code', 'message', 'data', 'pagination']);
    expect(edges.every(({ required }) => required)).toBe(true);
    expect(schemaType(contract, response)).toBe('object');
    const data = child(contract, response, 'data');
    expect(displaySchema(contract, data).schema.description).toBe('业务成功数据');
    expect(schemaType(contract, data)).toBe('array<object>');
    const coupon = child(contract, data, '[] 数组元素');
    expect(schemaEdges(contract, coupon).map(({ name }) => name))
      .toEqual(['id', 'name', 'discount', 'kind', 'eligibility', 'related']);
    const pagination = child(contract, response, 'pagination');
    expect(schemaEdges(contract, pagination).map(({ name, required }) => [name, required]))
      .toEqual([['page', true], ['total', true]]);
  });

  it('同名字段递归合并子属性、数组元素、必填集合与非重复说明，保持首次出现顺序', () => {
    const schema = { allOf: [
      { properties: {
        record: { description: '记录', properties: { a: { type: 'string' } } },
        list: { type: 'array', items: { properties: { x: { type: 'integer' } } } },
      }, required: ['later'] },
      { allOf: [{ properties: {
        record: { description: '记录', required: ['a', 'b'], properties: { b: { type: 'boolean' } } },
        list: { type: 'array', items: { required: ['x'], properties: { y: { type: 'number' } } } },
        later: { type: 'string' },
      } }] },
      { properties: { record: { description: '补充说明' } } },
    ] };
    expect(schemaEdges({}, schema).map(({ name, required }) => [name, required]))
      .toEqual([['record', false], ['list', false], ['later', true]]);
    const record = child({}, schema, 'record');
    expect(displaySchema({}, record).schema.description).toBe('记录\n\n补充说明');
    expect(schemaEdges({}, record).map(({ name, required }) => [name, required]))
      .toEqual([['a', true], ['b', true]]);
    const item = child({}, child({}, schema, 'list'), '[] 数组元素');
    expect(schemaEdges({}, item).map(({ name, required }) => [name, required]))
      .toEqual([['x', true], ['y', false]]);
  });

  it('引用附带约束参与合并，摘要、详情和类型使用同一结果', () => {
    const id = child(contract, contract.components.schemas.Coupon, 'id');
    const view = displaySchema(contract, id);
    expect(view.schema.description).toBe('优惠券编号');
    expect(schemaType(contract, view.schema)).toBe('string');
    expect(schemaConstraintSummary(contract, view.schema)).toEqual([['长度', '2–12 字符']]);
    expect(schemaConstraints(contract, view.schema)).toEqual([
      ['最短长度 · minLength', 2], ['最长长度 · maxLength', 12],
    ]);
    expect(view.notices.join()).toContain('正则存在多个约束');
    expect(view.combinationConstraints.map((source) => source.pattern)).toEqual(['[0-9]$', '^[A-Z]']);
  });

  it('安全归并类型交集、数值范围、枚举、元组和布尔 Schema', () => {
    const schema = { allOf: [
      { type: ['number', 'null'], minimum: 1, maximum: 20, enum: [1, 2, 3, null] },
      { type: 'integer', minimum: 2, maximum: 10, enum: [2, 3, 4] },
    ] };
    expect(schemaType({}, schema)).toBe('integer');
    expect(displaySchema({}, schema).schema).toMatchObject({ minimum: 2, maximum: 10, enum: [2, 3] });
    expect(displaySchema({}, schema).notices).toEqual([]);
    expect(schemaType({}, { allOf: [{ type: 'string' }, { type: 'number' }] })).toBe('禁止任何值');
    expect(schemaType({}, { allOf: [{ enum: [1] }, { enum: [2] }] })).toBe('禁止任何值');
    expect(schemaType({}, { allOf: [true, { type: 'array', items: false }] })).toBe('array<禁止任何值>');
    expect(schemaType({}, { allOf: [false, { type: 'string', description: '仍保留说明' }] })).toBe('禁止任何值');
    expect(displaySchema({}, { allOf: [false, { description: '仍保留说明' }] }).schema.description).toBe('仍保留说明');
    expect(schemaType({}, { allOf: [{ type: 'string', nullable: true }, { type: 'string' }] })).toBe('string');
    expect(schemaType({}, { allOf: [{ properties: {} }] })).toBe('object');
    expect(schemaType({}, { allOf: [{ items: false }] })).toBe('array<禁止任何值>');
    const tuple = { allOf: [
      { prefixItems: [{ type: 'string' }, true] },
      { prefixItems: [{ minLength: 2 }, { type: 'integer' }] },
    ] };
    const edges = schemaEdges({}, tuple);
    expect(edges.map(({ name }) => name)).toEqual(['[0] 元组元素', '[1] 元组元素']);
    expect(displaySchema({}, edges[0].schema).schema).toMatchObject({ type: 'string', minLength: 2 });
    expect(schemaType({}, edges[1].schema)).toBe('integer');
    expect(schemaConstraints({}, { additionalProperties: false })).toContainEqual(['额外属性 · additionalProperties', false]);
  });

  it('复杂约束保留所有来源，避免将分支作用域及重复约束改写为全局规则', () => {
    const sources = [
      { type: 'object', properties: { a: true }, additionalProperties: false,
        pattern: '^a', multipleOf: 2, format: 'first', dependentRequired: { a: ['b'] } },
      { properties: { b: true }, unevaluatedProperties: false,
        pattern: 'z$', multipleOf: 3, format: 'second', dependentRequired: { b: ['a'] },
        dependentSchemas: { b: { required: ['c'] } } },
    ];
    const view = displaySchema({}, { allOf: sources });
    expect(view.combinationConstraints).toEqual(sources);
    expect(view.notices.join()).toContain('作用域');
    expect(view.schema).not.toHaveProperty('additionalProperties');
    expect(view.schema).not.toHaveProperty('pattern');
    expect(schemaEdges({}, view.schema).map(({ name }) => name)).toEqual(['a', 'b']);
    expect(schemaConstraintSummary({}, view.schema)).toEqual([]);
    const bounds = displaySchema({}, { allOf: [
      { type: 'number', minimum: 1, exclusiveMinimum: true },
      { minimum: 10, exclusiveMinimum: false },
    ] });
    expect(bounds.schema).not.toHaveProperty('minimum');
    expect(bounds.combinationConstraints).toHaveLength(2);
    const conditional = displaySchema({}, { allOf: [
      { if: { required: ['a'] }, then: { required: ['b'] } },
      { if: { required: ['b'] }, then: { required: ['c'] } },
    ] });
    expect(conditional.combinationConstraints).toHaveLength(2);
    expect(schemaEdges({}, conditional.schema)).toEqual([]);
    const nested = child({}, { allOf: [{ properties: { settings: {
      type: 'object', dependentSchemas: { enabled: { required: ['token'] } },
    } } }] }, 'settings');
    expect(displaySchema({}, nested).combinationConstraints).toEqual([
      { type: 'object', dependentSchemas: { enabled: { required: ['token'] } } },
    ]);
  });

  it('额外属性的作用域未改变时保留普通字段树，并合并其子约束', () => {
    const schema = { allOf: [
      { properties: { known: true }, additionalProperties: { type: 'string' } },
      { properties: { known: { type: 'integer' } }, additionalProperties: { minLength: 2 } },
    ] };
    const view = displaySchema({}, schema);
    expect(view.notices).toEqual([]);
    const extra = child({}, view.schema, '[key] 额外属性');
    expect(displaySchema({}, extra).schema).toMatchObject({ type: 'string', minLength: 2 });
    expect(schemaConstraints({}, { allOf: [
      { additionalProperties: true }, { additionalProperties: false },
    ] })).toEqual([['额外属性 · additionalProperties', false]]);
  });

  it('保留 oneOf、anyOf 的独立备选组，数组中的备选元素继续合并 allOf', () => {
    const schema = { allOf: [
      { oneOf: [{ allOf: [{ type: 'string' }, { minLength: 2 }] }, false] },
      { oneOf: [{ const: 'x' }, { const: 'y' }], anyOf: [{ type: 'string' }, { type: 'number' }] },
    ] };
    const view = displaySchema({}, schema);
    const edges = schemaEdges({}, view.schema);
    expect(edges).toHaveLength(6);
    expect(edges.every(({ name }) => !name.includes('allOf'))).toBe(true);
    expect(view.alternatives.map(({ keyword, branches }) => [keyword, branches.length]))
      .toEqual([['oneOf', 2], ['oneOf', 2], ['anyOf', 2]]);
    expect(displaySchema({}, edges[0].schema).schema).toMatchObject({ type: 'string', minLength: 2 });
    expect(schemaType({}, { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } }))
      .toBe('array<anyOf · 至少一个>');
  });

  it('沿分支引用路径检测直接、间接及 allOf 循环，重复使用共享模型不是循环', () => {
    const document = {
      A: { allOf: [{ $ref: '#/B' }, { properties: { child: { $ref: '#/A' } } }] },
      B: { $ref: '#/A', properties: { label: { type: 'string' } } },
      Array: { type: 'array', items: { $ref: '#/Array' } },
      Shared: { properties: { value: { type: 'integer' } } },
    };
    const root = displaySchema(document, { $ref: '#/A' });
    expect(root.recursiveReferences).toEqual(['#/A']);
    expect(schemaEdges(document, root.schema).map(({ name }) => name)).toEqual(['label', 'child']);
    const cycle = displaySchema(document, child(document, root.schema, 'child'));
    expect(cycle.recursiveReferences).toEqual(['#/A']);
    expect(schemaEdges(document, cycle.schema)).toEqual([]);
    expect(schemaType(document, cycle.schema)).toBe('递归引用');
    expect(schemaType(document, { $ref: '#/Array' })).toBe('array<递归引用>');
    const shared = { allOf: [{ properties: { a: { $ref: '#/Shared' }, b: { $ref: '#/Shared' } } }, { $ref: '#/Shared' }] };
    for (const name of ['a', 'b']) {
      const view = displaySchema(document, child(document, shared, name));
      expect(view.recursiveReferences).toEqual([]);
      expect(schemaEdges(document, view.schema).map(({ name }) => name)).toEqual(['value']);
    }
    // The array's path goes through ArrayOfShared, not through the independent
    // Shared branch at the root. Do not union those paths for type summaries.
    const arrayDocument = { ...document, ArrayOfShared: { type: 'array', items: { $ref: '#/Shared' } } };
    expect(schemaType(arrayDocument, { allOf: [{ $ref: '#/Shared' }, { $ref: '#/ArrayOfShared' }] }))
      .toBe('array<object>');
  });

  it('深层组合在 32 层停止解析并保留原始规则', () => {
    let schema: any = { type: 'string', pattern: 'retained' };
    for (let depth = 0; depth < 40; depth++) schema = { allOf: [schema] };
    const view = displaySchema({}, schema);
    expect(view.notices.join()).toContain('展示深度上限');
    expect(JSON.stringify(view.combinationConstraints)).toContain('retained');
    expect(schemaEdges({}, view.schema)).toEqual([]);
    expect(schemaType({}, view.schema)).not.toContain('allOf');
  });

  it('展示合并不修改契约、现有解析结果或原始示例', () => {
    const original = JSON.stringify(contract);
    const media = contract.paths['/coupons'].post.requestBody.content['application/json'];
    const resolved = resolveSchema(contract, response);
    const before = JSON.stringify(resolved);
    const data = child(contract, response, 'data');
    schemaEdges(contract, child(contract, data, '[] 数组元素'));
    expect(JSON.stringify(contract)).toBe(original);
    expect(JSON.stringify(resolved)).toBe(before);
    expect(resolved.allOf).toHaveLength(2);
    expect(mediaExamples(contract, media)[0].value).toEqual(media.example);
  });
});
