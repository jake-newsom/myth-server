export function iapConfig() {
  return {
    enabled: process.env.IAP_ENABLED === 'true',
    environment: process.env.IAP_ENVIRONMENT,
    appIds: (process.env.REVENUECAT_APP_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    webhookAuth: process.env.REVENUECAT_WEBHOOK_AUTH || '',
  };
}
export function validateIapConfig() {
  const c = iapConfig();
  if (!c.enabled) return;
  if (c.webhookAuth.length < 32 || !c.appIds.length || !['SANDBOX', 'PRODUCTION'].includes(c.environment || '')) {
    throw new Error('IAP_ENABLED requires a 32+ character REVENUECAT_WEBHOOK_AUTH, REVENUECAT_APP_IDS and explicit IAP_ENVIRONMENT');
  }
}
