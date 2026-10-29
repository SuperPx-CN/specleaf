import { expect, test } from '@playwright/test';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generate } from '../../build/generate';

test.describe('独立离线 HTML', () => {
  test.describe.configure({ mode: 'serial' });
  let directory: string;
  let standalone: string;
  let special: string;
  let empty: string;
  const payload = '</sCrIpT><script>globalThis.INJECTED=true</script><!--<script> & "\u2028\u2029';

  test.beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), '独立 离线 HTML-'));
    standalone = join(directory, '单个文档.html');
    await copyFile('dist/index.html', standalone);
    // Only the HTML is copied here; no assets, source files or HTTP server are available.
    expect(await readdir(directory)).toEqual(['单个文档.html']);
    const entry = join(directory, 'contract.json');
    special = join(directory, 'special.html');
    empty = join(directory, 'empty.html');
    await writeFile(entry, JSON.stringify({
      openapi: '3.1.0',
      info: { title: payload, version: '1', description: payload + '\n![远程图片](https://example.invalid/pixel.png)\n![本地图片](./pixel.png)' },
      paths: { '/safe': { get: { summary: '特殊字符示例', responses: { '200': { description: payload, content: { 'application/json': { example: { raw: payload } } } } } } } },
    }));
    await generate(entry, special);
    await writeFile(entry, JSON.stringify({
      openapi: '3.0.3', info: { title: '超长文档标题VeryLongUnbrokenDocumentTitle'.repeat(6), version: '1' }, paths: {},
    }));
    await generate(entry, empty);
  });
  test.afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  test('file:// 断网搜索、导航、刷新、递归、示例切换、复制与导出，无外部请求', async ({ page, context }) => {
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await context.setOffline(true);
    // Simulate an unavailable Clipboard API, exercising the selection based fallback.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      document.execCommand = (command: string) => {
        (window as any).fallbackCommand = command;
        (window as any).copiedValue = (document.activeElement as HTMLTextAreaElement)?.value;
        return true;
      };
    });
    await page.goto(pathToFileURL(standalone).href);
    await expect(page.getByRole('heading', { name: '示例资源 API.' })).toBeVisible();
    await expect(page.locator('img')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '[图片] 远程架构图', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: '搜索接口' }).fill('创建');
    await page.getByRole('link', { name: 'POST 创建资源', exact: true }).click();
    await page.reload();
    await expect(page.locator('.title-row h1')).toHaveText('创建资源');
    await page.locator('#request').getByRole('button', { name: '展开 children', exact: true }).click();
    await page.locator('#request').getByRole('button', { name: '展开 [] 数组元素', exact: true }).click();
    await page.locator('#request').getByRole('button', { name: '展开 children', exact: true }).last().click();
    await expect(page.locator('#request')).toContainText('递归引用');
    await page.getByLabel('请求示例').selectOption({ index: 1 });
    await expect(page.locator('#request pre')).toContainText("O'Brien");
    await page.getByRole('button', { name: '复制路径', exact: true }).click();
    expect(await page.evaluate(() => (window as any).fallbackCommand)).toBe('copy');
    expect(await page.evaluate(() => (window as any).copiedValue)).toBe('/items');
    await expect(page.getByRole('button', { name: '复制路径', exact: true })).toContainText('已复制');
    const downloading = page.waitForEvent('download');
    await page.locator('.top-nav').getByRole('button', { name: '导出 OpenAPI' }).click();
    const download = await downloading;
    const contract = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(contract.info.title).toBe('示例资源 API');
    expect(Object.keys(contract.paths)).toHaveLength(4);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('Clipboard API 被拒绝后重试备用复制，全部失败时选择文本并可用 Escape 关闭', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } }, configurable: true });
      document.execCommand = () => {
        (window as any).fallbackAttempts = ((window as any).fallbackAttempts || 0) + 1;
        return (window as any).allowFallback === true;
      };
    });
    await page.goto(pathToFileURL(standalone).href + '#/operation/post%3A%2Fitems');
    await page.evaluate(() => { (window as any).allowFallback = true; });
    await page.getByRole('button', { name: '复制路径', exact: true }).click();
    await expect(page.getByRole('button', { name: '复制路径', exact: true })).toContainText('已复制');
    expect(await page.evaluate(() => (window as any).fallbackAttempts)).toBe(1);
    await page.evaluate(() => { (window as any).allowFallback = false; });
    await page.getByRole('button', { name: '复制路径', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '手动复制' });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('待复制文本').filter({ visible: true })).toHaveValue('/items');
    expect(await page.evaluate(() => {
      const text = document.querySelector<HTMLTextAreaElement>('dialog[open] textarea')!;
      return text.value.slice(text.selectionStart, text.selectionEnd);
    })).toBe('/items');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: '复制路径', exact: true })).toBeFocused();
  });

  test('脚本闭合字符和元数据保留原义，Markdown 图片仅显示链接', async ({ page, context }) => {
    const errors: string[] = [];
    const requests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await context.setOffline(true);
    await page.goto(pathToFileURL(special).href);
    await expect(page.locator('.overview-hero h1')).toHaveText(payload + '.');
    expect(await page.locator('meta[name="description"]').getAttribute('content')).toContain(payload);
    await expect(page.locator('script')).toHaveCount(2);
    await expect(page.locator('script[type="application/json"]')).toHaveCount(1);
    expect(await page.locator('#specleaf-contract').evaluate((node) => JSON.parse(node.textContent!).info.title)).toBe(payload);
    expect(await page.evaluate(() => (window as any).INJECTED)).toBeUndefined();
    await expect(page.locator('img')).toHaveCount(0);
    await expect(page.locator('.image-link')).toHaveCount(2);
    await page.goto(pathToFileURL(special).href + '#/operation/get%3A%2Fsafe');
    expect(JSON.parse(await page.locator('#responses pre').innerText())).toEqual({ raw: payload });
    const downloading = page.waitForEvent('download');
    await page.locator('.top-nav').getByRole('button', { name: '导出 OpenAPI' }).click();
    const contract = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
    expect(contract.info.title).toBe(payload);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('空文档、长站点名称与无效链接在桌面和移动端均可读', async ({ page, context }) => {
    await context.setOffline(true);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(pathToFileURL(empty).href);
      await expect(page.locator('.overview-hero h1')).toContainText('超长文档标题');
      await expect(page.getByRole('button', { name: '浏览接口', exact: true })).toBeDisabled();
      await expect(page.locator('.start-example')).toContainText('当前契约暂无接口定义');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.goto(pathToFileURL(empty).href + '#/operation/get%3A%2Fmissing');
      await expect(page.getByRole('heading', { name: '未找到该接口' })).toBeVisible();
    }
  });
});
