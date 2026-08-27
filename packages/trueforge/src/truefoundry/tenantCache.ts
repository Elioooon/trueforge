import { HTTPException } from 'hono/http-exception';
import type { AvailableModel, ModelProperties } from '../schemas/modelProvider';
import type { TrueFoundryControlPlaneClient } from './TrueFoundryControlPlaneClient';
import { indexProviderCatalog, mapEnabledModels, resolveDefaultGatewayUrl } from './mapEnabledModels';

export interface TenantModelBundle {
  models: AvailableModel[];
  gatewayUrl: string;
}

interface Timed<T> {
  value: T;
  expiresAt: number;
}

export class TrueFoundryTenantCache {
  readonly #client: TrueFoundryControlPlaneClient;
  readonly #ttlMs: number;
  readonly #tenantNames = new Map<string, Timed<string>>();
  readonly #bundles = new Map<string, Timed<TenantModelBundle>>();
  #catalog: Timed<Map<string, ModelProperties>> | undefined;
  readonly #inflightTenantNames = new Map<string, Promise<string>>();
  readonly #inflightBundles = new Map<string, Promise<TenantModelBundle>>();
  #inflightCatalog: Promise<Map<string, ModelProperties>> | undefined;

  constructor(input: { client: TrueFoundryControlPlaneClient; ttlMs: number }) {
    this.#client = input.client;
    this.#ttlMs = input.ttlMs;
  }

  async getBundle(accessToken: string): Promise<TenantModelBundle> {
    const tenantName = await this.#tenantName(accessToken);
    const cached = this.#read(this.#bundles, tenantName);
    if (cached !== undefined) {
      return cached;
    }
    const inflight = this.#inflightBundles.get(tenantName);
    if (inflight !== undefined) {
      return inflight;
    }
    const pending = this.#loadBundle({ accessToken, tenantName }).finally(() => {
      this.#inflightBundles.delete(tenantName);
    });
    this.#inflightBundles.set(tenantName, pending);
    return pending;
  }

  async #tenantName(accessToken: string): Promise<string> {
    const cached = this.#read(this.#tenantNames, accessToken);
    if (cached !== undefined) {
      return cached;
    }
    const inflight = this.#inflightTenantNames.get(accessToken);
    if (inflight !== undefined) {
      return inflight;
    }
    const pending = this.#loadTenantName(accessToken).finally(() => {
      this.#inflightTenantNames.delete(accessToken);
    });
    this.#inflightTenantNames.set(accessToken, pending);
    return pending;
  }

  async #loadTenantName(accessToken: string): Promise<string> {
    const session = await this.#client.getSession(accessToken);
    if (session === undefined) {
      throw new HTTPException(401, { message: 'Authentication token required to list or call TrueFoundry models' });
    }
    this.#tenantNames.set(accessToken, { value: session.tenantName, expiresAt: Date.now() + this.#ttlMs });
    return session.tenantName;
  }

  async #loadBundle(input: { accessToken: string; tenantName: string }): Promise<TenantModelBundle> {
    const [integrations, catalog, installations] = await Promise.all([
      this.#client.listProviderIntegrations(input.accessToken),
      this.#providerCatalog(input.accessToken),
      this.#client.listGatewayInstallations(input.accessToken),
    ]);
    const bundle: TenantModelBundle = {
      models: mapEnabledModels({ integrations, catalog }),
      gatewayUrl: resolveDefaultGatewayUrl(installations),
    };
    this.#bundles.set(input.tenantName, { value: bundle, expiresAt: Date.now() + this.#ttlMs });
    return bundle;
  }

  async #providerCatalog(accessToken: string): Promise<Map<string, ModelProperties>> {
    if (this.#catalog !== undefined && this.#catalog.expiresAt > Date.now()) {
      return this.#catalog.value;
    }
    if (this.#inflightCatalog !== undefined) {
      return this.#inflightCatalog;
    }
    this.#inflightCatalog = this.#client
      .listProviderCatalog(accessToken)
      .then(payload => {
        const indexed = indexProviderCatalog(payload);
        this.#catalog = { value: indexed, expiresAt: Date.now() + this.#ttlMs };
        return indexed;
      })
      .finally(() => {
        this.#inflightCatalog = undefined;
      });
    return this.#inflightCatalog;
  }

  #read<T>(store: Map<string, Timed<T>>, key: string): T | undefined {
    const entry = store.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  }
}
