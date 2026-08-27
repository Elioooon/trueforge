import { SUPPORTED_REASONING_EFFORTS } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { isLoopbackHostname, normalizeHttpUrl } from '../config';
import type { AvailableModel, ModelProperties, ReasoningEffort } from '../schemas/modelProvider';

const SUPPORTED_EFFORTS = new Set<string>(SUPPORTED_REASONING_EFFORTS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function catalogKey(provider: string, model: string): string {
  return `${provider}\0${model}`;
}

function toReasoningEfforts(params: unknown): ReasoningEffort[] | undefined {
  if (!Array.isArray(params)) {
    return undefined;
  }
  const matched: ReasoningEffort[] = [];
  for (const param of params) {
    if (!isRecord(param) || param['key'] !== 'reasoning_effort' || !Array.isArray(param['supportedValues'])) {
      continue;
    }
    for (const value of param['supportedValues']) {
      if (typeof value === 'string' && SUPPORTED_EFFORTS.has(value)) {
        const effort: ReasoningEffort | undefined = SUPPORTED_REASONING_EFFORTS.find(item => item === value);
        if (effort !== undefined && !matched.includes(effort)) {
          matched.push(effort);
        }
      }
    }
  }
  return matched.length > 0 ? matched : undefined;
}

function toProperties(entry: Record<string, unknown>): ModelProperties {
  const limits = isRecord(entry['limits']) ? entry['limits'] : {};
  const contextLength = readNumber(limits['context_window']) ?? readNumber(limits['max_input_tokens']);
  const maxOutputTokens = readNumber(limits['max_output_tokens']) ?? readNumber(limits['max_tokens']);
  const reasoningEfforts = toReasoningEfforts(entry['params']);
  return {
    ...(contextLength === undefined ? {} : { context_length: contextLength }),
    ...(maxOutputTokens === undefined ? {} : { max_output_tokens: maxOutputTokens }),
    ...(reasoningEfforts === undefined ? {} : { reasoning_efforts: reasoningEfforts }),
  };
}

/** Index template catalog metadata by `(provider, model)` for property join. */
export function indexProviderCatalog(payload: unknown): Map<string, ModelProperties> {
  const items = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload['data'])
      ? payload['data']
      : [];
  const index = new Map<string, ModelProperties>();
  for (const account of items) {
    if (!isRecord(account) || !Array.isArray(account['integrations'])) {
      continue;
    }
    for (const integration of account['integrations']) {
      if (!isRecord(integration) || !isRecord(integration['metadata'])) {
        continue;
      }
      for (const entry of Object.values(integration['metadata'])) {
        if (!isRecord(entry)) {
          continue;
        }
        const provider = readString(entry['provider']);
        const model = readString(entry['model']);
        if (provider === undefined || model === undefined) {
          continue;
        }
        index.set(catalogKey(provider, model), toProperties(entry));
      }
    }
  }
  return index;
}

function isChatModelTypes(value: unknown): boolean {
  return Array.isArray(value) && value.some(entry => entry === 'chat');
}

/** Listing FQN prefix and well-known adapter type: `truefoundry/{account}/{name}`. */
export const TRUEFOUNDRY_MODEL_PROVIDER_NAME = 'truefoundry';

export function mapEnabledModels(input: {
  integrations: readonly unknown[];
  catalog: Map<string, ModelProperties>;
}): AvailableModel[] {
  const models: AvailableModel[] = [];
  const seen = new Set<string>();
  for (const row of input.integrations) {
    if (!isRecord(row)) {
      continue;
    }
    const manifest = isRecord(row['manifest']) ? row['manifest'] : {};
    if (!isChatModelTypes(manifest['model_types'])) {
      continue;
    }
    const account = isRecord(row['providerAccount']) ? row['providerAccount'] : {};
    const accountName = readString(account['name']);
    const modelName = readString(row['name']);
    if (accountName === undefined || modelName === undefined) {
      continue;
    }
    const gatewayId = `${accountName}/${modelName}`;
    if (seen.has(gatewayId)) {
      continue;
    }
    seen.add(gatewayId);
    const modelId = readString(manifest['model_id']);
    const catalogProvider = readString(account['provider']);
    const properties =
      catalogProvider === undefined || modelId === undefined
        ? {}
        : (input.catalog.get(catalogKey(catalogProvider, modelId)) ?? {});
    models.push({
      name: `${TRUEFOUNDRY_MODEL_PROVIDER_NAME}/${gatewayId}`,
      model_id: gatewayId,
      provider: { name: TRUEFOUNDRY_MODEL_PROVIDER_NAME },
      properties,
    });
  }
  return models;
}

function parseGatewayBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch (error) {
    throw new HTTPException(502, { message: `Default AI gateway URL is invalid: ${raw}`, cause: error });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HTTPException(502, { message: `Default AI gateway URL must be http or https: ${raw}` });
  }
  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
    throw new HTTPException(502, { message: `Default AI gateway URL must use https unless it is localhost: ${raw}` });
  }
  return normalizeHttpUrl(parsed);
}

/** Default installation `manifest.url`; none or invalid → 502. */
export function resolveDefaultGatewayUrl(payload: unknown): string {
  const items = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload['data'])
      ? payload['data']
      : [];
  for (const row of items) {
    if (!isRecord(row) || row['isDefault'] !== true) {
      continue;
    }
    const manifest = isRecord(row['manifest']) ? row['manifest'] : {};
    const url = readString(manifest['url']);
    if (url === undefined) {
      throw new HTTPException(502, { message: 'Default TrueFoundry AI gateway is missing a URL' });
    }
    return parseGatewayBaseUrl(url);
  }
  throw new HTTPException(502, { message: 'No default TrueFoundry AI gateway installation is configured' });
}
