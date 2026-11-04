import type { EmailClassification, EmailKind, EmailProvider } from '@jsp/core';
import { analyzeJobUrl } from '../url';
import { domainOf, emailBodyText, normalizeEmailDate, parseAddress } from './basics';
import { parseInterviewTime } from './interview';
import type { EmailMessage } from './types';

/**
 * Rules-based classifier for application emails (KAN-20). Every rule that fires is reported in
 * `signals`, so the Inbox can explain a decision. Below 0.6 confidence the Worker may ask the AI
 * classifier for a second opinion.
 */

const PROVIDER_DOMAINS: [EmailProvider, RegExp][] = [
  ['linkedin', /(^|\.)linkedin\.com$/],
  ['indeed', /(^|\.)(indeed\.com|indeedemail\.com|indeedmail\.com)$/],
  ['greenhouse', /(^|\.)(greenhouse\.io|greenhouse-mail\.io)$/],
  ['lever', /(^|\.)lever\.co$/],
  ['ashby', /(^|\.)ashbyhq\.com$/],
  ['workday', /(^|\.)(myworkday\.com|workday\.com|myworkdayjobs\.com)$/],
  ['smartrecruiters', /(^|\.)smartrecruiters\.com$/],
  ['icims', /(^|\.)icims\.com$/],
  ['taleo', /(^|\.)taleo\.net$/],
  ['successfactors', /(^|\.)(successfactors\.(com|eu)|sapsf\.(com|eu))$/],
];

const PROVIDER_BODY: [EmailProvider, RegExp][] = [
  ['greenhouse', /greenhouse\.io|powered by greenhouse/i],
  ['lever', /jobs\.lever\.co|hire\.lever\.co/i],
  ['ashby', /ashbyhq\.com/i],
  ['workday', /myworkday(jobs|site)?\.com/i],
  ['smartrecruiters', /smartrecruiters\.com/i],
  ['icims', /icims\.com/i],
  ['taleo', /taleo\.net/i],
  ['successfactors', /successfactors\.(com|eu)/i],
];

/** Personal mailboxes: neither the display name nor the domain says anything about an employer. */
const MAILBOX_DOMAIN =
  /(^|\.)(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|qq|163|126|sina|foxmail|gmx|zoho)\.[a-z.]+$/i;

/** Hiring platforms besides the parsed providers: the display name is the employer, the domain is not. */
const OTHER_PLATFORM_DOMAIN =
  /(^|\.)(jobvite|bamboohr|workable|recruitee|breezy|jazzhr|applytojob|ziprecruiter|glassdoor|hirevue|calendly|goodtime|paradox|teamtailor|personio|rippling|gusto)\.[a-z.]+$/i;

const BRAND_NAME =
  /^(linkedin|indeed|indeed apply|greenhouse|lever|ashby|workday|smartrecruiters|icims|taleo|successfactors|sap successfactors|jobvite|workable|no[- ]?reply|do[- ]?not[- ]?reply|notifications?|careers?|recruiting|jobs?|talent( acquisition)?|hiring( team)?|hr|human resources|team)$/i;

interface KindRule {
  id: string;
  kind: EmailKind;
  re: RegExp;
  confidence: number;
  where: 'subject' | 'any';
}

/** Ordered by priority: the first rule that fires decides the kind. */
const KIND_RULES: KindRule[] = [
  {
    id: 'rejection.strong',
    kind: 'rejection',
    re: /\b(regret to inform|not (be )?moving forward|will not (be )?mov(e|ing) forward|decided (to move forward|to proceed|to pursue|to go) with (other|another) (candidates?|applicants?)|(pursue|proceed with|move forward with) other candidates|no longer (being )?(considered|under consideration)|position has (now )?been filled|role has (now )?been filled|not been selected|were not selected|(cannot|can't|won't|will not) (be )?(proceeding|proceed|progress(ing)?) (with )?your (application|candidacy)|decided not to (move|proceed|progress)|not to proceed with your application|other applicants whose (qualifications|experience))\b|很遗憾|未能通过|不予录用|决定不(再)?推进/i,
    confidence: 0.9,
    where: 'any',
  },
  {
    id: 'offer',
    kind: 'offer',
    re: /\b(pleased to (extend|offer you)|(extend|extending) (you )?an offer|offer letter|offer of employment|job offer|employment offer|formal offer|verbal offer|congratulations[^.\n]{0,60}\boffer\b)|录用通知|聘用通知|录取通知|offer\s*letter/i,
    confidence: 0.88,
    where: 'any',
  },
  {
    id: 'interview.invite',
    kind: 'interview',
    re: /\b(invite you (to|for) (an? |the )?(interview|onsite|virtual interview|video interview|in-person interview)|interview (invitation|invite|request|confirmation|confirmed|scheduled|details|reminder)|(schedule|book) (an? |your |the )?interview|(your|an|the) interview (with|for|on|at|is)|onsite interview|final[- ](round|interview)|panel interview|technical interview|video interview|interview availability|availability for (an? )?interview|(first|second|next) round)\b|面试邀请|邀请您参加面试|面试安排|面试时间/i,
    confidence: 0.86,
    where: 'any',
  },
  {
    id: 'assessment',
    kind: 'assessment',
    re: /\b(assessment|coding (challenge|test|exercise)|take[- ]home|hackerrank|codility|codesignal|testgorilla|hirevue|pymetrics|online test|skills? test|aptitude test|work sample|case study exercise|questionnaire to complete)\b|测评|笔试|在线测试/i,
    confidence: 0.8,
    where: 'any',
  },
  {
    id: 'rejection.weak',
    kind: 'rejection',
    re: /\bunfortunately\b[\s\S]{0,300}\b(application|candidacy|position|role|candidates?)\b|\b(application|candidacy)\b[\s\S]{0,300}\bunfortunately\b/i,
    confidence: 0.7,
    where: 'any',
  },
  {
    id: 'screening',
    kind: 'screening',
    re: /\b(phone screen(ing)?|recruiter (call|screen|chat|conversation)|screening (call|interview)|initial (call|chat|conversation|screen)|intro(ductory)? call|quick (call|chat)|(schedule|find) (a|some) time to (chat|talk|connect|speak)|set up a (call|time to (chat|talk))|next steps? in (the|our) (hiring )?process|(move|moving) (you )?forward to the next (step|stage)|would (like|love) to (speak|talk|chat) with you)\b|电话沟通|初步沟通|电话面试/i,
    confidence: 0.75,
    where: 'any',
  },
  {
    id: 'viewed',
    kind: 'application_viewed',
    re: /\b(your application was viewed|viewed your application|application (has been|was) viewed|looked at your application)\b|查看了(您|你)的申请/i,
    confidence: 0.9,
    where: 'any',
  },
  {
    id: 'received.sent',
    kind: 'application_received',
    re: /\byour application was sent to\b/i,
    confidence: 0.92,
    where: 'any',
  },
  {
    id: 'received.indeed',
    kind: 'application_received',
    re: /^\s*indeed application\s*:/i,
    confidence: 0.92,
    where: 'subject',
  },
  {
    id: 'received',
    kind: 'application_received',
    re: /\b(thank(s| you) for (applying|your application|submitting your application|your interest in (the |our )?[^.\n]{0,60}(position|role|opening|job))|(we('ve| have)?) received your application|application (has been |was )?(received|submitted|successfully submitted)|we('ll| will) (carefully )?review your (application|resume|qualifications)|successfully applied|you applied (for|to))\b|感谢您的申请|已收到您的申请|申请已提交|投递成功/i,
    confidence: 0.82,
    where: 'any',
  },
  {
    id: 'interview.subject',
    kind: 'interview',
    re: /\binterview\b|面试/i,
    confidence: 0.62,
    where: 'subject',
  },
  {
    id: 'alert',
    kind: 'other',
    re: /\b(job alert|jobs? (you may be|you might be) interested in|new jobs? (for you|matching|near you)|recommended (jobs?|for you)|jobs? recommendations?|top job picks|similar jobs|is hiring\b|people (also )?viewed|weekly digest|newsletter)\b|职位推荐|职位提醒/i,
    confidence: 0.85,
    where: 'any',
  },
];

function detectProvider(address: string, body: string, signals: string[]): EmailProvider {
  const domain = domainOf(address);
  for (const [provider, re] of PROVIDER_DOMAINS) {
    if (re.test(domain)) {
      signals.push(`provider:${provider}`);
      return provider;
    }
  }
  for (const [provider, re] of PROVIDER_BODY) {
    if (re.test(body)) {
      signals.push(`provider:body:${provider}`);
      return provider;
    }
  }
  return 'generic';
}

function cleanCompany(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw
    .replace(/\s+/g, ' ')
    .replace(/^["“'«]+|["”'»]+$/g, '')
    .replace(/^(the|a)\s+/i, '')
    .replace(
      /\s+(team|recruiting team|talent team|hiring team|careers|recruiting|talent acquisition)$/i,
      '',
    )
    .replace(/[.!,;:)\]]+$/, '')
    .trim();
  s = s.split(/\s+[|–—]\s+|\s+-\s+(?=[A-Z])/)[0]?.trim() ?? s;
  if (s.length < 2 || s.length > 80) return null;
  if (/@|https?:|www\./i.test(s)) return null;
  if (/^(us|you|our team|the team|we|this|that|it|them|our company|the company|your)$/i.test(s))
    return null;
  if (BRAND_NAME.test(s)) return null;
  return s;
}

function cleanTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .replace(/\s+/g, ' ')
    .replace(/^["“'«]+|["”'»]+$/g, '')
    .replace(/^(the|a|an|our|your)\s+/i, '')
    .replace(/\s+(position|role|opening|job)$/i, '')
    .replace(/[.!,;:]+$/, '')
    .trim();
  if (s.length < 2 || s.length > 120 || /@|https?:/i.test(s)) return null;
  if (/^(position|role|job|opening|application)$/i.test(s)) return null;
  return s;
}

/** One title character: anything on the line except sentence ends, never spanning "the"/"apply". */
const TITLE = '(?:(?!\\b(?:the|apply|applying|applied|application)\\b)[^\\n.!])';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Sender display name or domain as the employer, when it is not a platform or mailbox. */
function companyFromSender(name: string | null, address: string): string | null {
  const domain = domainOf(address);
  if (!domain || MAILBOX_DOMAIN.test(domain)) return null;
  const platform =
    PROVIDER_DOMAINS.some(([, re]) => re.test(domain)) || OTHER_PLATFORM_DOMAIN.test(domain);
  const local = address.split('@')[0]?.toLowerCase() ?? '';
  const firstWord = name?.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  // On a company domain, "Alex Rivera <alex@company.com>" is a person: use the domain instead.
  const looksLikePerson = !platform && firstWord.length >= 2 && local.includes(firstWord);
  if (name && !looksLikePerson) {
    const cleaned = name
      .replace(/\s*\((via|on behalf of)[^)]*\)\s*$/i, '')
      .replace(/\s+(via|@)\s+\w+.*$/i, '')
      .replace(
        /\s*(careers?|recruiting|recruitment|talent acquisition|talent|hiring team|hiring|jobs|team|hr|human resources|people( team)?|notifications?|no[- ]?reply)\s*$/i,
        '',
      )
      .trim();
    const company = cleanCompany(cleaned);
    if (
      company &&
      !/\b(linkedin|indeed|greenhouse|lever|ashby|workday|smartrecruiters|icims|taleo|successfactors)\b/i.test(
        company,
      )
    ) {
      return company;
    }
  }
  if (platform) return null;
  const labels = domain.split('.');
  const main = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  if (!main || main.length < 2) return null;
  return main.charAt(0).toUpperCase() + main.slice(1);
}

interface Extracted {
  company: string | null;
  title: string | null;
}

function extract(
  provider: EmailProvider,
  subject: string,
  body: string,
  signals: string[],
): Extracted {
  let company: string | null = null;
  let title: string | null = null;
  const take = (id: string, c?: string | null, t?: string | null) => {
    const cc = cleanCompany(c);
    const tt = cleanTitle(t);
    if (!company && cc) {
      company = cc;
      signals.push(`company:${id}`);
    }
    if (!title && tt) {
      title = tt;
      signals.push(`title:${id}`);
    }
  };

  // Provider templates.
  if (provider === 'linkedin') {
    const sent = /your application was sent to (.+)$/i.exec(subject);
    if (sent) take('linkedin.sent', sent[1]);
    const viewed = /your application was viewed by (.+)$/i.exec(subject);
    if (viewed) take('linkedin.viewed', viewed[1]);
    const update = /your application to (.+?) at (.+)$/i.exec(subject);
    if (update) take('linkedin.update', update[2], update[1]);
    if (company && !title) {
      // Body cards read "<Title>\n<Company> · <Location>".
      const card = new RegExp(
        `(?:^|\\n)\\s*([^\\n]{3,120})\\n\\s*${escapeRe(company)}\\s*[·•|-]`,
        'i',
      ).exec(body);
      if (card) take('linkedin.card', null, card[1]);
    }
  }
  if (provider === 'indeed') {
    const app = /^\s*indeed application\s*:\s*(.+)$/i.exec(subject);
    if (app) take('indeed.subject', null, app[1]);
    const sentTo =
      /(?:items were sent to|has been (?:sent|submitted) to|application (?:was )?(?:sent|submitted) to)\s+([^.\n]+)/i.exec(
        body,
      );
    if (sentTo) take('indeed.body', sentTo[1]);
  }

  // Generic phrasing, subject first.
  for (const [where, text] of [
    ['subject', subject],
    ['body', body.slice(0, 4000)],
  ] as const) {
    const roleAt = new RegExp(
      `\\b(?:application|applying|apply|applied|candidacy) (?:for|to) (?:the |our )?(?:position of |role of )?(${TITLE}{2,120}?) (?:position |role |job |opening )?(?:at|with) ([^\\n.!,;(]{2,80})`,
      'i',
    ).exec(text);
    if (roleAt) take(`${where}.role_at`, roleAt[2], roleAt[1]);
    const theRoleAt = new RegExp(
      `\\b(?:the|your|our) (${TITLE}{2,100}?) (?:position|role|opening|job) (?:at|with) ([^\\n.!,;(]{2,80})`,
      'i',
    ).exec(text);
    if (theRoleAt) take(`${where}.the_role_at`, theRoleAt[2], theRoleAt[1]);
    const thanks =
      /\bthank(?:s| you) for (?:applying|your application|your interest)(?: (?:to|at|with|in))? ([^\n.!,;(]{2,80})/i.exec(
        text,
      );
    if (thanks && !/^(the|our|this|a|an)\b/i.test(thanks[1] ?? ''))
      take(`${where}.thanks`, thanks[1]);
    const roleOnly = new RegExp(
      `\\b(?:for|regarding|to) the (${TITLE}{2,100}?) (?:position|role|opening)\\b`,
      'i',
    ).exec(text);
    if (roleOnly) take(`${where}.role`, null, roleOnly[1]);
    const positionOf = /\bposition of ([^\n.!,]{2,100}?)(?: at | with |[.!,\n]|$)/i.exec(text);
    if (positionOf) take(`${where}.position_of`, null, positionOf[1]);
    const interviewWith = /\binterview with ([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,4})/.exec(
      text,
    );
    if (interviewWith) take(`${where}.interview_with`, interviewWith[1]);
  }
  return { company, title };
}

function findJobUrl(
  body: string,
  html: string | null | undefined,
): { url: string; id: string | null } | null {
  const text = `${body}\n${html ?? ''}`;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    const info = analyzeJobUrl(m[0].replace(/&amp;/g, '&'));
    if (!info) continue;
    if (info.externalId || (info.source === 'workday' && /\/job\//.test(info.url))) {
      return { url: info.url, id: info.externalId };
    }
  }
  return null;
}

/**
 * Classify an application-related email: who sent it (provider), what it means (kind),
 * and which company / job it is about.
 */
export function classifyEmail(msg: EmailMessage): EmailClassification {
  const signals: string[] = [];
  const subject = msg.subject ?? '';
  const body = emailBodyText(msg);
  const sender = parseAddress(msg.from);
  const provider = detectProvider(sender.address, body, signals);

  let kind: EmailKind = 'other';
  let confidence = 0.3;
  let decided: KindRule | null = null;
  for (const rule of KIND_RULES) {
    const hit =
      rule.where === 'subject' ? rule.re.test(subject) : rule.re.test(`${subject}\n${body}`);
    if (!hit) continue;
    if (!decided) {
      decided = rule;
      kind = rule.kind;
      confidence = rule.confidence;
      signals.push(`kind:${rule.id}`);
    } else if (rule.kind === kind && rule.id !== decided.id) {
      confidence += 0.03;
      signals.push(`kind:${rule.id}`);
    }
  }
  if (!decided) signals.push('kind:no_rule');

  const { company: extractedCompany, title } = extract(provider, subject, body, signals);
  let company = extractedCompany;
  if (!company && kind !== 'other') {
    company = companyFromSender(sender.name, sender.address);
    if (company) signals.push('company:sender');
  }

  const job = findJobUrl(body, msg.html);
  if (job) signals.push('url:job');

  // Known platforms send templated emails: trust their kind a little more.
  if (decided && provider !== 'generic' && kind !== 'other') confidence += 0.04;
  if (kind !== 'other' && !company) confidence -= 0.15;

  const interviewAt =
    kind === 'interview' || kind === 'screening'
      ? parseInterviewTime(`${subject}\n${body}`, normalizeEmailDate(msg.date) ?? null)
      : null;
  if (interviewAt) signals.push('interview_time');

  return {
    provider,
    kind,
    company,
    jobTitle: title,
    jobUrl: job?.url ?? null,
    externalJobId: job?.id ?? null,
    interviewAt,
    confidence: Math.round(Math.max(0.05, Math.min(0.98, confidence)) * 100) / 100,
    signals,
  };
}
