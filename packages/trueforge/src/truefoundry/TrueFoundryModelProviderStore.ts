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
import type { TrueFoundryEnabledModel } from './mapEnabledModels';
import { TrueFoundryTenantCache } from './tenantCache';
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
    return this.#records(input);
  }

  async getProvider(
    input: GetModelProviderInput,
    transaction?: TTransaction,
  ): Promise<ModelProviderRecord | undefined> {
    void transaction;
    const records = await this.#records(input);
    return records.find(record => record.name === input.name);
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

  async #records(input: { tenant_id: string; accessToken?: string }): Promise<ModelProviderRecord[]> {
    const accessToken = requireAccessToken(input.accessToken);
    return toRecords({ tenant_id: input.tenant_id, models: await this.#cache.getModels(accessToken) });
  }
}

function toRecords(input: { tenant_id: string; models: TrueFoundryEnabledModel[] }): ModelProviderRecord[] {
  const byAccount = new Map<string, TrueFoundryEnabledModel[]>();
  for (const model of input.models) {
    const existing = byAccount.get(model.accountName);
    if (existing === undefined) {
      byAccount.set(model.accountName, [model]);
    } else {
      existing.push(model);
    }
  }
  const now = new Date().toISOString();
  return [...byAccount.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([accountName, models]) => ({
      tenant_id: input.tenant_id,
      name: accountName,
      manifest: toManifest(models),
      created_at: now,
      updated_at: now,
    }));
}

function toManifest(models: TrueFoundryEnabledModel[]): ModelProviderManifest {
  return {
    type: 'truefoundry',
    models: models.map(model => ({
      name: model.modelName,
      model_id: `${model.accountName}/${model.modelName}`,
      properties: model.properties,
    })),
  };
}
