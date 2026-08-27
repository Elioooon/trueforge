import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'winston';
import type { ModelRegistry, ResolvedModel } from '../model-registry/ModelRegistry';
import type { AvailableModel } from '../schemas/modelProvider';
import { TrueFoundryControlPlaneClient } from './TrueFoundryControlPlaneClient';
import { TRUEFOUNDRY_MODEL_PROVIDER_NAME } from './mapEnabledModels';
import { TrueFoundryTenantCache } from './tenantCache';

export class TrueFoundryModelRegistry implements ModelRegistry {
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

  async listModels(input: { accessToken: string }): Promise<AvailableModel[]> {
    const bundle = await this.#cache.getBundle(input.accessToken);
    return bundle.models;
  }

  async resolveModel(input: { name: string; accessToken: string }): Promise<ResolvedModel> {
    const bundle = await this.#cache.getBundle(input.accessToken);
    const model = bundle.models.find(entry => entry.name === input.name);
    if (model === undefined) {
      throw new HTTPException(422, {
        message: `Unknown model "${input.name}" — not in the TrueFoundry catalog`,
      });
    }
    return {
      providerConfig: {
        provider: { type: 'truefoundry', name: TRUEFOUNDRY_MODEL_PROVIDER_NAME },
        model: { id: model.model_id, name: model.model_id },
        name: input.name,
        baseUrl: bundle.gatewayUrl,
        apiKey: input.accessToken,
        headers: {},
      },
      defaultModelParams: model.properties.max_output_tokens ? { max_tokens: model.properties.max_output_tokens } : {},
      modelProperties: { contextLength: model.properties.context_length },
      reasoningEfforts: model.properties.reasoning_efforts,
    };
  }
}
