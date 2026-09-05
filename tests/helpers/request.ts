import { exports } from 'cloudflare:workers';

export function request(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(`https://files.example${path}`, init);
}

export const auth = { 'x-client-secret': 'test-secret' };
