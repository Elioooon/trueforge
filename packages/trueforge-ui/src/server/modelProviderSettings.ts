/**
 * TrueFoundry registry mode sets `settings.model_providers.enabled: false`.
 * Older servers omit the field; treat missing as enabled.
 */
export function isModelProviderSettingsEnabled(capabilities: { settings?: object } | null): boolean {
  if (capabilities === null || capabilities.settings === undefined) {
    return true;
  }
  const settings: object = capabilities.settings;
  if (!('model_providers' in settings)) {
    return true;
  }
  const modelProviders: unknown = settings.model_providers;
  if (typeof modelProviders !== 'object' || modelProviders === null || !('enabled' in modelProviders)) {
    return true;
  }
  return modelProviders.enabled !== false;
}
