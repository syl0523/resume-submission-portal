import { errorText, extApi, h, loadSettings, normalizePortalUrl, saveSettings } from './lib';

/** Options page (KAN-30): pair the extension with your portal using a personal API token. */

async function main() {
  const app = document.getElementById('app');
  if (!app) return;
  const current = await loadSettings();
  const url = h('input', {
    type: 'url',
    id: 'url',
    placeholder: 'https://your-portal.example.com',
    value: current?.portalUrl ?? '',
    required: true,
  });
  const token = h('input', {
    type: 'password',
    id: 'token',
    placeholder: 'jsp_…',
    value: current?.token ?? '',
    required: true,
    autocomplete: 'off',
  });
  const status = h('p', { class: 'status', role: 'status' });
  const button = h('button', { type: 'submit', class: 'primary' }, 'Save and test');

  const form = h(
    'form',
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const portalUrl = normalizePortalUrl(url.value);
        if (!portalUrl) {
          status.textContent = 'Enter the portal address, starting with https://';
          status.className = 'status error';
          return;
        }
        button.disabled = true;
        status.textContent = 'Testing…';
        status.className = 'status';
        try {
          const settings = { portalUrl, token: token.value.trim() };
          const ping = await extApi<{ ok: boolean; email: string }>(settings, '/ping');
          await saveSettings(settings);
          status.textContent = `Connected as ${ping.email}. You can close this tab.`;
          status.className = 'status ok';
        } catch (err) {
          status.textContent = `Could not connect: ${errorText(err)}`;
          status.className = 'status error';
        } finally {
          button.disabled = false;
        }
      },
    },
    h('label', { for: 'url' }, 'Portal address'),
    url,
    h('label', { for: 'token' }, 'Personal API token'),
    token,
    h(
      'p',
      { class: 'hint' },
      'Create a token in the portal under Settings → Browser extension. It is stored only in this browser.',
    ),
    button,
    status,
  );

  app.append(
    h('h1', {}, 'Resume Portal'),
    h(
      'p',
      { class: 'lead' },
      'Save jobs from any posting page and fill Greenhouse, Lever and Ashby application forms for review.',
    ),
    form,
    h(
      'p',
      { class: 'hint' },
      'The extension only reads the page you click it on. It never submits applications and never fills LinkedIn or Indeed forms.',
    ),
  );
}

void main();
