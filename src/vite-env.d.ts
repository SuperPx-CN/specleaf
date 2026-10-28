/// <reference types="vite/client" />
declare module 'virtual:openapi' {
  const document: import('./lib/openapi').ApiObject;
  export default document;
}
