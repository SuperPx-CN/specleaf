import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { loadContract } from '../../build/contract';
import { collectOperations, operationHash } from '../../src/lib/openapi';

test('通用概览、中文搜索、方法筛选、Hash 刷新和返回', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '示例资源 API.' })).toBeVisible();
  await expect(page.locator('.stats-grid')).toContainText('5');
  await expect(page.locator('.stats-grid')).toContainText('3');
  await expect(page.locator('.group-cards')).toContainText('资源目录');
  await page.screenshot({ path: 'test-results/overview.png', fullPage: true });
  await page.getByRole('button', { name: '浏览接口', exact: true }).click();
  await expect(page.locator('.endpoint-bar')).toContainText('/items');
  await page.getByRole('textbox', { name: '搜索接口' }).fill('创建');
  await page.getByLabel('筛选请求方法').selectOption('post');
  await expect(page.locator('.operation-link')).toHaveCount(1);
  await page.getByRole('link', { name: 'POST 创建资源 接口状态：开发中', exact: true }).click();
  await expect(page.getByRole('heading', { name: '创建资源', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/operation\/post%3A%2Fitems$/);
  await page.reload();
  await expect(page.locator('.endpoint-bar')).toContainText('/items');
  await page.locator('#request').getByRole('button', { name: '展开 metadata', exact: true }).click();
  await expect(page.locator('#request').getByRole('cell', { name: 'owner', exact: true })).toBeVisible();
  await page.locator('#request').getByRole('button', { name: '展开 state', exact: true }).click();
  await page.locator('#request').getByRole('button', { name: '展开 oneOf · 分支 2', exact: true }).click();
  await expect(page.locator('#request').getByRole('cell', { name: 'reason', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/operation.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('tab', { name: '429', exact: true }).click();
  await expect(page.locator('#responses .code-block')).toContainText('RATE_LIMITED');
  await page.locator('.response-headers summary').click();
  await expect(page.getByRole('cell', { name: 'Retry-After', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/operation\/get%3A%2Fitems$/);
  expect(errors).toEqual([]);
});

test('原始请求示例、cURL、路径与分享链接可复制，合并契约可导出', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#/operation/post%3A%2Fitems');
  await page.getByRole('button', { name: '复制路径', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/items');
  await page.getByRole('button', { name: '复制链接', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('#/operation/post%3A%2Fitems');
  await page.locator('#request').getByRole('button', { name: '复制示例', exact: true }).click();
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toHaveProperty('name', '示例资源');
  await page.getByLabel('请求示例').selectOption({ index: 1 });
  await expect(page.locator('#request pre')).toContainText("O'Brien");
  await page.locator('#request').getByRole('button', { name: 'cURL', exact: true }).click();
  await page.getByRole('button', { name: '复制 cURL', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('curl --request POST');
  await expect(page.locator('#policies')).toContainText('x-rate-limit');
  await expect(page.locator('#policies')).toContainText('x-notes');
  const downloadEvent = page.waitForEvent('download');
  await page.locator('.top-nav').getByRole('button', { name: '导出 OpenAPI' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('openapi.json');
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.info.title).toBe('示例资源 API');
  expect(JSON.stringify(exported)).not.toContain('./models.yaml');
});

test('原样展示 JSON、纯文本和 YAML，切换原始和外部示例', async ({ page }) => {
  await page.goto('/#/operation/get%3A%2Fexports');
  const media = page.getByLabel('响应媒体类型');
  await expect(media).toHaveValue('text/plain');
  await expect(page.locator('#responses pre')).toHaveText('item-001,示例资源\n');
  await media.selectOption('text/yaml');
  await expect(page.locator('#responses pre')).toContainText('items:');
  await media.selectOption('application/json');
  await expect(page.locator('#responses pre')).toContainText('item-001');
  await page.getByLabel('响应示例').selectOption({ index: 1 });
  await expect(page.locator('#responses pre')).toHaveText('{\n  "items": []\n}');
  await page.getByLabel('响应示例').selectOption({ index: 2 });
  await expect(page.locator('#responses')).toContainText('契约使用外部示例（未加载）');
  await expect(page.locator('#responses')).toContainText('https://example.invalid/items.json');
});

test('子目录部署、无效 Hash 与页内目录滚动高亮', async ({ page }) => {
  const failures: string[] = [];
  page.on('requestfailed', (request) => failures.push(request.url()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/reference/#/operation/get%3A%2Fitems');
  await expect(page.getByRole('heading', { name: '查询资源', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('#authentication')).toContainText('无需鉴权');
  await page.getByRole('button', { name: '返回响应', exact: true }).click();
  await expect(page.locator('.page-outline .current')).toHaveText('返回响应');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('.page-outline .current')).toHaveText('接口说明');
  for (const hash of ['#/operation/get%3A%2Fmissing', '#/operation/%xx']) {
    await page.goto('/reference/' + hash);
    await expect(page.getByRole('heading', { name: '未找到该接口' })).toBeVisible();
    await expect(page.locator('.page-outline > button')).toHaveCount(0);
  }
  expect(failures).toEqual([]);
});

test('移动抽屉、键盘、字段展开、长标题和路径没有横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '打开接口目录' }).click();
  await expect(page.getByRole('textbox', { name: '搜索接口' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('textbox', { name: '搜索接口' })).toBeFocused();
  await page.getByRole('textbox', { name: '搜索接口' }).fill('创建');
  await page.getByRole('link', { name: 'POST 创建资源 接口状态：开发中', exact: true }).click();
  await expect(page.getByRole('heading', { name: '创建资源', exact: true })).toBeVisible();
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  await page.locator('#request').getByRole('button', { name: '展开 metadata', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true, animations: 'disabled' });
  const { document } = await loadContract('examples/openapi.yaml');
  const operation = collectOperations(document).find((operation) => operation.method === 'delete')!;
  await page.goto('/' + operationHash(operation));
  await expect(page.locator('.title-row h1')).toHaveText(operation.definition.summary);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-long.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '打开接口目录' }).click();
  await page.getByRole('textbox', { name: '搜索接口' }).fill('');
  const selectedLink = page.locator('.operation-link.selected');
  const dot = selectedLink.getByRole('img', { name: '接口状态：已弃用', exact: true });
  await expect(dot).toBeVisible();
  const dotBox = (await dot.boundingBox())!;
  const linkBox = (await selectedLink.boundingBox())!;
  expect(dotBox.width).toBe(6);
  expect(dotBox.height).toBe(6);
  expect(dotBox.x + dotBox.width).toBeLessThanOrEqual(linkBox.x + linkBox.width);
  expect(await selectedLink.locator('.operation-link-title').evaluate((title) => title.scrollWidth > title.clientWidth)).toBe(true);
  expect(await page.locator('.sidebar-scroll').evaluate((sidebar) => sidebar.scrollWidth <= sidebar.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-long-status.png', animations: 'disabled' });
});

test('独立示例全部接口可打开，无额外资源请求和运行时错误', async ({ page }) => {
  const errors: string[] = [];
  const resources: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (request.resourceType() !== 'document') resources.push(request.url()); });
  const { document } = await loadContract('examples/openapi.yaml');
  for (const operation of collectOperations(document)) {
    await page.goto('/' + operationHash(operation));
    await expect(page.locator('.title-row h1')).toHaveText(operation.definition.summary || operation.path);
    await expect(page.locator('.endpoint-bar')).toContainText(operation.path);
  }
  expect(resources).toEqual([]);
  expect(errors).toEqual([]);
});
