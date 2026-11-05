import {
  type AiAnswer,
  type ApplicationListItem,
  type ExtLookupResponse,
  type ExtProfileResponse,
  type ExtSaveJobRequest,
  type ExtSaveResponse,
  type FitFlag,
  type JobDraft,
  type Resume,
  STATUS_META,
} from '@jsp/core';
import { isSupportedApplicationPage } from './autofill-plan';
import { bestFit, type JobOrigin, jobFromSnapshot, toBase64 } from './job';
import { errorText, extApi, extFile, h, loadSettings, type Settings } from './lib';
import { collectPage, type PageSnapshot } from './page';

/**
 * Popup (KAN-30, KAN-31, KAN-43): save the job on the current tab with its fit to your saved
 * searches, mark it applied, autofill a Greenhouse / Lever / Ashby form for review, and draft
 * answers to application questions. Reads the page only when you click the extension (activeTab).
 */

const app = document.getElementById('app');

interface Context {
  settings: Settings;
  profile: ExtProfileResponse;
  tab: chrome.tabs.Tab & { id: number; url: string };
  job: JobDraft;
  origin: JobOrigin;
  existing: ApplicationListItem | null;
}

/** Same wording as the portal's Job Match page. */
const FLAG_LABEL: Record<FitFlag, string> = {
  no_sponsorship: 'No visa sponsorship',
  citizenship_required: 'US citizens only',
  clearance_required: 'Clearance required',
  relocation_required: 'Relocation required',
  contract_role: 'Contract',
  salary_below_min: 'Below your salary floor',
  stale_posting: 'Posted 30+ days ago',
  excluded_keyword: 'Has an excluded word',
};

const ORIGIN_HINT: Record<JobOrigin, string> = {
  'json-ld': 'Filled in from the job details the site publishes.',
  linkedin: 'Filled in from the LinkedIn job pane.',
  indeed: 'Filled in from the Indeed job pane.',
  page: 'Filled in from the page title. Check the fields.',
};

function show(...nodes: (Node | null | false)[]) {
  app?.replaceChildren(...nodes.filter((n): n is Node => Boolean(n)));
}

function openTab(url: string) {
  void chrome.tabs.create({ url });
}

function header(settings: Settings | null, email?: string) {
  return h(
    'header',
    { class: 'top' },
    h('h1', {}, 'Resume Portal'),
    settings
      ? h(
          'button',
          {
            type: 'button',
            class: 'link small',
            title: email ? `Signed in as ${email}` : 'Settings',
            onclick: () => chrome.runtime.openOptionsPage(),
          },
          'Settings',
        )
      : null,
  );
}

function errorNote(err: unknown) {
  return h('p', { class: 'status error', role: 'alert' }, errorText(err));
}

function resumeSelect(resumes: Resume[], id: string) {
  const select = h('select', { id }) as HTMLSelectElement;
  for (const resume of resumes) {
    select.append(h('option', { value: resume.id }, resume.label));
  }
  const preferred = resumes.find((r) => r.isDefault) ?? resumes[0];
  if (preferred) select.value = preferred.id;
  return select;
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  // popup.html?tab=<id> points the popup at a given tab: used by the end-to-end check, which
  // cannot click the toolbar button, and handy when debugging the popup in a full tab.
  const requested = Number(new URLSearchParams(location.search).get('tab'));
  if (Number.isInteger(requested) && requested > 0) return chrome.tabs.get(requested);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function readPage(tabId: number): Promise<PageSnapshot | null> {
  // `collectPage` is serialized into the page, so it is passed as is, never wrapped.
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: collectPage });
  return (result?.result as PageSnapshot | undefined) ?? null;
}

async function main() {
  if (!app) return;
  const settings = await loadSettings();
  if (!settings) {
    show(
      header(null),
      h('p', { class: 'lead' }, 'Connect the extension to your portal first.'),
      h(
        'button',
        { type: 'button', class: 'primary', onclick: () => chrome.runtime.openOptionsPage() },
        'Connect',
      ),
    );
    return;
  }

  const tab = await activeTab();
  if (tab?.id === undefined || !tab.url || !/^https?:/i.test(tab.url)) {
    show(
      header(settings),
      h('p', { class: 'hint' }, 'Open a job posting or an application form, then click again.'),
    );
    return;
  }
  const currentTab = tab as Context['tab'];
  show(header(settings), h('p', { class: 'hint', role: 'status' }, 'Reading this page…'));

  const [profile, page] = await Promise.allSettled([
    extApi<ExtProfileResponse>(settings, '/profile'),
    readPage(currentTab.id),
  ]);
  if (profile.status === 'rejected') {
    show(header(settings), errorNote(profile.reason));
    return;
  }
  const snapshot = page.status === 'fulfilled' ? page.value : null;
  const { job, origin } = snapshot
    ? jobFromSnapshot(snapshot)
    : {
        job: { title: currentTab.title, url: currentTab.url } as JobDraft,
        origin: 'page' as const,
      };
  const lookup = await extApi<ExtLookupResponse>(
    settings,
    `/lookup?url=${encodeURIComponent(job.url ?? currentTab.url)}`,
  ).catch(() => ({ application: null }));

  render({
    settings,
    profile: profile.value,
    tab: currentTab,
    job,
    origin,
    existing: lookup.application,
  });
}

function render(ctx: Context) {
  show(
    header(ctx.settings, ctx.profile.user.email),
    existingBanner(ctx),
    fitBadge(ctx),
    saveForm(ctx),
    autofillSection(ctx),
    answerHelper(ctx),
  );
}

function existingBanner({ existing, settings }: Context) {
  if (!existing) return null;
  return h(
    'p',
    { class: 'banner' },
    `Already in your portal: ${STATUS_META[existing.status].label}. `,
    h(
      'button',
      {
        type: 'button',
        class: 'link',
        onclick: () => openTab(`${settings.portalUrl}/applications/${existing.id}`),
      },
      'Open it',
    ),
  );
}

function fitBadge({ profile, job }: Context) {
  const best = bestFit(profile.searches, job);
  if (!best) return null;
  const { fit, search } = best;
  const tone = fit.excluded ? 'bad' : fit.score >= 70 ? 'good' : fit.score >= 45 ? 'ok' : 'bad';
  const notes = [...fit.flags.map((f) => FLAG_LABEL[f]), ...fit.reasons].slice(0, 3);
  return h(
    'section',
    { class: 'fit', 'aria-label': 'Fit to your saved searches' },
    h('span', { class: `score ${tone}` }, String(fit.score)),
    h(
      'div',
      {},
      h(
        'p',
        { class: 'fit-title' },
        fit.excluded ? `Ruled out by “${search.name}”` : `Fit for “${search.name}”`,
      ),
      notes.length ? h('p', { class: 'hint' }, notes.join(' · ')) : null,
    ),
  );
}

function field(label: string, id: string, value: string, required = false) {
  const input = h('input', { id, type: 'text', required, autocomplete: 'off' }) as HTMLInputElement;
  input.value = value;
  return { input, nodes: [h('label', { for: id }, label), input] };
}

function saveForm(ctx: Context) {
  const { job, existing, profile, settings } = ctx;
  const title = field('Job title', 'title', job.title ?? '', true);
  const company = field('Company', 'company', job.company ?? '', true);
  const location = field('Location', 'location', job.location ?? '');
  const applied = h('input', { type: 'checkbox', id: 'applied' }) as HTMLInputElement;
  const resumes = profile.resumes.filter((r) => !r.archived);
  const resume = resumes.length ? resumeSelect(resumes, 'applied-resume') : null;
  const resumeRow = resume
    ? h(
        'div',
        { class: 'stack', hidden: true },
        h('label', { for: 'applied-resume' }, 'Resume you sent'),
        resume,
      )
    : null;
  const status = h('p', { class: 'status', role: 'status' });
  const button = h(
    'button',
    { type: 'submit', class: 'primary' },
    existing ? 'Already saved' : 'Save job',
  );
  if (existing) button.disabled = true;

  applied.addEventListener('change', () => {
    if (resumeRow) resumeRow.hidden = !applied.checked;
    button.disabled = Boolean(existing) && !applied.checked;
    button.textContent = applied.checked
      ? existing
        ? 'Mark applied'
        : 'Save as applied'
      : existing
        ? 'Already saved'
        : 'Save job';
  });

  const form = h(
    'form',
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        if (!title.input.value.trim() || !company.input.value.trim()) {
          status.textContent = 'Fill in the job title and the company.';
          status.className = 'status error';
          return;
        }
        button.disabled = true;
        status.textContent = 'Saving…';
        status.className = 'status';
        const best = bestFit(profile.searches, job);
        const body: ExtSaveJobRequest = {
          job: {
            ...job,
            title: title.input.value.trim(),
            company: company.input.value.trim(),
            location: location.input.value.trim() || null,
            url: job.url ?? ctx.tab.url,
          },
          markApplied: applied.checked,
          resumeId: applied.checked && resume ? resume.value : null,
          appliedVia:
            applied.checked && isSupportedApplicationPage(ctx.tab.url) ? 'company_site' : null,
          fitScore: best?.fit.score ?? null,
        };
        try {
          const saved = await extApi<ExtSaveResponse>(settings, '/jobs', { json: body });
          status.replaceChildren(
            saved.duplicate
              ? `Updated: ${STATUS_META[saved.application.status].label}. `
              : `Saved to your portal${applied.checked ? ' as applied' : ''}. `,
            h(
              'button',
              {
                type: 'button',
                class: 'link',
                onclick: () =>
                  openTab(`${settings.portalUrl}/applications/${saved.application.id}`),
              },
              'Open it',
            ),
          );
          status.className = 'status ok';
        } catch (err) {
          status.textContent = errorText(err);
          status.className = 'status error';
          button.disabled = false;
        }
      },
    },
    ...title.nodes,
    ...company.nodes,
    ...location.nodes,
    h('p', { class: 'hint' }, ORIGIN_HINT[ctx.origin]),
    h('label', { class: 'check' }, applied, ' I applied to this job'),
    resumeRow,
    button,
    status,
  );
  return h('section', { 'aria-label': 'Save this job' }, form);
}

function autofillSection(ctx: Context) {
  const { tab, job, profile, settings } = ctx;
  if (job.source === 'linkedin' || job.source === 'indeed') {
    return h(
      'p',
      { class: 'hint' },
      'Autofill works on Greenhouse, Lever and Ashby application forms. It never runs on LinkedIn or Indeed: apply there yourself, then tick “I applied” to track it.',
    );
  }
  if (!isSupportedApplicationPage(tab.url)) return null;
  const resumes = profile.resumes.filter((r) => !r.archived);
  const resume = resumes.length ? resumeSelect(resumes, 'autofill-resume') : null;
  const status = h('p', { class: 'status', role: 'status' });
  const button = h('button', { type: 'button', class: 'primary' }, 'Autofill for review');
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Filling the form…';
    status.className = 'status';
    try {
      const chosen = resumes.find((r) => r.id === resume?.value) ?? null;
      const file = chosen
        ? {
            name: chosen.fileName,
            mime: chosen.mimeType,
            base64: toBase64(
              new Uint8Array(
                await (await extFile(settings, `/resumes/${chosen.id}/file`)).arrayBuffer(),
              ),
            ),
          }
        : null;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-autofill.js'],
      });
      const result = (await chrome.tabs.sendMessage(tab.id, {
        type: 'resume-portal:autofill',
        profile: profile.profile,
        resume: file,
      })) as { filled: number } | undefined;
      const filled = result?.filled ?? 0;
      status.textContent = `Filled ${filled} field${filled === 1 ? '' : 's'}, outlined in yellow. Review everything, answer the rest yourself, then submit.`;
      status.className = 'status ok';
    } catch (err) {
      status.textContent = errorText(err);
      status.className = 'status error';
    } finally {
      button.disabled = false;
    }
  });
  return h(
    'section',
    { class: 'card', 'aria-label': 'Autofill this application' },
    h('h2', {}, 'Fill this application'),
    h(
      'p',
      { class: 'hint' },
      'Fills what your profile knows and attaches a resume. You review and submit.',
    ),
    resume ? h('label', { for: 'autofill-resume' }, 'Resume') : null,
    resume,
    button,
    status,
  );
}

function answerHelper(ctx: Context) {
  const question = h('textarea', {
    id: 'question',
    rows: 3,
    placeholder: 'Paste a question from the application, e.g. “Why do you want to work here?”',
  }) as HTMLTextAreaElement;
  const output = h('div', { class: 'answer', role: 'status' });
  const button = h('button', { type: 'button' }, 'Draft answer');
  button.addEventListener('click', async () => {
    const text = question.value.trim();
    if (text.length < 3) {
      output.replaceChildren(h('p', { class: 'status error' }, 'Paste the question first.'));
      return;
    }
    button.disabled = true;
    output.replaceChildren(h('p', { class: 'hint' }, 'Drafting…'));
    try {
      const draft = await extApi<AiAnswer>(ctx.settings, '/answer', {
        json: {
          question: text.slice(0, 1000),
          jobDescription: ctx.job.description?.slice(0, 50_000) || undefined,
        },
      });
      const copy = h('button', { type: 'button', class: 'link' }, 'Copy');
      copy.addEventListener('click', async () => {
        await navigator.clipboard.writeText(draft.answer);
        copy.textContent = 'Copied';
      });
      output.replaceChildren(h('p', { class: 'draft' }, draft.answer), copy);
    } catch (err) {
      output.replaceChildren(errorNote(err));
    } finally {
      button.disabled = false;
    }
  });
  return h(
    'details',
    { class: 'card' },
    h('summary', {}, 'Draft an answer with AI'),
    h('label', { for: 'question', class: 'sr-only' }, 'Application question'),
    question,
    button,
    output,
  );
}

main().catch((err) => show(header(null), errorNote(err)));
