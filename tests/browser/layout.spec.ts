import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generate } from '../../build/generate';

test.describe('阅读区域布局', () => {
  let directory: string;
  let single: string;
  let modules: string;
  const title = '分页查询资源与关联记录的完整接口说明（设计，未实现）';
  test.beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'specleaf-layout-'));
    const contract = {
      openapi: '3.1.0',
      info: { title: '阅读布局验收', version: '1' },
      paths: {
        '/items': {
          get: {
            summary: title,
            tags: ['资源查询'],
            description: Array.from({ length: 15 }, () => '长篇说明用于验收宽屏阅读区域与目录的对齐。'.repeat(12)).join('\n\n'),
            responses: { '200': { description: '成功' } },
          },
        },
      },
    };
    const input = join(directory, 'contract.json');
    const root = join(directory, 'modules');
    await mkdir(join(root, 'inventory'), { recursive: true });
    await writeFile(input, JSON.stringify(contract));
    await writeFile(join(root, 'inventory/openapi.json'), JSON.stringify(contract));
    const singleHtml = join(directory, 'single.html');
    const modulesHtml = join(directory, 'modules.html');
    await generate(input, singleHtml);
    await generate(root, modulesHtml);
    single = `${pathToFileURL(singleHtml).href}#/operation/get%3A%2Fitems`;
    modules = `${pathToFileURL(modulesHtml).href}#/module/inventory/operation/get%3A%2Fitems`;
  });
  test.afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  for (const mode of ['single', 'modules'] as const) {
    test(`${mode}：大屏正文与本页目录整体居中，滚动时不横向偏移`, async ({ page, context }, testInfo) => {
      await context.setOffline(true);
      for (const width of [1440, 1920, 2124, 2560]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(mode === 'single' ? single : modules);
        await expect(page.locator('.title-row h1')).toHaveText(title);
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page.locator('.page-outline')).toBeVisible();
        const measure = () => page.evaluate(() => {
          const sidebar = document.querySelector('.sidebar')!.getBoundingClientRect();
          const main = document.querySelector('.page-shell main')!.getBoundingClientRect();
          const outline = document.querySelector('.page-outline')!;
          const outlineBox = outline.getBoundingClientRect();
          const trailingMargin = parseFloat(getComputedStyle(outline).marginRight);
          return {
            leftGap: main.left - sidebar.right,
            rightGap: document.documentElement.clientWidth - outlineBox.right - trailingMargin,
            mainX: main.x,
            outlineX: outlineBox.x,
            overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          };
        });
        const initial = await measure();
        expect(initial.overflows).toBe(false);
        expect(initial.leftGap).toBeGreaterThanOrEqual(-1);
        expect(initial.rightGap).toBeGreaterThanOrEqual(-1);
        expect(Math.abs(initial.leftGap - initial.rightGap), `视口 ${width}px 的左右留白应均衡`).toBeLessThanOrEqual(2);
        await page.screenshot({ path: testInfo.outputPath(`layout-${width}.png`), animations: 'disabled' });
        await page.evaluate(() => window.scrollTo(0, 600));
        const scrolled = await measure();
        expect(scrolled.mainX).toBe(initial.mainX);
        expect(scrolled.outlineX).toBe(initial.outlineX);
      }
    });
  }

  test('窄屏和移动端保持正文边界及抽屉布局', async ({ page, context }) => {
    await context.setOffline(true);
    for (const width of [1280, 800, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(modules);
      await expect(page.locator('.title-row h1')).toHaveText(title);
      await expect(page.locator('.page-outline')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      if (width <= 800) {
        await page.getByRole('button', { name: '打开接口目录' }).click();
        await expect(page.locator('.sidebar')).toHaveClass(/drawer-open/);
        await expect(page.locator('.operation-link.selected')).toBeVisible();
        await page.getByRole('button', { name: '关闭目录', exact: true }).click();
      }
    }
  });
});
