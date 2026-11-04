import type { Profile } from '@jsp/core';
import { normalizeForCompare, similarity } from '@jsp/integrations';

/**
 * Pure field-mapping logic for review-before-submit autofill (KAN-31). The content script describes
 * the form's fields; this decides what (if anything) goes into each. Nothing here touches the DOM,
 * clicks Submit, or answers equal-opportunity / self-identification questions.
 */

export interface FieldInfo {
  /** Index of the field in the content script's list. */
  index: number;
  tag: 'input' | 'textarea' | 'select';
  type: string;
  name: string;
  id: string;
  label: string;
  placeholder: string;
  autocomplete: string;
  /** Option labels for selects. */
  options: string[];
  /** True when the field already has a value: never overwrite the user's typing. */
  filled: boolean;
}

export type FillAction =
  | { index: number; kind: 'text'; value: string; reason: string }
  | { index: number; kind: 'file'; reason: string };

/** Questions only the applicant answers: demographics, disability, veteran status, pronouns. */
export const SENSITIVE =
  /\b(gender|sex|race|racial|ethnic|ethnicity|hispanic|latin[oax]|veteran|disabilit|sexual orientation|transgender|pronoun|self[- ]identif|voluntary|eeo|age|date of birth|birth ?date|religio|marital|citizenship status|social security|ssn)\b/i;

/** Work authorization and sponsorship answers carry legal weight: left for the applicant. */
const AUTHORIZATION =
  /\b(authori[sz]ed|authori[sz]ation|sponsor|visa|work permit|right to work|clearance)\b/i;

function splitName(full: string | null): { first: string; last: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0] ?? '', last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] ?? '' };
}

function haystack(f: FieldInfo): string {
  return normalizeForCompare([f.label, f.name, f.id, f.placeholder, f.autocomplete].join(' '));
}

export function planAutofill(
  fields: FieldInfo[],
  profile: Profile,
  opts: { hasResume: boolean },
): FillAction[] {
  const name = splitName(profile.fullName);
  const current = profile.experience.find((e) => e.current) ?? profile.experience[0];
  const actions: FillAction[] = [];
  let resumeAttached = false;

  for (const f of fields) {
    const text = haystack(f);
    const raw = `${f.label} ${f.name} ${f.id}`;
    if (SENSITIVE.test(raw) || SENSITIVE.test(f.label)) continue;
    if (AUTHORIZATION.test(raw)) continue;

    if (f.tag === 'input' && f.type === 'file') {
      if (
        opts.hasResume &&
        !resumeAttached &&
        /\b(resume|cv|curriculum)\b/i.test(raw) &&
        !/cover/i.test(raw)
      ) {
        actions.push({ index: f.index, kind: 'file', reason: 'Resume' });
        resumeAttached = true;
      }
      continue;
    }
    if (
      f.filled ||
      f.tag === 'select' ||
      ['checkbox', 'radio', 'hidden', 'submit', 'button', 'password'].includes(f.type)
    ) {
      continue;
    }

    const fill = (value: string | null | undefined, reason: string) => {
      if (value?.trim())
        actions.push({ index: f.index, kind: 'text', value: value.trim(), reason });
    };
    const ac = f.autocomplete.toLowerCase();

    if (
      ac === 'given-name' ||
      /\bfirst name\b|\bfirst_name\b|\bfname\b|\bgiven name\b/.test(text) ||
      /first_name|firstname/i.test(f.name)
    )
      fill(name.first, 'First name');
    else if (
      ac === 'family-name' ||
      /\blast name\b|\blast_name\b|\blname\b|\bfamily name\b|\bsurname\b/.test(text) ||
      /last_name|lastname/i.test(f.name)
    )
      fill(name.last, 'Last name');
    else if (
      ac === 'name' ||
      /^(name|full name|your name|legal name)$/.test(normalizeForCompare(f.label)) ||
      f.name === 'name'
    )
      fill(profile.fullName, 'Full name');
    else if (ac === 'email' || f.type === 'email' || /\bemail\b/.test(text))
      fill(profile.email, 'Email');
    else if (ac === 'tel' || f.type === 'tel' || /\bphone\b|\bmobile\b|\btelephone\b/.test(text))
      fill(profile.phone, 'Phone');
    else if (/linkedin/.test(text)) fill(profile.linkedinUrl, 'LinkedIn');
    else if (/github/.test(text)) fill(profile.githubUrl, 'GitHub');
    else if (
      /\b(website|portfolio|personal site|blog)\b/.test(text) ||
      /urls\[other\]|urls\[portfolio\]/i.test(f.name)
    )
      fill(profile.websiteUrl, 'Website');
    else if (
      /\b(current company|current employer|employer|organization)\b/.test(text) ||
      f.name === 'org'
    )
      fill(current?.company, 'Current company');
    else if (/\b(current title|job title|current role|position)\b/.test(text))
      fill(current?.title, 'Current title');
    else if (ac.startsWith('address-level2') || /\bcity\b/.test(text))
      fill(profile.address?.city ?? profile.location?.split(',')[0], 'City');
    else if (/\b(location|where are you based|current location)\b/.test(text))
      fill(profile.location, 'Location');
    else if (f.tag === 'textarea' || f.type === 'text') {
      // Saved answers: reuse the closest question the applicant answered before.
      const label = normalizeForCompare(f.label);
      if (label.length < 8) continue;
      let best: { answer: string; score: number } | null = null;
      for (const a of profile.customAnswers) {
        const q = normalizeForCompare(a.question);
        const score = label.includes(q) || q.includes(label) ? 0.95 : similarity(label, q);
        if (score >= 0.8 && (!best || score > best.score)) best = { answer: a.answer, score };
      }
      if (best) fill(best.answer, 'Saved answer');
    }
  }
  return actions;
}

/** Application forms the extension may autofill: official company ATS pages only, never LinkedIn or Indeed. */
export function isSupportedApplicationPage(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (/(^|\.)(linkedin|indeed)\./.test(host)) return false;
  if (host.endsWith('greenhouse.io'))
    return /\/jobs\/\d+/.test(u.pathname) || u.pathname.includes('/application');
  if (/^jobs(\.eu)?\.lever\.co$/.test(host)) return /\/apply\/?$/.test(u.pathname);
  if (host === 'jobs.ashbyhq.com') return /\/application\/?$/.test(u.pathname);
  return false;
}
