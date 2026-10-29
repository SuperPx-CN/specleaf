import type { Contract } from './contract.ts';

// JSON.parse preserves literal keys such as __proto__. Escape raw HTML text so
// even script closing tags in metadata or examples stay inside the data block.
export function serializeContract(document: Contract['document']): string {
  return JSON.stringify(document).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
