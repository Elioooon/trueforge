import type { AgentDefinition, ModelParams, VercelAIProviderConfig } from '@truefoundry/trueforge-core/core';
import type { AvailableModel, ReasoningEffort } from '../schemas/modelProvider';

export interface ResolvedModel {
  providerConfig: VercelAIProviderConfig;
  defaultModelParams: ModelParams;
  modelProperties: AgentDefinition['modelProperties'];
  reasoningEfforts: ReasoningEffort[] | undefined;
}

export interface ModelRegistry {
  listModels(input: { accessToken: string }): Promise<AvailableModel[]>;
  resolveModel(input: { name: string; accessToken: string }): Promise<ResolvedModel>;
}
