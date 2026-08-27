import { TENANT_ID } from '../apis/sessions';
import type { IModelProviderStore } from '../db/modelProviderStore';
import { getModelDetails } from '../runtime/sessionResources';
import type { AvailableModel } from '../schemas/modelProvider';
import type { ModelRegistry, ResolvedModel } from './ModelRegistry';

export class LocalModelRegistry implements ModelRegistry {
  readonly #store: IModelProviderStore;

  constructor(store: IModelProviderStore) {
    this.#store = store;
  }

  listModels(input: { accessToken: string }): Promise<AvailableModel[]> {
    void input;
    return this.#store.listModels(TENANT_ID);
  }

  async resolveModel(input: { name: string; accessToken: string }): Promise<ResolvedModel> {
    const details = await getModelDetails({
      tenant_id: TENANT_ID,
      name: input.name,
      store: this.#store,
    });
    return details;
  }
}
