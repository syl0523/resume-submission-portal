// Service worker. TODO(extension agent, KAN-30): API calls to the portal on behalf of popup and content scripts.
chrome.runtime.onInstalled.addListener(() => {
  console.log('Job Portal Clipper installed');
});
