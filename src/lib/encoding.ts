export const MD5_PATTERN = /^[0-9a-fA-F]{32}$/;

export function normalizeHash(hash: string): string {
  if (hash.length !== 32 || !MD5_PATTERN.test(hash)) throw new TypeError('Invalid MD5 hash');
  return hash.toLowerCase();
}

export function encodeBase64(buffer: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function hexToBase64(hash: string): string {
  const normalized = normalizeHash(hash);
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return encodeBase64(bytes.buffer);
}
