import { operationIdFromHash, type ApiObject } from './openapi.ts';

export interface DocumentationModule {
  id: string;
  document: ApiObject;
}
export interface ModuleCollection {
  kind: 'specleaf/modules';
  title: string;
  modules: DocumentationModule[];
}
export type DocumentationDocument = ApiObject | ModuleCollection;

export function isModuleCollection(document: DocumentationDocument): document is ModuleCollection {
  return document.kind === 'specleaf/modules' && Array.isArray(document.modules) && !('openapi' in document);
}
export function documentationTitle(document: DocumentationDocument): string {
  return isModuleCollection(document) ? document.title : document.info.title;
}
export const overviewHash = (moduleId?: string) => moduleId === undefined
  ? '#/overview' : `#/module/${encodeURIComponent(moduleId)}/overview`;

export interface DocumentationRoute {
  moduleId?: string;
  operationId?: string;
  invalid: boolean;
}
// Decode each segment separately so encoded slashes stay within a module/operation ID.
export function documentationRoute(hash: string, modules?: DocumentationModule[]): DocumentationRoute {
  const empty = ['', '#', '#/'].includes(hash);
  if (!modules) {
    const operationId = operationIdFromHash(hash);
    return { operationId, invalid: !empty && hash !== '#/overview' && operationId === undefined };
  }
  if (empty) return { moduleId: modules[0]?.id, invalid: false };
  const match = /^#\/module\/([^/]+)\/(overview|operation\/([^/]+))$/.exec(hash);
  try {
    if (match) return {
      moduleId: decodeURIComponent(match[1]),
      operationId: match[3] === undefined ? undefined : decodeURIComponent(match[3]),
      invalid: false,
    };
  } catch { /* Malformed URI escapes are invalid links. */ }
  return { invalid: true };
}
