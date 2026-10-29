import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generate } from '../../build/generate';

const pattern = '^(?:[1-9][0-9]{0,17}|[1-8][0-9]{18}|9[0-1][0-9]{17})$';
const id = { type: 'string', minLength: 1, maxLength: 19, pattern,
  description: '正整数字符串，无前导零。' };
const fields = { type: 'object', properties: {
  session_id: { $ref: '#/components/schemas/ID' },
  count: { type: 'integer', minimum: 0, maximum: 100, default: 0 },
  enabled: { type: 'boolean', default: false },
  mode: { type: 'string', enum: ['web', 'desktop'] },
} };
const contract = {
  openapi: '3.1.0', info: { title: '简洁约束验收', version: '1' },
  paths: { '/sessions/{session_id}': { post: {
    summary: '更新会话',
    parameters: [{ in: 'path', name: 'session_id', required: true,
      schema: { $ref: '#/components/schemas/ID' } }],
    requestBody: { content: { 'application/json': { schema: fields } } },
    responses: { '200': { description: '成功',
      content: { 'application/json': { schema: fields } } } },
  } } },
  components: { schemas: { ID: id } },
};

test('请求、参数与响应默认隐藏正则，可展开查看，导出保留完整契约', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'specleaf-constraints-'));
  try {
    const entry = join(directory, 'contract.json');
    const html = join(directory, 'api.html');
    await writeFile(entry, JSON.stringify(contract));
    await generate(entry, html);
    await page.goto(pathToFileURL(html).href + '#/operation/post%3A%2Fsessions%2F%7Bsession_id%7D');
    const rows = page.getByRole('row').filter({
      has: page.getByRole('cell', { name: 'session_id', exact: true }),
    });
    await expect(rows).toHaveCount(3);
    for (const row of await rows.all()) {
      await expect(row).toContainText(id.description);
      await expect(row.locator('.constraint-summary')).toHaveText('长度：1–19 字符');
      await expect(row.locator('.constraints')).not.toBeVisible();
      await row.getByText('详细校验规则', { exact: true }).click();
      await expect(row.getByText(pattern, { exact: true })).toBeVisible();
      await expect(row.locator('.constraints')).toContainText('minLength');
      await expect(row.locator('.constraints')).toContainText('maxLength');
      await row.getByText('详细校验规则', { exact: true }).click();
      await expect(row.locator('.constraints')).not.toBeVisible();
    }
    await expect(page.locator('#request .constraint-summary').filter({ hasText: '最小值' }))
      .toHaveText('默认值：0最小值：0最大值：100');
    await expect(page.locator('#request .constraint-summary').filter({ hasText: 'false' }))
      .toHaveText('默认值：false');
    await expect(page.locator('#request .constraint-summary').filter({ hasText: '枚举' }))
      .toContainText('["web","desktop"]');
    const downloaded = page.waitForEvent('download');
    await page.locator('.top-nav').getByRole('button', { name: '导出 OpenAPI' }).click();
    const download = await downloaded;
    expect(JSON.parse(await readFile((await download.path())!, 'utf8'))).toEqual(contract);
    await page.setViewportSize({ width: 390, height: 844 });
    await rows.first().getByText('详细校验规则', { exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
