import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { openApiPlugin } from '../../build/openapi-plugin';

test('初始空模块目录显示错误浮层，新增入口后自动恢复', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'specleaf-empty-dev-'));
  const originalEntry = process.env.OPENAPI_ENTRY;
  process.env.OPENAPI_ENTRY = directory;
  const server = await createServer({
    configFile: false, root: process.cwd(), base: './', plugins: [react(), openApiPlugin()],
    server: { host: '127.0.0.1', port: 0 },
  });
  try {
    await server.listen();
    const address = server.httpServer!.address() as { port: number };
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await expect(page.locator('vite-error-overlay')).toContainText('未找到 openapi.yaml');
    await writeFile(join(directory, 'openapi.json'), JSON.stringify({
      openapi: '3.1.0', info: { title: '初始错误恢复', version: '1' }, paths: {},
    }));
    await expect(page.locator('.overview-hero h1')).toHaveText('初始错误恢复.');
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await expect(page.locator('.module-group')).toHaveCount(1);
  } finally {
    await server.close();
    if (originalEntry === undefined) delete process.env.OPENAPI_ENTRY;
    else process.env.OPENAPI_ENTRY = originalEntry;
    await rm(directory, { recursive: true, force: true });
  }
});

test('目录开发监听模块新增、删除、重复入口、共享引用及缺失文件修复', async ({ page }) => {
  test.setTimeout(60000);
  const directory = await mkdtemp(join(tmpdir(), 'specleaf-modules-dev-'));
  const input = join(directory, 'apis');
  const root = join(input, 'openapi.json');
  const nested = join(input, 'nested/openapi.yml');
  const shared = join(directory, 'shared.json');
  const missing = join(directory, 'external/missing.json');
  const originalEntry = process.env.OPENAPI_ENTRY;
  const model = (field: string) => JSON.stringify({ Item: { type: 'object', properties: { [field]: { type: 'string' } } } });
  const contract = (title: string, reference: string) => JSON.stringify({
    openapi: '3.1.0', info: { title, version: '1' },
    paths: { '/items': { post: {
      summary: title,
      requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } },
      responses: { '204': { description: '成功' } },
    } } },
    components: { schemas: { Item: { $ref: reference } } },
  });
  await mkdir(input);
  await writeFile(root, contract('根模块', '../shared.json#/Item'));
  await writeFile(shared, model('before'));
  process.env.OPENAPI_ENTRY = input;
  const server = await createServer({
    configFile: false, root: process.cwd(), base: './', plugins: [react(), openApiPlugin()],
    server: { host: '127.0.0.1', port: 0 },
  });
  try {
    await server.listen();
    const address = server.httpServer!.address() as { port: number };
    await page.goto(`http://127.0.0.1:${address.port}/#/module/./operation/post%3A%2Fitems`);
    await expect(page.getByRole('cell', { name: 'before', exact: true })).toBeVisible();
    await mkdir(join(input, 'nested'));
    await writeFile(nested, contract('新增模块', '../../shared.json#/Item'));
    await expect(page.locator('.module-group')).toHaveCount(2);
    await page.getByRole('link', { name: 'POST 新增模块', exact: true }).click();
    await writeFile(shared, model('changed'));
    await expect(page.getByRole('cell', { name: 'changed', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'POST 根模块', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'changed', exact: true })).toBeVisible();

    const duplicate = join(input, 'nested/openapi.json');
    await writeFile(duplicate, contract('重复模块', '../../shared.json#/Item'));
    await expect(page.locator('vite-error-overlay')).toContainText('多个 OpenAPI 入口');
    await rm(duplicate);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await expect(page.locator('.module-group')).toHaveCount(2);
    await page.getByRole('link', { name: 'POST 新增模块', exact: true }).click();
    await rm(nested);
    await expect(page.getByRole('heading', { name: '未找到该模块' })).toBeVisible();
    await expect(page.locator('.module-group')).toHaveCount(1);
    await writeFile(nested, contract('恢复模块', '../../shared.json#/Item'));
    await expect(page.locator('.title-row h1')).toHaveText('恢复模块');

    await writeFile(nested, contract('缺失引用恢复', '../../external/missing.json#/Item'));
    await expect(page.locator('vite-error-overlay')).toContainText('missing.json');
    await mkdir(join(directory, 'external'));
    await writeFile(missing, model('createdMissing'));
    await expect(page.getByRole('cell', { name: 'createdMissing', exact: true })).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await rm(missing);
    await expect(page.locator('vite-error-overlay')).toContainText('missing.json');
    await writeFile(missing, model('recreatedMissing'));
    await expect(page.getByRole('cell', { name: 'recreatedMissing', exact: true })).toBeVisible();

    await writeFile(nested, '{broken');
    await expect(page.locator('vite-error-overlay')).toBeAttached();
    await writeFile(nested, contract('语法恢复', '../../shared.json#/Item'));
    await expect(page.locator('.title-row h1')).toHaveText('语法恢复');
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await rm(root);
    await rm(nested);
    await expect(page.locator('vite-error-overlay')).toContainText('未找到 openapi.yaml');
    await writeFile(root, contract('重新添加', '../shared.json#/Item'));
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '未找到该模块' })).toBeVisible();
    await page.getByRole('link', { name: '模块概览：. · 重新添加', exact: true }).click();
    await expect(page.locator('.overview-hero h1')).toHaveText('重新添加.');
  } finally {
    await server.close();
    if (originalEntry === undefined) delete process.env.OPENAPI_ENTRY;
    else process.env.OPENAPI_ENTRY = originalEntry;
    await rm(directory, { recursive: true, force: true });
  }
});
