/// <reference types="vite/client" />
declare module 'virtual:openapi' {
  const document: import('./lib/documentation').DocumentationDocument;
  export default document;
}
