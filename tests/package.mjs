import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, copyFile, cp, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, '通过 npm run test:package 执行验收');
const directory = await mkdtemp(join(tmpdir(), 'specleaf-package-'));
const env = {
  ...process.env,
  npm_config_cache: process.env.npm_config_cache || join(directory, 'cache'),
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  npm_config_update_notifier: 'false',
};
const npm = (cwd, ...args) => exec(process.execPath, [npmCli, ...args], { cwd, env, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
const cli = (cwd, file, ...args) => exec(process.execPath, [file, ...args], { cwd, env, timeout: 30000 });
const base = { openapi: '3.1.0', info: { title: '安装验收', version: '1' }, paths: {} };
const readDocument = async (path) => {
  const html = await readFile(path, 'utf8');
  assert.equal((html.match(/<\/script>/g) || []).length, 2);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+(?:stylesheet|modulepreload)/i);
  assert.match(html, /data:image\/svg\+xml,/);
  return JSON.parse(html.match(/<script id="specleaf-contract" type="application\/json">(.*?)<\/script>/s)[1]);
};
async function fails(cwd, file, args, pattern) {
  await assert.rejects(cli(cwd, file, ...args), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, pattern);
    return true;
  });
}

try {
  // Use an actual archive (prepack runs), never a symlink to the source checkout.
  process.stdout.write('打包并检查文件白名单…\n');
  const { stdout } = await npm(root, 'pack', '--json', '--pack-destination', directory);
  const packed = JSON.parse(stdout)[0];
  const expected = ['LICENSE', 'README.md', 'lib/assets/favicon.svg', 'lib/assets/ui.css', 'lib/assets/ui.js', 'lib/cli.js', 'package.json'];
  assert.deepEqual(packed.files.map((file) => file.path).sort(), expected.sort());
  // Windows records readable file bits; executable commands use npm's .cmd shim.
  const commandMode = process.platform === 'win32' ? 0o444 : 0o111;
  assert.ok(packed.files.find((file) => file.path === 'lib/cli.js').mode & commandMode);
  const tarball = join(directory, packed.filename);

  const consumer = join(directory, '独立 中文 项目');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    private: true,
    scripts: { generate: 'specleaf "契约 文件.json" -o "输出 目录/script.html"' },
  }));
  await writeFile(join(consumer, '契约 文件.json'), JSON.stringify(base));
  await copyFile(join(root, 'examples/minimal.json'), join(consumer, 'minimal.json'));
  await writeFile(join(consumer, '入口.yaml'), `openapi: 3.0.3\ninfo:\n  title: 跨文件递归安装验收\n  version: '1'\npaths: {}\ncomponents:\n  schemas:\n    Tree:\n      $ref: './模型 文件.json#/Tree'\n`);
  await writeFile(join(consumer, '模型 文件.json'), JSON.stringify({ Tree: { type: 'object', properties: { child: { $ref: '#/Tree' } } } }));
  process.stdout.write('独立目录安装：--omit=dev --ignore-scripts…\n');
  await npm(consumer, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', tarball);
  const installed = join(consumer, 'node_modules/specleaf');
  assert.equal((await lstat(installed)).isSymbolicLink(), false);
  assert.deepEqual((await readdir(installed)).sort(), ['LICENSE', 'README.md', 'lib', 'package.json']);
  for (const dependency of ['vite', 'react', 'react-dom', 'typescript', 'lucide-react', 'vitest', '@vitejs/plugin-react'])
    await assert.rejects(access(join(consumer, 'node_modules', dependency)));
  const installedManifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(installedManifest.dependencies), ['@apidevtools/json-schema-ref-parser']);
  const executable = join(installed, installedManifest.bin.specleaf);
  assert.match(await readFile(executable, 'utf8'), /^#!\/usr\/bin\/env node\r?\n/);
  if (process.platform === 'win32') {
    const shim = await readFile(join(consumer, 'node_modules/.bin/specleaf.cmd'), 'utf8');
    assert.match(shim, /specleaf[\\/]lib[\\/]cli\.js/);
  }

  process.stdout.write('验收 npm scripts、npm exec、npx、临时全局安装…\n');
  const nested = join(consumer, 'nested');
  await mkdir(nested);
  // npm scripts run at the consumer project root even when invoked in a subdirectory.
  await npm(nested, 'run', 'generate');
  assert.deepEqual(await readDocument(join(consumer, '输出 目录/script.html')), base);
  await npm(consumer, 'exec', '--offline', '--', 'specleaf', '入口.yaml', '-o', '输出 目录/引用.html');
  const recursive = await readDocument(join(consumer, '输出 目录/引用.html'));
  assert.equal(recursive.components.schemas.Tree.properties.child.$ref, '#/components/schemas/Tree');
  await cp(join(root, 'tests/fixtures/modules'), join(consumer, 'modules'), { recursive: true });
  await copyFile(join(root, 'tests/fixtures/module-models.json'), join(consumer, 'module-models.json'));
  const modulesOutput = join(consumer, '输出 目录/modules.html');
  await npm(consumer, 'exec', '--offline', '--', 'specleaf', 'modules', '-o', modulesOutput);
  const collection = await readDocument(modulesOutput);
  assert.equal(collection.kind, 'specleaf/modules');
  assert.deepEqual(collection.modules.map((module) => module.id), ['.', 'team', 'team/子目录 space%/leaf']);
  assert.deepEqual(collection.modules.map((module) => module.document.openapi), ['3.0.3', '3.1.0', '3.1.1']);
  assert.equal(collection.modules[0].document.paths['/items'].post.summary, '根模块创建');
  assert.equal(collection.modules[1].document.paths['/items'].post.summary, '团队模块创建');
  assert.doesNotMatch(JSON.stringify(collection), /module-models.json/);
  for (const source of ['modules/openapi.yaml', 'modules/team/openapi.yml', 'modules/team/子目录 space%/leaf/openapi.json', 'module-models.json']) {
    const original = await readFile(join(consumer, source), 'utf8');
    await fails(consumer, executable, ['modules', '-o', source], /禁止输出覆盖入口或引用文件/);
    assert.equal(await readFile(join(consumer, source), 'utf8'), original);
  }
  const previousModules = await readFile(modulesOutput, 'utf8');
  await writeFile(join(consumer, 'modules/team/openapi.json'), JSON.stringify(base));
  await fails(consumer, executable, ['modules', '-o', modulesOutput], /多个 OpenAPI 入口/);
  assert.equal(await readFile(modulesOutput, 'utf8'), previousModules);
  await rm(join(consumer, 'modules/team/openapi.json'));
  await cp(join(root, 'tests/fixtures/backrefs'), join(consumer, 'backrefs'), { recursive: true });
  for (const input of ['backrefs/openapi.yaml', 'backrefs']) {
    const output = join(consumer, '输出 目录/backrefs.html');
    await cli(consumer, executable, input, '-o', output);
    const data = await readDocument(output);
    const document = data.modules ? data.modules[0].document : data;
    assert.match(document.paths['/items'].parameters[0].$ref, /^#/);
    assert.match(document.paths['/items'].get.responses['200'].$ref, /^#/);
    assert.equal(document.components.requestBodies.Item.content['application/json'].example.$ref, '../openapi.yaml#/components/parameters/Page');
  }
  const npxCli = join(dirname(npmCli), 'npx-cli.js');
  await exec(process.execPath, [npxCli, '--offline', 'specleaf', 'minimal.json'], { cwd: consumer, env, timeout: 30000 });
  assert.equal((await readDocument(join(consumer, 'openapi.html'))).openapi, '3.0.3');

  // Also exercise npx's temporary package install, without an installed local CLI.
  const transient = join(directory, '临时 调用');
  await mkdir(transient);
  await writeFile(join(transient, 'api.json'), JSON.stringify(base));
  await exec(process.execPath, [npxCli, '--yes', '--offline', '--ignore-scripts', `--package=${tarball}`, 'specleaf', 'api.json'], { cwd: transient, env, timeout: 180000 });
  assert.deepEqual(await readDocument(join(transient, 'openapi.html')), base);

  const prefix = join(directory, 'global');
  await npm(consumer, 'install', '--global', '--prefix', prefix, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', tarball);
  const globalBin = process.platform === 'win32' ? prefix : join(prefix, 'bin');
  const shellEnv = { ...env, PATH: `${globalBin}${delimiter}${env.PATH || env.Path || ''}` };
  // Resolve the installed command by PATH, including the Windows npm .cmd shim.
  const command = process.platform === 'win32' ? 'specleaf.cmd' : 'specleaf';
  await exec(command, ['api.json', '--output=global.html'], { cwd: transient, env: shellEnv, shell: process.platform === 'win32', timeout: 30000 });
  assert.deepEqual(await readDocument(join(transient, 'global.html')), base);

  process.stdout.write('验收帮助、版本、失败退出、源文件保护和注入字符…\n');
  for (const option of ['-v', '--version'])
    assert.equal((await cli(consumer, executable, option)).stdout.trim(), manifest.version);
  for (const option of ['-h', '--help'])
    assert.match((await cli(consumer, executable, option)).stdout, /用法：specleaf <input>/);
  for (const args of [[], ['--unknown'], ['契约 文件.json', '-o'], ['契约 文件.json', 'extra.json']])
    await fails(consumer, executable, args, /错误：/);
  const model = join(consumer, '模型 文件.json');
  const original = await readFile(model, 'utf8');
  await symlink(model, join(consumer, 'symbolic.html'), 'file');
  await link(model, join(consumer, 'hard.html'));
  for (const output of ['入口.yaml', '模型 文件.json', 'symbolic.html', 'hard.html'])
    await fails(consumer, executable, ['入口.yaml', '-o', output], /禁止输出覆盖入口或引用文件/);
  assert.equal(await readFile(model, 'utf8'), original);

  const previous = join(consumer, 'previous.html');
  await writeFile(previous, 'previous document');
  const bad = join(consumer, 'bad.json');
  for (const document of [
    { ...base, openapi: '2.0' },
    { ...base, components: { schemas: { X: { $ref: './missing.json#/X' } } } },
    { ...base, components: { schemas: { X: { $ref: 'https://example.invalid/remote.json#/X' } } } },
  ]) {
    await writeFile(bad, JSON.stringify(document));
    await fails(consumer, executable, [bad, '-o', previous], /OpenAPI 契约解析失败/);
    assert.equal(await readFile(previous, 'utf8'), 'previous document');
  }
  await fails(consumer, executable, ['https://example.invalid/openapi.yaml'], /入口必须是本地/);
  await mkdir(join(consumer, 'blocked.html'));
  await writeFile(join(consumer, 'blocked.html/keep.txt'), 'keep');
  await fails(consumer, executable, ['契约 文件.json', '-o', 'blocked.html'], /HTML 生成或写入失败/);
  assert.equal(await readFile(join(consumer, 'blocked.html/keep.txt'), 'utf8'), 'keep');
  assert.ok(!(await readdir(consumer)).some((file) => file.endsWith('.tmp')));

  const payload = '</sCrIpT><script>globalThis.INJECTED=true</script><!--<script> & > \u2028\u2029';
  const special = { ...base, info: { title: payload, version: '1', description: '" <meta name="injected">' }, 'x-example': JSON.parse('{"__proto__":{"polluted":true}}'), paths: { '/safe': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { example: payload } } } } } } } };
  await writeFile(join(consumer, 'special.json'), JSON.stringify(special));
  await cli(consumer, executable, 'special.json', '-o', previous);
  assert.deepEqual(await readDocument(previous), special);
  const html = await readFile(previous, 'utf8');
  assert.match(html, /&lt;\/sCrIpT&gt;/);
  assert.doesNotMatch(html.match(/<script id="specleaf-contract" type="application\/json">(.*?)<\/script>/s)[1], /[<>&\u2028\u2029]/);
  process.stdout.write(`包安装验收通过：${manifest.name}@${manifest.version}（Node ${process.versions.node}，${process.platform}）\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
