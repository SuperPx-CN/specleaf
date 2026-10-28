import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { openApiPlugin } from '../../build/openapi-plugin';

test('开发模式监听跨文件引用、新增依赖、错误浮层与修复，并正确展示递归模型', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'specleaf-dev-'));
  const entry = join(directory, 'openapi.json');
  const models = join(directory, 'models.json');
  const nested = join(directory, 'nested.json');
  const originalEntry = process.env.OPENAPI_ENTRY;
  await writeFile(
    entry,
    JSON.stringify({
      openapi: '3.1.0',
      info: { title: '开发监听测试', version: '1' },
      paths: {
        '/test': {
          post: {
            summary: '递归与媒体类型',
            tags: ['test'],
            requestBody: {
              content: {
                'application/json': { schema: { $ref: './models.json#/Tree' } },
                'text/plain': { schema: { type: 'string' }, example: 'hello' },
              },
            },
            responses: { '204': { description: '无响应体' } },
          },
        },
      },
    }),
  );
  const model = (field: string) =>
    JSON.stringify({
      Tree: {
        type: 'object',
        properties: { [field]: { type: 'string' }, child: { $ref: '#/Tree' } },
      },
    });
  await writeFile(models, model('before'));
  process.env.OPENAPI_ENTRY = entry;
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    base: './',
    plugins: [react(), openApiPlugin()],
    server: { host: '127.0.0.1', port: 0 },
  });
  try {
    await server.listen();
    const address = server.httpServer!.address() as { port: number };
    await page.goto(`http://127.0.0.1:${address.port}/#/operation/post%3A%2Ftest`);
    await expect(page.getByRole('cell', { name: 'before', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '展开 child', exact: true }).click();
    await expect(page.locator('#request')).toContainText('递归引用');
    await expect(page.locator('#request')).toContainText('契约未提供原始示例');
    await page.getByLabel('请求媒体类型').selectOption('text/plain');
    await expect(page.locator('#request pre')).toHaveText('hello');
    await page.getByLabel('请求媒体类型').selectOption('application/json');
    await writeFile(models, model('after'));
    await expect(page.getByRole('cell', { name: 'after', exact: true })).toBeVisible();
    await writeFile(
      nested,
      JSON.stringify({ Nested: { type: 'object', properties: { added: { type: 'number' } } } }),
    );
    await writeFile(models, JSON.stringify({ Tree: { $ref: './nested.json#/Nested' } }));
    await expect(page.getByRole('cell', { name: 'added', exact: true })).toBeVisible();
    await writeFile(
      nested,
      JSON.stringify({ Nested: { type: 'object', properties: { watched: { type: 'number' } } } }),
    );
    await expect(page.getByRole('cell', { name: 'watched', exact: true })).toBeVisible();
    await writeFile(models, JSON.stringify({ Tree: { $ref: './missing.json#/Missing' } }));
    await expect(page.locator('vite-error-overlay')).toBeAttached();
    await expect(page.locator('vite-error-overlay')).toContainText('missing.json');
    await writeFile(models, model('recovered'));
    await expect(page.getByRole('cell', { name: 'recovered', exact: true })).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  } finally {
    await server.close();
    if (originalEntry === undefined) delete process.env.OPENAPI_ENTRY;
    else process.env.OPENAPI_ENTRY = originalEntry;
    await rm(directory, { recursive: true, force: true });
  }
});
