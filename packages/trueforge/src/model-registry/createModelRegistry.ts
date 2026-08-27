import type { Logger } from 'winston';
import configuration, { isTrueFoundryModelRegistryEnabled } from '../config';
import type { IModelProviderStore } from '../db/modelProviderStore';
import { TrueFoundryModelRegistry } from '../truefoundry/TrueFoundryModelRegistry';
import { LocalModelRegistry } from './LocalModelRegistry';
import type { ModelRegistry } from './ModelRegistry';

export function createModelRegistry(store: IModelProviderStore, logger?: Logger): ModelRegistry {
  if (isTrueFoundryModelRegistryEnabled(configuration)) {
    return new TrueFoundryModelRegistry({
      controlPlaneUrl: configuration.TRUEFOUNDRY_REGISTRY.controlPlaneUrl,
      cacheTtlMs: configuration.TRUEFOUNDRY_REGISTRY.cacheTtlSeconds * 1000,
      ...(logger === undefined ? {} : { logger }),
    });
  }
  return new LocalModelRegistry(store);
}
