import { stat } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { contractEntry, DocumentationLoadError, ignoredDirectories, loadDocumentation, moduleEntryNames, type Contract, type Documentation } from './contract.ts';
import { documentationTitle } from '../src/lib/documentation.ts';
import { serializeContract } from './serialize.ts';

const virtualId = 'virtual:openapi';
const resolvedId = '\0' + virtualId;
export function openApiPlugin(provided?: Contract | Documentation): Plugin {
  let root: string;
  let entry: string;
  let contract: Contract | Documentation | undefined;
  let watched = new Set<string>();
  let server: ViteDevServer | undefined;
  let directoryMode = false;
  let stopWatching: (() => void) | undefined;
  function watch(files: string[], directories: string[]) {
    files.forEach((file) => watched.add(resolve(file)));
    server?.watcher.add([...watched, ...directories]);
  }
  async function load() {
    try {
      const result = provided ?? await loadDocumentation(entry);
      contract = result;
      watched = new Set();
      watch(result.files, 'directories' in result ? result.directories : result.files.map(dirname));
      return result;
    } catch (error) {
      if (error instanceof DocumentationLoadError) watch(error.files, error.directories);
      throw error;
    }
  }
  function relevant(file: string, event?: string) {
    file = resolve(file);
    if (watched.has(file) || file === entry) return true;
    if (!directoryMode) return false;
    const path = relative(entry, file);
    if (!path || path === '..' || path.startsWith('..' + sep)) return false;
    const parts = path.split(sep);
    if (parts.some((part) => part.startsWith('.') || ignoredDirectories.has(part))) return false;
    return moduleEntryNames.has(basename(file)) || event === 'addDir' || event === 'unlinkDir';
  }
  return {
    name: 'local-openapi-contract',
    config(config) {
      if (config.server?.watch === null || config.server?.watch?.awaitWriteFinish !== undefined) return;
      // Wait for complete writes and avoid Chokidar dropping a rapid correction
      // during its 50 ms change-event throttle on Linux.
      return { server: { watch: { awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 10 } } } };
    },
    async configResolved(config) {
      root = config.root;
      entry = provided?.entry ?? contractEntry(root);
      directoryMode = await stat(entry).then((value) => value.isDirectory(), () => false);
    },
    async buildStart() {
      try {
        const result = await load();
        result.files.forEach((file) => this.addWatchFile(file));
        this.info(`已读取 ${result.files.length} 个本地契约文件`);
      } catch (error) {
        if (!server) throw error;
        // Serve the error through the virtual module while keeping the dev watcher alive.
        this.warn((error as Error).message);
      }
    },
    configureServer(value) {
      server = value;
      server.watcher.add([entry, dirname(entry)]);
      let timer: ReturnType<typeof setTimeout>;
      // Serialize reloads and rescan after changes during parsing, so old reads cannot win a race.
      let running = false;
      let pending = false;
      let closed = false;
      const reload = async () => {
        pending = true;
        if (running || closed) return;
        running = true;
        while (pending && !closed) {
          pending = false;
          contract = undefined;
          try {
            await load();
            if (closed) break;
            const module = server!.moduleGraph.getModuleById(resolvedId);
            if (module) server!.moduleGraph.invalidateModule(module);
            server!.ws.send({ type: 'full-reload' });
          } catch (error) {
            if (closed) break;
            server!.config.logger.error((error as Error).message);
            const module = server!.moduleGraph.getModuleById(resolvedId);
            if (module) server!.moduleGraph.invalidateModule(module);
            server!.ws.send({ type: 'error', err: { message: (error as Error).message, stack: '' } });
          }
        }
        running = false;
      };
      const change = (event: string, file: string) => {
        if (!relevant(file, event)) return;
        clearTimeout(timer);
        timer = setTimeout(() => { void reload(); }, 120);
      };
      server.watcher.on('all', change);
      stopWatching = () => {
        closed = true;
        clearTimeout(timer);
        server!.watcher.off('all', change);
      };
    },
    closeBundle() { stopWatching?.(); },
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    async load(id) {
      if (id !== resolvedId) return;
      const result = contract ?? (await load());
      return `export default JSON.parse(${JSON.stringify(serializeContract(result.document))});`;
    },
    transformIndexHtml(html) {
      if (!contract) return html;
      const escape = (value: string) => value.replace(/[&<>"']/g, (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
      );
      return html.replace('<title>OpenAPI 文档</title>', () =>
        `<title>${escape(documentationTitle(contract!.document))} · API 文档</title>`,
      );
    },
    async watchChange(id) {
      if (relevant(id)) contract = undefined;
    },
    handleHotUpdate(context) {
      if (relevant(context.file)) return [];
    },
  };
}
