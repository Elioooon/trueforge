import { HTTPException } from 'hono/http-exception';
import { LRUCache } from 'lru-cache';
import type { ModelProperties } from '../schemas/modelProvider';
import type { TrueFoundryControlPlaneClient } from './TrueFoundryControlPlaneClient';
import {
  indexProviderCatalog,
  mapEnabledModels,
  resolveDefaultGatewayUrl,
  type TrueFoundryEnabledModel,
} from './mapEnabledModels';

const CATALOG_KEY = 'catalog';

export class TrueFoundryTenantCache {
  readonly #client: TrueFoundryControlPlaneClient;
  readonly #tenantNames: LRUCache<string, string>;
  readonly #catalog: LRUCache<string, Map<string, ModelProperties>, { accessToken: string }>;
  readonly #gatewayUrls: LRUCache<string, string, { accessToken: string }>;

  constructor(input: { client: TrueFoundryControlPlaneClient; ttlMs: number }) {
    const { client, ttlMs } = input;
    this.#client = client;

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

    this.#gatewayUrls = new LRUCache<string, string, { accessToken: string }>({
      max: 100,
      ttl: ttlMs,
      fetchMethod: async (_tenantName, _stale, { context }) => {
        return resolveDefaultGatewayUrl(await client.listGatewayInstallations(context.accessToken));
      },
    });
  }

  async getModels(accessToken: string): Promise<TrueFoundryEnabledModel[]> {
    const tenantName = await this.#tenantNames.fetch(accessToken);
    if (tenantName === undefined) {
      throw new HTTPException(401, { message: 'Authentication token required to list or call TrueFoundry models' });
    }
    const context = { accessToken };
    const [integrations, catalog] = await Promise.all([
      this.#client.listProviderIntegrations(accessToken),
      this.#catalog.fetch(CATALOG_KEY, { context }),
      this.#gatewayUrls.fetch(tenantName, { context }),
    ]);
    if (catalog === undefined) {
      throw new HTTPException(502, { message: 'Failed to load TrueFoundry provider catalog' });
    }
    return mapEnabledModels({ integrations, catalog });
  }
}
