import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'winston';

const SESSION_PATH = '/api/svc/v1/session';
const INTEGRATIONS_PATH = '/api/svc/v1/provider-integrations?type=model';
const PROVIDERS_PATH =
  '/api/svc/v1/provider-accounts/providers?includeInfraProviders=false&includeModelProviders=true&includeMCPProviders=false&includeGuardrailConfigs=false&includeCustomEndpoints=false';
const INSTALLATIONS_PATH = '/api/svc/v1/llm-gateway/installations';
const INTEGRATIONS_PAGE_SIZE = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPaginationTotal(payload: unknown): number | undefined {
  if (!isRecord(payload) || !isRecord(payload['pagination'])) {
    return undefined;
  }
  const total = payload['pagination']['total'];
  return typeof total === 'number' && Number.isFinite(total) ? total : undefined;
}

function readDataArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (isRecord(payload) && Array.isArray(payload['data'])) {
    return payload['data'];
  }
  return [];
}

export class TrueFoundryControlPlaneClient {
  readonly #controlPlaneUrl: string;
  readonly #logger: Logger | undefined;

  constructor(input: { controlPlaneUrl: string; logger?: Logger }) {
    this.#controlPlaneUrl = input.controlPlaneUrl.replace(/\/$/, '');
    this.#logger = input.logger;
  }

  async getSession(accessToken: string): Promise<{ tenantName: string } | undefined> {
    const payload = await this.#getJson(SESSION_PATH, accessToken);
    if (!isRecord(payload)) {
      throw new HTTPException(502, { message: 'TrueFoundry session response was not an object' });
    }
    const user = payload['user'];
    if (user === null || user === undefined) {
      return undefined;
    }
    if (!isRecord(user)) {
      throw new HTTPException(502, { message: 'TrueFoundry session user was not an object' });
    }
    const tenantName = user['tenantName'];
    if (typeof tenantName !== 'string' || tenantName.length === 0) {
      throw new HTTPException(502, { message: 'TrueFoundry session is missing tenantName' });
    }
    return { tenantName };
  }

  async listProviderIntegrations(accessToken: string): Promise<unknown[]> {
    const items: unknown[] = [];
    let offset = 0;
    for (;;) {
      const separator = INTEGRATIONS_PATH.includes('?') ? '&' : '?';
      const payload = await this.#getJson(
        `${INTEGRATIONS_PATH}${separator}offset=${String(offset)}&limit=${String(INTEGRATIONS_PAGE_SIZE)}`,
        accessToken,
      );
      const page = readDataArray(payload);
      items.push(...page);
      const total = readPaginationTotal(payload);
      if (total === undefined || items.length >= total || page.length === 0) {
        break;
      }
      offset = items.length;
    }
    return items;
  }

  listProviderCatalog(accessToken: string): Promise<unknown> {
    return this.#getJson(PROVIDERS_PATH, accessToken);
  }

  listGatewayInstallations(accessToken: string): Promise<unknown> {
    return this.#getJson(INSTALLATIONS_PATH, accessToken);
  }

  async #getJson(path: string, accessToken: string): Promise<unknown> {
    const url = `${this.#controlPlaneUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
      });
    } catch (error) {
      this.#logger?.warn('TrueFoundry control plane request failed', { path, ...extractErrorLogFields(error) });
      throw new HTTPException(502, {
        message: 'TrueFoundry control plane request failed',
        cause: error,
      });
    }
    if (response.status === 401 || response.status === 403) {
      throw new HTTPException(response.status, {
        message: 'TrueFoundry control plane rejected the request',
      });
    }
    if (!response.ok) {
      throw new HTTPException(502, {
        message: `TrueFoundry control plane request failed (${String(response.status)})`,
      });
    }
    return response.json();
  }
}
