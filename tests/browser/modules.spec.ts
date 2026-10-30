import { expect, test } from '@playwright/test';
import { copyFile, cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generate } from '../../build/generate';

const leafId = 'team/子目录 space%/leaf';
const moduleOverview = (id: string) => `#/module/${encodeURIComponent(id)}/overview`;
const moduleOperation = (id: string) => `#/module/${encodeURIComponent(id)}/operation/post%3A%2Fitems`;
test.describe('离线模块集合', () => {
  let directory: string;
  let url: string;
  test.beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'specleaf-browser-modules-'));
    const sources = join(directory, 'sources');
    await cp('tests/fixtures/modules', join(sources, 'modules'), { recursive: true });
    await copyFile('tests/fixtures/module-models.json', join(sources, 'module-models.json'));
    await generate(join(sources, 'modules'), join(directory, 'modules.html'));
    await rm(sources, { recursive: true });
    expect(await readdir(directory)).toEqual(['modules.html']);
    url = pathToFileURL(join(directory, 'modules.html')).href;
  });
  test.afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  test('左侧按模块展示全部接口，支持直接跨模块导航和独立分组展开', async ({ page, context }) => {
    await context.setOffline(true);
    await page.goto(url);
    await expect(page.locator('#module-select')).toHaveCount(0);
    await expect(page.locator('.module-group')).toHaveCount(3);
    await expect(page.locator('.module-heading strong')).toHaveText(['根模块 API', '团队模块 API', '叶子模块 API']);
    await expect(page.locator('.module-heading small')).toHaveText(['.', 'team', leafId]);
    await expect(page.locator('.operation-link')).toHaveCount(4);
    await expect(page.locator('.workspace-label')).toContainText('3 个模块 · 4 个接口');
    await expect(page.locator('.search-scope')).toHaveText('搜索范围：全部模块');
    await page.screenshot({ path: 'test-results/modules-overview.png', fullPage: true, animations: 'disabled' });
    const root = page.getByRole('region', { name: '模块 . · 根模块 API', exact: true });
    const team = page.getByRole('region', { name: '模块 team · 团队模块 API', exact: true });
    const leaf = page.getByRole('region', { name: `模块 ${leafId} · 叶子模块 API`, exact: true });
    await root.getByRole('button', { name: '资源 1', exact: true }).click();
    await expect(root.locator('.operation-link')).toHaveCount(0);
    await team.getByRole('link', { name: 'POST 团队模块创建', exact: true }).click();
    await expect(page.locator('.title-row h1')).toHaveText('团队模块创建');
    await expect(root.locator('.operation-link')).toHaveCount(0);
    await expect(page.locator('.operation-link.selected')).toHaveCount(1);
    await team.getByRole('button', { name: '未分组 1', exact: true }).click();
    await expect(leaf.getByRole('link', { name: 'POST 叶子模块创建', exact: true })).toBeVisible();
    await leaf.getByRole('link', { name: 'POST 叶子模块创建', exact: true }).click();
    await expect(page.locator('.title-row h1')).toHaveText('叶子模块创建');
    await expect(page.locator('.operation-link.selected')).toHaveCount(1);
    await expect(team.getByRole('button', { name: '未分组 1', exact: true })).toHaveAttribute('aria-expanded', 'false');
  });

  test('目录搜索与方法筛选覆盖全部模块，跨模块查看时保留筛选', async ({ page, context }) => {
    await context.setOffline(true);
    await page.goto(url);
    const search = page.getByRole('textbox', { name: '搜索接口' });
    await search.fill('模块创建');
    await page.getByLabel('筛选请求方法').selectOption('post');
    await expect(page.locator('.module-group')).toHaveCount(3);
    await expect(page.locator('.operation-link')).toHaveCount(3);
    await expect(page.locator('.method-filter > span')).toHaveText('3 个接口');
    await page.getByRole('link', { name: 'POST 团队模块创建', exact: true }).click();
    await expect(page).toHaveURL(url + moduleOperation('team'));
    await expect(search).toHaveValue('模块创建');
    await expect(page.getByLabel('筛选请求方法')).toHaveValue('post');
    await expect(page.locator('.operation-link.selected')).toHaveCount(1);
    await search.fill('');
    await page.getByLabel('筛选请求方法').selectOption('get');
    await expect(page.locator('.module-group')).toHaveCount(1);
    await expect(page.locator('.operation-link')).toHaveText(['GET团队列表']);
    await page.getByLabel('筛选请求方法').selectOption('');
    await search.fill(leafId);
    await expect(page.locator('.operation-link')).toHaveCount(1);
    await page.getByRole('link', { name: 'POST 叶子模块创建', exact: true }).click();
    await expect(search).toHaveValue(leafId);
    await search.fill('根模块');
    await expect(page.locator('.operation-link')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'POST 根模块创建', exact: true })).toBeVisible();
    await search.fill('不存在的接口');
    await expect(page.locator('.module-group')).toHaveCount(0);
    await expect(page.locator('.search-empty')).toContainText('没有找到相关接口');
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await expect(page.locator('.operation-link')).toHaveCount(4);
  });

  test('同路径接口直接跨模块打开时重置详情状态，引用、服务地址与鉴权独立', async ({ page, context }) => {
    const errors: string[] = [];
    const requests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await context.setOffline(true);
    await page.goto(url);
    await page.getByRole('link', { name: 'POST 根模块创建', exact: true }).click();
    await expect(page.locator('#authentication')).toContainText('X-Root-Key');
    await expect(page.locator('.server-line')).toContainText('https://root.example.invalid');
    await page.locator('#request').getByRole('button', { name: '展开 nested', exact: true }).click();
    await expect(page.locator('#request')).toContainText('rootNested');
    await page.getByLabel('请求示例').selectOption({ index: 1 });
    await expect(page.locator('#request pre').first()).toContainText('second');
    await page.getByLabel('请求媒体类型').selectOption('text/plain');
    await page.getByRole('tab', { name: '400', exact: true }).click();
    await page.getByRole('link', { name: 'POST 团队模块创建', exact: true }).click();
    await expect(page.locator('#authentication')).toContainText('TeamToken');
    await expect(page.locator('#authentication')).not.toContainText('X-Root-Key');
    await expect(page.locator('.server-line')).toContainText('https://team.example.invalid');
    await expect(page.locator('#request')).toContainText('teamField');
    await expect(page.locator('#request')).not.toContainText('rootField');
    await expect(page.locator('#request')).not.toContainText('teamNested');
    await expect(page.getByRole('tab', { name: '201', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.locator('#responses').getByRole('button', { name: '展开 shared', exact: true }).click();
    await expect(page.locator('#responses')).toContainText('sharedField');
    await page.getByRole('tab', { name: '401', exact: true }).click();
    await page.getByRole('link', { name: 'POST 根模块创建', exact: true }).click();
    await expect(page.getByLabel('请求媒体类型')).toHaveValue('application/json');
    await expect(page.getByLabel('请求示例')).toHaveValue('0');
    await expect(page.locator('#request pre').first()).toContainText('first');
    await expect(page.getByRole('tab', { name: '200', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#request')).not.toContainText('rootNested');
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  });

  test('模块链接支持复制、刷新和历史导航，无效链接保留完整目录', async ({ page, context }) => {
    await context.setOffline(true);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      document.execCommand = () => {
        (window as any).copiedLink = (document.activeElement as HTMLTextAreaElement)?.value;
        return true;
      };
    });
    await page.goto(url + moduleOverview('team'));
    await page.getByRole('link', { name: `模块概览：${leafId} · 叶子模块 API`, exact: true }).click();
    await page.getByRole('link', { name: 'POST 叶子模块创建', exact: true }).click();
    await expect(page).toHaveURL(url + moduleOperation(leafId));
    await page.getByRole('button', { name: '复制链接', exact: true }).click();
    expect(await page.evaluate(() => (window as any).copiedLink)).toBe(url + moduleOperation(leafId));
    await page.reload();
    await expect(page.locator('.title-row h1')).toHaveText('叶子模块创建');
    await page.goBack();
    await expect(page.locator('.overview-hero h1')).toHaveText('叶子模块 API.');
    await page.goBack();
    await expect(page.locator('.overview-hero h1')).toHaveText('团队模块 API.');
    await page.goForward();
    await expect(page.locator('.overview-hero h1')).toHaveText('叶子模块 API.');
    await page.goForward();
    await expect(page.locator('.title-row h1')).toHaveText('叶子模块创建');
    for (const hash of ['#/module/removed/overview', '#/module/%xx/overview']) {
      await page.goto(url + hash);
      await expect(page.getByRole('heading', { name: '未找到该模块' })).toBeVisible();
      await expect(page.locator('.module-group')).toHaveCount(3);
      await expect(page.locator('.page-outline > button')).toHaveCount(0);
    }
    await page.goto(url + '#/module/team/operation/get%3A%2Fmissing');
    await expect(page.getByRole('heading', { name: '未找到该接口' })).toBeVisible();
    await page.getByRole('link', { name: '返回文档概览' }).click();
    await expect(page.locator('.overview-hero h1')).toHaveText('团队模块 API.');
  });

  test('仅导出当前正在查看模块的合并 OpenAPI，文件名编码模块路径', async ({ page, context }) => {
    await context.setOffline(true);
    await page.goto(url);
    for (const [id, title] of [['.', '根模块 API'], ['team', '团队模块 API'], [leafId, '叶子模块 API']]) {
      await page.getByRole('link', { name: `模块概览：${id} · ${title}`, exact: true }).click();
      const downloading = page.waitForEvent('download');
      await page.locator('.top-nav').getByRole('button', { name: '导出 OpenAPI' }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe(`openapi-${encodeURIComponent(id)}.json`);
      const document = JSON.parse(await readFile((await download.path())!, 'utf8'));
      expect(document.info.title).toBe(title);
      expect(document).not.toHaveProperty('modules');
      expect(document).not.toHaveProperty('kind');
      expect(JSON.stringify(document)).not.toContain('module-models.json');
      expect(document.components.schemas.Item.properties).toHaveProperty(id === '.' ? 'rootField' : id === 'team' ? 'teamField' : 'leafField');
    }
  });

  test('移动端抽屉直接展示全部模块，长模块路径和接口无横向溢出', async ({ page, context }) => {
    await context.setOffline(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url);
    await page.getByRole('button', { name: '打开接口目录' }).click();
    await expect(page.getByRole('textbox', { name: '搜索接口' })).toBeFocused();
    await expect(page.locator('.module-group')).toHaveCount(3);
    await expect(page.locator('.operation-link')).toHaveCount(4);
    await page.screenshot({ path: 'test-results/modules-mobile-menu.png', animations: 'disabled' });
    await page.getByRole('link', { name: 'POST 叶子模块创建', exact: true }).click();
    await expect(page.locator('.title-row h1')).toHaveText('叶子模块创建');
    await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/modules-mobile.png', fullPage: true, animations: 'disabled' });
  });
});
