import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'winston';
import {
  flattenProviderModels,
  ModelProviderStoreNotImplementedError,
  type CreateModelProviderInput,
  type GetModelProviderInput,
  type IModelProviderStore,
  type ListModelProvidersInput,
  type ModelProviderRecord,
  type UpsertModelProviderInput,
} from '../db/modelProviderStore';
import type { AvailableModel, ModelProviderManifest } from '../schemas/modelProvider';
import { TRUEFOUNDRY_MODEL_PROVIDER_NAME } from './mapEnabledModels';
import { TrueFoundryTenantCache, type TenantModelBundle } from './tenantCache';
import { TrueFoundryControlPlaneClient } from './TrueFoundryControlPlaneClient';

function requireAccessToken(accessToken: string | undefined): string {
  if (accessToken === undefined || accessToken.length === 0) {
    throw new HTTPException(401, { message: 'Authentication token required to list or call TrueFoundry models' });
  }
  return accessToken;
}

function notImplemented(operation: string): never {
  throw new ModelProviderStoreNotImplementedError(operation);
}

export class TrueFoundryModelProviderStore<TTransaction = never> implements IModelProviderStore<TTransaction> {
  readonly #cache: TrueFoundryTenantCache;

  constructor(input: { controlPlaneUrl: string; cacheTtlMs: number; logger?: Logger }) {
    this.#cache = new TrueFoundryTenantCache({
      client: new TrueFoundryControlPlaneClient({
        controlPlaneUrl: input.controlPlaneUrl,
        ...(input.logger === undefined ? {} : { logger: input.logger }),
      }),
      ttlMs: input.cacheTtlMs,
    });
  }

  async listProviders(input: ListModelProvidersInput, transaction?: TTransaction): Promise<ModelProviderRecord[]> {
    void transaction;
    return [await this.#record(input)];
  }

  async getProvider(
    input: GetModelProviderInput,
    transaction?: TTransaction,
  ): Promise<ModelProviderRecord | undefined> {
    void transaction;
    if (input.name !== TRUEFOUNDRY_MODEL_PROVIDER_NAME) {
      return undefined;
    }
    return this.#record(input);
  }

  getProviderForUpdate(
    _input: GetModelProviderInput,
    _transaction: TTransaction,
  ): Promise<ModelProviderRecord | undefined> {
    return notImplemented('getProviderForUpdate');
  }

  createProvider(_input: CreateModelProviderInput, _transaction?: TTransaction): Promise<ModelProviderRecord> {
    return notImplemented('createProvider');
  }

  upsertProvider(_input: UpsertModelProviderInput, _transaction?: TTransaction): Promise<ModelProviderRecord> {
    return notImplemented('upsertProvider');
  }

  async listModels(input: ListModelProvidersInput, transaction?: TTransaction): Promise<AvailableModel[]> {
    return flattenProviderModels(await this.listProviders(input, transaction));
  }

  async #record(input: { tenant_id: string; accessToken?: string }): Promise<ModelProviderRecord> {
    const accessToken = requireAccessToken(input.accessToken);
    const bundle = await this.#cache.getBundle(accessToken);
    const now = new Date().toISOString();
    return {
      tenant_id: input.tenant_id,
      name: TRUEFOUNDRY_MODEL_PROVIDER_NAME,
      manifest: toManifest({ bundle, accessToken }),
      created_at: now,
      updated_at: now,
    };
  }
}

function toManifest(input: { bundle: TenantModelBundle; accessToken: string }): ModelProviderManifest {
  return {
    type: 'truefoundry',
    base_url: input.bundle.gatewayUrl,
    auth: { api_key: input.accessToken },
    models: input.bundle.models.map(model => ({
      model_id: model.model_id,
      name: model.model_id,
      properties: model.properties,
    })),
  };
}
