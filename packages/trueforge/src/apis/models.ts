import { OpenAPIHono } from '@hono/zod-openapi';
import { requireAccessToken } from '../auth/middleware';
import { isTrueFoundryModelRegistryEnabled } from '../config';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { WithTransaction } from '../db/transaction';
import { LocalModelRegistry } from '../model-registry/LocalModelRegistry';
import type { ModelRegistry } from '../model-registry/ModelRegistry';
import { listAvailableModelsRoute } from '../routes/modelRoutes';

/** Chat slim list (mounted at /api/v1/models) — mirrors GET /api/v1/skills. */
export function createModelsRouter<TTransaction>(deps: {
  modelProviderStore: IModelProviderStore<TTransaction>;
  modelRegistry?: ModelRegistry | undefined;
  withTransaction: WithTransaction<TTransaction>;
}) {
  const registry = deps.modelRegistry ?? new LocalModelRegistry(deps.modelProviderStore);
  const router = new OpenAPIHono();
  router.openapi(listAvailableModelsRoute, async c => {
    const accessToken = isTrueFoundryModelRegistryEnabled() ? requireAccessToken(c) : '';
    return c.json({ data: await registry.listModels({ accessToken }) }, 200);
  });
  return router;
}
