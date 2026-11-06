import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generate } from '../../build/generate';
import type { ApiObject } from '../../src/lib/openapi';

const statuses = [
  ['draft', '草稿', 'rgb(98, 103, 118)'],
  ['developing', '开发中', 'rgb(118, 86, 204)'],
  ['testing', '测试中', 'rgb(50, 109, 176)'],
  ['released', '已发布', 'rgb(36, 122, 87)'],
  ['deprecated', '已弃用', 'rgb(150, 96, 22)'],
] as const;
interface StatusCase {
  path: string;
  definition: ApiObject;
  status?: string;
  label?: string;
  color?: string;
}
const cases: StatusCase[] = [
  ...statuses.map(([status, label, color]) => ({ path: `/${status}`, definition: { 'x-api-status': status }, status, label, color })),
  { path: '/legacy', definition: { deprecated: true }, status: 'deprecated', label: '已弃用' },
  { path: '/conflict', definition: { deprecated: true, 'x-api-status': 'released' }, status: 'deprecated', label: '已弃用' },
  { path: '/false', definition: { deprecated: false, 'x-api-status': 'testing' }, status: 'testing', label: '测试中' },
  { path: '/truthy', definition: { deprecated: 'true', 'x-api-status': 'draft' }, status: 'draft', label: '草稿' },
  {
    path: '/policies',
    definition: {
      'x-api-status': 'released',
      'x-design-status': 'draft',
      'x-rate-limit': { window_seconds: 60, principal_limit: 10 },
      'x-custom-policy': '保留自定义策略',
    },
    status: 'released', label: '已发布',
  },
  { path: '/missing', definition: { 'x-design-status': 'released', 'x-contract-status': 'released' } },
  { path: '/unknown', definition: { 'x-api-status': 'planned' } },
  { path: '/wrong-type', definition: { 'x-api-status': ['released'] } },
  { path: '/uppercase', definition: { 'x-api-status': 'Released' } },
];
const contract = {
  openapi: '3.1.0',
  info: { title: '接口状态验收', version: '1' },
  'x-api-status': 'released',
  'x-contract-status': { note: '契约状态保持原样' },
  tags: [{ name: 'status', 'x-api-status': 'released' }],
  paths: Object.fromEntries(cases.map(({ path, definition }) => [path, {
    'x-api-status': 'released',
    get: { summary: path, tags: ['status'], responses: { '200': { description: 'ok' } }, ...definition },
  }])),
};

test.describe('接口状态展示', () => {
  let directory: string;
  let entry: string;
  let url: string;
  test.beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'specleaf-status-'));
    entry = join(directory, 'status.json');
    const html = join(directory, 'status.html');
    await writeFile(entry, JSON.stringify(contract));
    await generate(entry, html);
    url = pathToFileURL(html).href;
  });
  test.afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  test('目录与详情状态一致，弃用优先且只有一个徽标，无效状态不显示标记', async ({ page }) => {
    for (const { path, status, label, color } of cases) {
      await page.goto(`${url}#/operation/${encodeURIComponent(`get:${path}`)}`);
      await expect(page.locator('.title-row h1')).toHaveText(path);
      const link = page.locator('.operation-link.selected');
      const dot = link.locator('.api-status-dot');
      const badge = page.locator('.api-status-badge');
      await expect(dot).toHaveCount(status ? 1 : 0);
      await expect(badge).toHaveCount(status ? 1 : 0);
      await expect(page.locator('#policies summary code', { hasText: 'x-api-status' })).toHaveCount(0);
      if (status) {
        await expect(link).toHaveAccessibleName(`GET ${path} 接口状态：${label}`);
        await expect(dot).toHaveAttribute('aria-label', `接口状态：${label}`);
        await expect(dot).toHaveAttribute('title', `接口状态：${label}`);
        await expect(dot).toHaveClass(`api-status-dot api-status-${status}`);
        await expect(badge).toHaveText(label!);
        await expect(badge).toHaveClass(`api-status-badge api-status-${status}`);
        if (color) {
          await expect(dot).toHaveCSS('background-color', color);
          await expect(badge).toHaveCSS('color', color);
        }
      }
    }
  });

  test('操作策略不重复展示接口状态，导出契约保留原值且源文件不变', async ({ page, context }) => {
    await context.setOffline(true);
    await page.goto(`${url}#/operation/get%3A%2Fconflict`);
    await expect(page.locator('.api-status-badge')).toHaveText('已弃用');
    const policy = page.locator('.policy-card').filter({ has: page.locator('summary code', { hasText: 'x-api-status' }) });
    await expect(policy).toHaveCount(0);
    await expect(page.locator('#policies .empty-note')).toHaveText('契约未定义扩展操作策略');
    const downloading = page.waitForEvent('download');
    await page.locator('.top-nav').getByRole('button', { name: '导出 OpenAPI' }).click();
    const exported = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
    expect(exported).toEqual(contract);
    expect(exported.paths['/deprecated'].get).not.toHaveProperty('deprecated');
    expect(exported.paths['/wrong-type'].get['x-api-status']).toEqual(['released']);
    expect(await readFile(entry, 'utf8')).toBe(JSON.stringify(contract));
    await page.goto(`${url}#/operation/get%3A%2Fpolicies`);
    await expect(page.locator('.api-status-badge')).toHaveText('已发布');
    await expect(page.locator('#policies .empty-note')).toHaveCount(0);
    await expect(page.locator('#policies .policy-card')).toHaveCount(3);
    await expect(page.locator('#policies')).not.toContainText('x-api-status');
    const designPolicy = page.locator('.policy-card').filter({ has: page.locator('summary code', { hasText: 'x-design-status' }) });
    await expect(designPolicy.locator('summary')).toContainText('设计状态');
    await designPolicy.locator('summary').click();
    await expect(designPolicy.locator('p')).toHaveText('draft');
    const ratePolicy = page.locator('.policy-card').filter({ has: page.locator('summary code', { hasText: 'x-rate-limit' }) });
    await expect(ratePolicy.locator('summary')).toContainText('请求限流');
    await expect(ratePolicy.locator('dd')).toHaveText(['60', '10']);
    const customPolicy = page.locator('.policy-card').filter({ has: page.locator('summary code', { hasText: 'x-custom-policy' }) });
    await expect(customPolicy.locator('summary')).toContainText('扩展说明');
    await expect(customPolicy.locator('p')).toHaveText('保留自定义策略');
    await page.goto(`${url}#/overview`);
    await expect(page.locator('.info-callout')).toContainText('契约状态 · x-contract-status');
  });
});
