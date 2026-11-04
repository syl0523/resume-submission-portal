/**
 * Service worker (KAN-30). The popup talks to the portal directly (the portal's /api/ext routes
 * allow CORS); the worker only opens the options page on first install so pairing is obvious.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'install') return;
  const s = await chrome.storage.local.get(['portalUrl', 'token']);
  if (!s.portalUrl || !s.token) await chrome.runtime.openOptionsPage();
});
