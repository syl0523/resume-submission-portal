import type { Profile } from '@jsp/core';
import { type FieldInfo, planAutofill } from '../autofill-plan';

/**
 * Content script for company ATS application pages (KAN-31), injected on demand by the popup
 * (activeTab). Fills what the profile knows, attaches the chosen resume, outlines every field it
 * touched and leaves the rest, including Submit, to the applicant.
 */

interface AutofillMessage {
  type: 'resume-portal:autofill';
  profile: Profile;
  resume: { name: string; mime: string; base64: string } | null;
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

declare global {
  interface Window {
    __resumePortalAutofill?: boolean;
  }
}

function labelFor(el: Control): string {
  const byFor = el.id
    ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent
    : null;
  const wrapping = el.closest('label')?.textContent;
  const aria = el.getAttribute('aria-label');
  const labelledBy = el
    .getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
  // Greenhouse / Lever / Ashby put the question in a nearby block when there is no <label>.
  const container = el.closest(
    '.field, .application-question, [class*="_fieldEntry"], fieldset, li, .form-group',
  );
  const nearby = container?.querySelector(
    'label, legend, .application-label, [class*="_label"], .text',
  )?.textContent;
  return (byFor ?? wrapping ?? aria ?? labelledBy ?? nearby ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function describe(controls: Control[]): FieldInfo[] {
  return controls.map((el, index) => ({
    index,
    tag: el.tagName.toLowerCase() as FieldInfo['tag'],
    type: el instanceof HTMLInputElement ? el.type.toLowerCase() : el.tagName.toLowerCase(),
    name: el.getAttribute('name') ?? '',
    id: el.id,
    label: labelFor(el),
    placeholder: el.getAttribute('placeholder') ?? '',
    autocomplete: el.getAttribute('autocomplete') ?? '',
    options: el instanceof HTMLSelectElement ? [...el.options].map((o) => o.text) : [],
    filled:
      el instanceof HTMLInputElement && el.type === 'file'
        ? (el.files?.length ?? 0) > 0
        : Boolean(el.value?.trim()),
  }));
}

/** Set a value the way a person typing would, so React-controlled forms notice. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function attachFile(el: HTMLInputElement, resume: NonNullable<AutofillMessage['resume']>) {
  const bytes = Uint8Array.from(atob(resume.base64), (c) => c.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], resume.name, { type: resume.mime }));
  el.files = transfer.files;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function mark(el: Element) {
  (el as HTMLElement).style.outline = '2px solid #e0b100';
  (el as HTMLElement).style.outlineOffset = '2px';
}

function banner(filled: number) {
  document.getElementById('resume-portal-banner')?.remove();
  const box = document.createElement('div');
  box.id = 'resume-portal-banner';
  box.setAttribute('role', 'status');
  box.style.cssText =
    'position:fixed;z-index:2147483647;bottom:16px;right:16px;max-width:340px;padding:12px 14px;border-radius:10px;background:#18222f;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)';
  box.textContent = `Resume Portal filled ${filled} field${filled === 1 ? '' : 's'} (outlined in yellow). Review everything, answer the remaining questions yourself, then submit.`;
  const close = document.createElement('button');
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  close.style.cssText =
    'margin-left:8px;background:none;border:0;color:#fff;font-size:18px;cursor:pointer';
  close.onclick = () => box.remove();
  box.append(close);
  document.body.append(box);
}

if (!window.__resumePortalAutofill) {
  window.__resumePortalAutofill = true;
  chrome.runtime.onMessage.addListener((message: AutofillMessage, _sender, sendResponse) => {
    if (message?.type !== 'resume-portal:autofill') return false;
    const controls = [...document.querySelectorAll<Control>('input, textarea, select')].filter(
      (el) =>
        !el.disabled && (el instanceof HTMLInputElement ? el.type !== 'hidden' || false : true),
    );
    const plan = planAutofill(describe(controls), message.profile, {
      hasResume: Boolean(message.resume),
    });
    let filled = 0;
    for (const action of plan) {
      const el = controls[action.index];
      if (!el) continue;
      if (action.kind === 'file' && el instanceof HTMLInputElement && message.resume) {
        attachFile(el, message.resume);
      } else if (action.kind === 'text' && !(el instanceof HTMLSelectElement)) {
        setValue(el, action.value);
      } else {
        continue;
      }
      mark(el);
      filled += 1;
    }
    banner(filled);
    sendResponse({ filled, fields: plan.map((a) => a.reason) });
    return false;
  });
}
