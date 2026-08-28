import { HTTPException } from 'hono/http-exception';
import { LRUCache } from 'lru-cache';
import type { AvailableModel, ModelProperties } from '../schemas/modelProvider';
import type { TrueFoundryControlPlaneClient } from './TrueFoundryControlPlaneClient';
import { indexProviderCatalog, mapEnabledModels, resolveDefaultGatewayUrl } from './mapEnabledModels';

export interface TenantModelBundle {
  models: AvailableModel[];
  gatewayUrl: string;
}

const CATALOG_KEY = 'catalog';

export class TrueFoundryTenantCache {
  readonly #tenantNames: LRUCache<string, string>;
  readonly #bundles: LRUCache<string, TenantModelBundle, { accessToken: string }>;
  readonly #catalog: LRUCache<string, Map<string, ModelProperties>, { accessToken: string }>;

  constructor(input: { client: TrueFoundryControlPlaneClient; ttlMs: number }) {
    const { client, ttlMs } = input;

    this.#tenantNames = new LRUCache<string, string>({
      max: 500,
      ttl: ttlMs,
      fetchMethod: async accessToken => {
        const session = await client.getSession(accessToken);
        if (session === undefined) {
          throw new HTTPException(401, { message: 'Authentication token required to list or call TrueFoundry models' });
        }
        return session.tenantName;
      },
    });

    this.#catalog = new LRUCache<string, Map<string, ModelProperties>, { accessToken: string }>({
      max: 1,
      ttl: ttlMs,
      fetchMethod: async (_key, _stale, { context }) => {
        return indexProviderCatalog(await client.listProviderCatalog(context.accessToken));
      },
    });

    this.#bundles = new LRUCache<string, TenantModelBundle, { accessToken: string }>({
      max: 100,
      ttl: ttlMs,
      fetchMethod: async (_tenantName, _stale, { context }) => {
        const [integrations, catalog, installations] = await Promise.all([
          client.listProviderIntegrations(context.accessToken),
          this.#catalog.fetch(CATALOG_KEY, { context }),
          client.listGatewayInstallations(context.accessToken),
        ]);
        if (catalog === undefined) {
          throw new HTTPException(502, { message: 'Failed to load TrueFoundry provider catalog' });
        }
        return {
          models: mapEnabledModels({ integrations, catalog }),
          gatewayUrl: resolveDefaultGatewayUrl(installations),
        };
      },
    });
  }

  async getBundle(accessToken: string): Promise<TenantModelBundle> {
    const tenantName = await this.#tenantNames.fetch(accessToken);
    if (tenantName === undefined) {
      throw new HTTPException(401, { message: 'Authentication token required to list or call TrueFoundry models' });
    }
    const bundle = await this.#bundles.fetch(tenantName, { context: { accessToken } });
    if (bundle === undefined) {
      throw new HTTPException(502, { message: 'Failed to load TrueFoundry models' });
    }
    return bundle;
  }
}
