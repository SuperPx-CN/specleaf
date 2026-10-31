import { expect, test, type Locator } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generate } from '../../build/generate';
import contract from '../fixtures/allof.json' with { type: 'json' };

const row = (table: Locator, name: string) => table.getByRole('row').filter({
  has: table.page().locator('.field-name').getByText(name, { exact: true }),
});

test.describe('allOf 合并字段树', () => {
  let directory: string;
  let entry: string;
  let url: string;
  test.beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'specleaf-allof-'));
    entry = join(directory, 'contract.json');
    const html = join(directory, 'api.html');
    await writeFile(entry, JSON.stringify(contract));
    await generate(entry, html);
    url = pathToFileURL(html).href + '#/operation/post%3A%2Fcoupons';
  });
  test.afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  test('参数、请求体和响应均直接展示四个必填字段，逐层展开无 allOf 行', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.setOffline(true);
    await page.goto(url);
    const parameter = page.getByRole('table', { name: '参数字段', exact: true });
    const request = page.locator('#request').getByRole('table', { name: '数据模型字段' });
    const response = page.locator('#responses').getByRole('table', { name: '数据模型字段' });
    await parameter.getByRole('button', { name: '展开 filter', exact: true }).click();
    for (const table of [parameter, request, response]) {
      await expect(table.locator('.schema-row')).toHaveCount(5);
      const names = await table.locator('.schema-row .field-name code').allTextContents();
      expect(names.slice(1)).toEqual(['code', 'message', 'data', 'pagination']);
      for (const name of ['code', 'message', 'data', 'pagination']) {
        await expect(row(table, name).locator('.required')).toHaveText('必填');
      }
      await expect(row(table, 'data')).toContainText('业务成功数据');
      await expect(row(table, 'data').locator('.field-type > code')).toHaveText('array<object>');
      await table.getByRole('button', { name: '展开 data', exact: true }).click();
      await table.getByRole('button', { name: '展开 [] 数组元素', exact: true }).click();
      for (const name of ['id', 'name', 'discount', 'kind', 'eligibility', 'related']) {
        await expect(row(table, name)).toBeVisible();
      }
      await expect(row(table, 'id')).toContainText('优惠券编号');
      await expect(row(table, 'id').locator('.constraint-summary')).toHaveText('长度：2–12 字符');
      const combinations = row(table, 'id').locator('details').filter({ has: page.locator('summary', { hasText: '组合约束' }) });
      await expect(combinations).not.toHaveAttribute('open');
      await expect(combinations.locator('.constraints')).not.toBeVisible();
      await combinations.locator('summary').click();
      await expect(combinations).toContainText('正则存在多个约束');
      await expect(combinations.locator('.constraints')).toContainText('[0-9]$');
      await expect(combinations.locator('.constraints')).toContainText('^[A-Z]');
      await combinations.locator('summary').click();
      await table.getByRole('button', { name: '展开 pagination', exact: true }).click();
      for (const name of ['page', 'total']) {
        await expect(row(table, name).locator('.required')).toHaveText('必填');
      }
      await table.getByRole('button', { name: '展开 kind', exact: true }).click();
      await expect(row(table, 'oneOf · 分支 1')).toBeVisible();
      await expect(row(table, 'oneOf · 分支 2')).toBeVisible();
      await table.getByRole('button', { name: '展开 eligibility', exact: true }).click();
      await expect(row(table, 'anyOf · 分支 1')).toBeVisible();
      await expect(row(table, 'anyOf · 分支 2')).toBeVisible();
      await expect(row(table, 'related')).toContainText('递归引用');
      await expect(row(table, 'related').getByRole('button')).toHaveCount(0);
      await expect(table.locator('.field-name, .field-type').filter({ hasText: 'allOf' })).toHaveCount(0);
    }
    await page.screenshot({ path: 'test-results/allof-expanded.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('原始示例与导出保持原样，源契约没有展示层合并产物', async ({ page }) => {
    await page.goto(url);
    await expect(page.locator('#request .code-block')).toContainText('literal example');
    const downloading = page.waitForEvent('download');
    await page.locator('.top-nav').getByRole('button', { name: '导出 OpenAPI' }).click();
    const exported = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
    expect(exported).toEqual(contract);
    expect(exported.components.schemas.CouponResponse.allOf).toHaveLength(2);
    expect(await readFile(entry, 'utf8')).toBe(JSON.stringify(contract));
  });

  test('字段树在第 32 层停止展开并保留提示', async ({ page }) => {
    let schema: any = { type: 'string' };
    for (let depth = 0; depth < 35; depth++) schema = { allOf: [{ properties: { nested: schema } }] };
    const deep = { openapi: '3.1.0', info: { title: '深层结构', version: '1' }, paths: {
      '/deep': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema } } } } } },
    } };
    const deepEntry = join(directory, 'deep.json');
    const html = join(directory, 'deep.html');
    await writeFile(deepEntry, JSON.stringify(deep));
    await generate(deepEntry, html);
    await page.goto(pathToFileURL(html).href + '#/operation/get%3A%2Fdeep');
    const table = page.locator('#responses').getByRole('table', { name: '数据模型字段' });
    for (let depth = 1; depth < 32; depth++) {
      await table.getByRole('button', { name: '展开 nested', exact: true }).click();
    }
    await expect(table.getByText('已达到展示深度上限', { exact: true })).toBeVisible();
    await expect(table.locator('.schema-row')).toHaveCount(33);
    await expect(table.getByRole('button', { name: '展开 nested', exact: true })).toHaveCount(0);
    await expect(table.locator('.field-name', { hasText: 'allOf' })).toHaveCount(0);
  });
});
