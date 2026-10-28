import { dirname, resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { contractEntry, loadContract, type Contract } from './contract.ts';

const virtualId = 'virtual:openapi';
const resolvedId = '\0' + virtualId;
// JSON.parse preserves literal keys such as __proto__; escaping < keeps HTML raw text safe.
export function serializeContract(document: Contract['document']): string {
  const json = JSON.stringify(document).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return JSON.stringify(json);
}
export function openApiPlugin(provided?: Contract): Plugin {
  let root: string;
  let entry: string;
  let contract: Contract | undefined;
  let watched = new Set<string>();
  let server: ViteDevServer | undefined;
  async function load() {
    const result = provided ?? await loadContract(entry);
    contract = result;
    watched = new Set(result.files.map((file) => resolve(file)));
    if (server) server.watcher.add([...watched, ...[...watched].map(dirname)]);
    return result;
  }
  return {
    name: 'local-openapi-contract',
    configResolved(config) {
      root = config.root;
      entry = provided?.entry ?? contractEntry(root);
    },
    async buildStart() {
      const result = await load();
      result.files.forEach((file) => this.addWatchFile(file));
      this.info(`已读取 ${result.files.length} 个本地契约文件`);
    },
    configureServer(value) {
      server = value;
      server.watcher.add(entry);
    },
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    async load(id) {
      if (id !== resolvedId) return;
      const result = contract ?? (await load());
      return `export default JSON.parse(${serializeContract(result.document)});`;
    },
    transformIndexHtml(html) {
      if (!contract) return html;
      const escape = (value: string) => value.replace(/[&<>"']/g, (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
      );
      return html.replace('<title>OpenAPI 文档</title>', () =>
        `<title>${escape(contract!.document.info.title)} · API 文档</title>`,
      );
    },
    async watchChange(id) {
      if (watched.has(resolve(id)) || resolve(id) === entry) contract = undefined;
    },
    async handleHotUpdate(context) {
      if (!watched.has(resolve(context.file)) && resolve(context.file) !== entry) return;
      contract = undefined;
      try {
        await load();
        const module = context.server.moduleGraph.getModuleById(resolvedId);
        if (module) context.server.moduleGraph.invalidateModule(module);
        context.server.ws.send({ type: 'full-reload' });
      } catch (error) {
        context.server.ws.send({
          type: 'error',
          err: { message: (error as Error).message, stack: '' },
        });
      }
      return [];
    },
  };
}
