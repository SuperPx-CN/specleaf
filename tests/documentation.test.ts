import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DocumentationLoadError, loadContract, loadDocumentation } from '../build/contract';
import { collectOperations, operationHash, resolveObject } from '../src/lib/openapi';
import { documentationRoute, isModuleCollection, overviewHash } from '../src/lib/documentation';

const directories: string[] = [];
const fixture = resolve('tests/fixtures/modules');
const base = { openapi: '3.1.0', info: { title: '模块', version: '1' }, paths: {} };
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), 'specleaf-modules-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('模块文档加载', () => {
  it('三级目录、三种格式、根模块、混合版本及排序；构建元数据不进入集合', async () => {
    const result = await loadDocumentation(fixture);
    expect(isModuleCollection(result.document)).toBe(true);
    const { document } = result;
    if (!isModuleCollection(document)) throw new Error('expected modules');
    expect(document.title).toBe('modules');
    expect(document.modules.map((module) => module.id)).toEqual(['.', 'team', 'team/子目录 space%/leaf']);
    expect(document.modules.map((module) => module.document.openapi)).toEqual(['3.0.3', '3.1.0', '3.1.1']);
    expect(Object.keys(document).sort()).toEqual(['kind', 'modules', 'title']);
    expect(result.files).toHaveLength(4);
    expect(result.files).toContain(resolve('tests/fixtures/module-models.json'));
    expect(result.directories).toContain(join(fixture, 'team/子目录 space%'));
    expect(document.modules.map((module) => collectOperations(module.document).length)).toEqual([1, 2, 1]);
  });

  it('保留同路径接口、同名模型、共享引用、服务地址与鉴权的独立作用域', async () => {
    const { document } = await loadDocumentation(fixture);
    if (!isModuleCollection(document)) throw new Error('expected modules');
    for (const [index, module] of document.modules.entries()) {
      const operation = collectOperations(module.document)[0];
      expect(operation.id).toBe('post:/items');
      const item = resolveObject(module.document, { $ref: '#/components/schemas/Item' });
      expect(Object.keys(item.properties)[0]).toBe(['rootField', 'teamField', 'leafField'][index]);
      if (index < 2) expect(resolveObject(module.document, item.properties.shared).properties.sharedField.type).toBe('boolean');
    }
    expect(document.modules[0].document.components.securitySchemes.Auth.name).toBe('X-Root-Key');
    expect(document.modules[1].document.components.securitySchemes.Auth.scheme).toBe('bearer');
    expect(collectOperations(document.modules[1].document)[0].tags).toEqual(['未分组']);
    expect(collectOperations(document.modules[1].document)[0].servers[0].url).toContain('team.');
  });

  it('准确匹配入口名，忽略隐藏目录、构建目录及目录符号链接', async () => {
    const directory = await temporary();
    await writeFile(join(directory, 'openapi.json'), JSON.stringify(base));
    for (const name of ['.hidden', 'node_modules', 'dist', 'build', 'coverage']) {
      await mkdir(join(directory, name));
      await writeFile(join(directory, name, 'openapi.yaml'), 'invalid');
    }
    await writeFile(join(directory, 'OpenAPI.yaml'), 'invalid');
    await writeFile(join(directory, 'other-openapi.json'), 'invalid');
    await symlink(directory, join(directory, 'loop'), 'dir');
    await symlink(fixture, join(directory, 'linked-modules'), 'dir');
    const { document } = await loadDocumentation(directory);
    expect(document.modules).toEqual([{ id: '.', document: base }]);
  });

  it('空目录、重复入口和任一模块解析失败时提供中文上下文', async () => {
    const directory = await temporary();
    await expect(loadDocumentation(directory)).rejects.toThrow('未找到 openapi.yaml');
    await writeFile(join(directory, 'openapi.json'), JSON.stringify(base));
    await writeFile(join(directory, 'openapi.yaml'), JSON.stringify(base));
    await expect(loadDocumentation(directory)).rejects.toThrow(/多个 OpenAPI 入口.*\nopenapi.json、openapi.yaml/s);
    await rm(join(directory, 'openapi.yaml'));
    await mkdir(join(directory, 'bad'));
    await writeFile(join(directory, 'bad/openapi.yml'), JSON.stringify({ ...base, openapi: '2.0' }));
    await expect(loadDocumentation(directory)).rejects.toThrow(/模块「bad」解析失败.*仅支持 OpenAPI/s);
  });

  it('单文件保留原始契约形状及 loadContract 接口', async () => {
    const input = resolve('examples/minimal.json');
    const result = await loadDocumentation(input);
    expect(result.document).toEqual((await loadContract(input)).document);
    expect(result.document).not.toHaveProperty('modules');
    expect(result.files).toEqual([input]);
  });

  it('解析失败保留入口、已读取依赖和缺失引用的监听元数据', async () => {
    const directory = await temporary();
    await cp(fixture, join(directory, 'modules'), { recursive: true });
    await expect(loadDocumentation(join(directory, 'modules'))).rejects.toMatchObject({
      files: expect.arrayContaining([join(directory, 'modules/openapi.yaml'), join(directory, 'module-models.json')]),
      directories: expect.arrayContaining([directory]),
    });
    try { await loadDocumentation(join(directory, 'modules')); } catch (error) {
      expect(error).toBeInstanceOf(DocumentationLoadError);
    }
    await writeFile(join(directory, 'module-models.json'), await readFile(resolve('tests/fixtures/module-models.json')));
    expect((await loadDocumentation(join(directory, 'modules'))).document.modules).toHaveLength(3);
  });
});

describe('模块链接', () => {
  const modules = [{ id: '.', document: base }, { id: 'team/子目录 space%/leaf', document: base }];
  it('编码整个模块和接口 ID，支持默认模块及单文件原链接', () => {
    const operation = collectOperations({ paths: { '/a/b %': { get: {} } } })[0];
    expect(documentationRoute('', modules)).toEqual({ moduleId: '.', invalid: false });
    for (const module of modules) {
      expect(documentationRoute(overviewHash(module.id), modules)).toEqual({ moduleId: module.id, operationId: undefined, invalid: false });
      expect(documentationRoute(operationHash(operation, module.id), modules)).toEqual({ moduleId: module.id, operationId: operation.id, invalid: false });
    }
    expect(operationHash(operation)).toBe('#/operation/get%3A%2Fa%2Fb%20%25');
    expect(documentationRoute(operationHash(operation))).toMatchObject({ operationId: operation.id, invalid: false });
  });
  it('拒绝损坏编码、缺失接口、额外路径和错误模式', () => {
    for (const hash of ['#/overview', '#/module/%zz/overview', '#/module/./operation/%xx', '#/module/./operation/', '#/module/team/x/overview', '#/module/./overview/extra'])
      expect(documentationRoute(hash, modules).invalid, hash).toBe(true);
  });
});
