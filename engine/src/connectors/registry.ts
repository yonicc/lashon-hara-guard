import type { AnySourceAdapter, NormalizedMessage, RawPlatformEvent } from './types.js';

export class AdapterRegistry {
  private adapters = new Map<string, AnySourceAdapter>();

  register(adapter: AnySourceAdapter): this {
    if (this.adapters.has(adapter.platformId)) throw new Error(`adapter_already_registered:${adapter.platformId}`);
    this.adapters.set(adapter.platformId, adapter);
    return this;
  }

  get(platformId: string): AnySourceAdapter {
    const a = this.adapters.get(platformId);
    if (!a) throw new Error(`adapter_not_found:${platformId}`);
    return a;
  }

  has(platformId: string): boolean { return this.adapters.has(platformId); }
  list(): string[] { return [...this.adapters.keys()].sort(); }

  normalize(platformId: string, raw: RawPlatformEvent): NormalizedMessage {
    return this.get(platformId).normalize(raw);
  }
}

export function createRegistry(adapters: AnySourceAdapter[] = []): AdapterRegistry {
  const r = new AdapterRegistry();
  for (const a of adapters) r.register(a);
  return r;
}
