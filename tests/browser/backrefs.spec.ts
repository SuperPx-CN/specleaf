import { expect, test } from '@playwright/test';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generate } from '../../build/generate';
import { collectOperations, resolveObject, resolveSchema } from '../../src/lib/openapi';

test.describe('跨文件返回引用的离线文档', () => {
  let directory: string;
  test.beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'specleaf-backrefs-'));
    const source = join(directory, 'source');
    await cp('tests/fixtures/backrefs', source, { recursive: true });
    await generate(join(source, 'openapi.yaml'), join(directory, 'single.html'));
    await generate(source, join(directory, 'modules.html'));
    await rm(source, { recursive: true });
    expect((await readdir(directory)).sort()).toEqual(['modules.html', 'single.html']);
  });
  test.afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  for (const mode of ['single', 'modules']) {
    test(`${mode} 模式断网展示参数、响应、请求体、递归模型并导出，示例中的 $ref 保持字面值`, async ({ page, context }) => {
      const errors: string[] = [];
      const requests: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
      await context.setOffline(true);
      await page.goto(pathToFileURL(join(directory, `${mode}.html`)).href);
      await expect(page.locator('.overview-hero h1')).toHaveText('跨文件返回引用 API.');
      await page.getByRole('textbox', { name: '搜索接口' }).fill('跨文件');
      await page.getByRole('link', { name: 'GET 跨文件查询', exact: true }).click();
      await expect(page.locator('#parameters')).toContainText('otherPage');
      await expect(page.locator('#request pre')).toContainText('page=1&otherPage=90');
      await expect(page.locator('#responses')).toContainText('查询成功');
      await page.getByRole('tab', { name: '400', exact: true }).click();
      await expect(page.locator('#responses')).toContainText('参数无效');
      await page.getByRole('tab', { name: '200', exact: true }).click();
      await expect(page.locator('#responses').getByRole('cell', { name: 'child', exact: true })).toBeVisible();
      await expect(page.locator('#responses')).toContainText('递归引用');
      await page.getByRole('link', { name: 'POST 跨文件创建', exact: true }).click();
      await expect(page.locator('#request')).toContainText('创建请求覆盖说明');
      expect(JSON.parse(await page.locator('#request pre').innerText()).$ref).toBe('../openapi.yaml#/components/parameters/Page');
      const downloading = page.waitForEvent('download');
      await page.locator('.top-nav').getByRole('button', { name: '导出 OpenAPI' }).click();
      const document = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
      const [operation] = collectOperations(document);
      expect(operation.parameters.map((parameter) => parameter.name)).toEqual(['page', 'otherPage']);
      const response = resolveObject(document, operation.definition.responses['200']);
      const item = resolveSchema(document, response.content['application/json'].schema);
      expect(resolveSchema(document, item.properties.child).properties.label.type).toBe('string');
      if (mode === 'modules') {
        await page.getByRole('textbox', { name: '搜索接口' }).fill('');
        await page.getByRole('link', { name: 'GET 其他模块查询', exact: true }).click();
        await expect(page.locator('#request pre')).toContainText('otherPage=90');
        await expect(page.locator('#parameters').getByRole('cell', { name: 'page', exact: true })).toHaveCount(0);
      }
      expect(errors).toEqual([]);
      expect(requests).toEqual([]);
    });
  }
});
