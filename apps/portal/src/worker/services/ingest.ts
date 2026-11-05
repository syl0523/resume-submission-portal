import {
  type ApplicationStatus,
  type ApplyChannel,
  type Classifier,
  decideTransition,
  EMAIL_KIND_TO_STATUS,
  type EmailClassification,
  type EmailProvider,
  type InboxItem,
  type IngestResult,
  type JobSource,
  jobInputSchema,
  STATUS_META,
} from '@jsp/core';
import {
  classifyEmail,
  type EmailMessage,
  emailBodyText,
  type MatchCandidate,
  matchApplication,
  truncate,
  unwrapForwarded,
} from '@jsp/integrations';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { applications, type InboundEmailRow, inboundEmails, jobs } from '../db/schema';
import type { AuthUser, Env } from '../env';
import { newId } from '../lib/crypto';
import { describeError, errorSummary } from '../lib/errors';
import { toInboxItem } from '../lib/mappers';
import { nowIso, toIso } from '../lib/time';
import { aiEnabled, classifyEmailWithAi } from './ai';
import { addEvent, createApplication, transitionStatus } from './applications';

/**
 * Email ingest (KAN-22): the Email Worker and "paste an email" both end here. Steps follow
 * docs/api.md, "Ingest pipeline". Processing errors are recorded on the inbox item, never thrown.
 */

export interface IngestInput {
  /** Decoded message as delivered (forwards are unwrapped here). */
  message: EmailMessage;
  /** Idempotency key: the Message-ID header, or a content hash for pasted text. */
  messageId: string | null;
  /** When the portal received it, ISO-8601. */
  receivedAt: string;
  /** Raw MIME, stored in R2 for reference when present. */
  raw?: string | ArrayBuffer | Uint8Array | null;
}

const AI_THRESHOLD = 0.6;
const CANDIDATE_LIMIT = 500;

const PROVIDER_LABEL: Record<EmailProvider, string> = {
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
  smartrecruiters: 'SmartRecruiters',
  icims: 'iCIMS',
  taleo: 'Taleo',
  successfactors: 'SuccessFactors',
  generic: 'email',
};

export function providerSource(provider: EmailProvider): JobSource {
  switch (provider) {
    case 'linkedin':
    case 'indeed':
    case 'greenhouse':
    case 'lever':
    case 'ashby':
    case 'workday':
    case 'smartrecruiters':
      return provider;
    default:
      return 'email';
  }
}

export function providerChannel(provider: EmailProvider): ApplyChannel {
  if (provider === 'linkedin') return 'linkedin_easy_apply';
  if (provider === 'indeed') return 'indeed_apply';
  return 'company_site';
}

function emailNote(provider: EmailProvider, subject: string): string {
  const who = provider === 'generic' ? 'Email' : `Email from ${PROVIDER_LABEL[provider]}`;
  return subject.trim() ? `${who}: “${truncate(subject.trim(), 140)}”` : who;
}

/** Timeline text for an email: the status move when there is one, then where it came from. */
export function emailEventSummary(
  current: ApplicationStatus,
  proposed: ApplicationStatus | null,
  provider: EmailProvider,
  subject: string,
): string {
  const note = emailNote(provider, subject);
  if (!proposed) return note;
  const decision = decideTransition(current, proposed, 'email');
  return decision.apply
    ? `${STATUS_META[current].label} → ${STATUS_META[proposed].label} · ${note}`
    : note;
}

function rawKey(userId: string, inboxId: string, at: string): string {
  return `inbound/${userId}/${at.slice(0, 4)}/${at.slice(5, 7)}/${inboxId}.eml`;
}

async function loadInboxItem(db: Db, userId: string, id: string): Promise<InboxItem | null> {
  const row = await db
    .select({ inbox: inboundEmails, app: applications, job: jobs })
    .from(inboundEmails)
    .leftJoin(applications, eq(applications.id, inboundEmails.applicationId))
    .leftJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(inboundEmails.id, id), eq(inboundEmails.userId, userId)))
    .get();
  if (!row) return null;
  return toInboxItem(
    row.inbox,
    row.app && row.job
      ? { id: row.app.id, company: row.job.company, title: row.job.title, status: row.app.status }
      : null,
  );
}

export async function getInboxItem(db: Db, userId: string, id: string): Promise<InboxItem> {
  const item = await loadInboxItem(db, userId, id);
  if (!item) throw new Error(`Inbox item ${id} vanished`);
  return item;
}

async function existingByMessageId(
  db: Db,
  userId: string,
  messageId: string,
): Promise<InboundEmailRow | undefined> {
  return db
    .select()
    .from(inboundEmails)
    .where(and(eq(inboundEmails.userId, userId), eq(inboundEmails.messageId, messageId)))
    .get();
}

async function candidatesFor(db: Db, userId: string): Promise<MatchCandidate[]> {
  const rows = await db
    .select({
      id: applications.id,
      status: applications.status,
      appliedAt: applications.appliedAt,
      lastActivityAt: applications.lastActivityAt,
      company: jobs.company,
      title: jobs.title,
      url: jobs.url,
      externalId: jobs.externalId,
      source: jobs.source,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(eq(applications.userId, userId))
    .orderBy(desc(applications.lastActivityAt))
    .limit(CANDIDATE_LIMIT)
    .all();
  return rows;
}

/** Apply an email to an application: implied status through the engine, always a timeline entry. */
export async function applyEmailToApplication(
  db: Db,
  env: Env,
  userId: string,
  applicationId: string,
  email: {
    kind: EmailClassification['kind'];
    provider: EmailProvider;
    subject: string;
    occurredAt: string;
    inboundEmailId: string;
    interviewAt?: string | null;
  },
): Promise<boolean> {
  const current = await db
    .select({ status: applications.status })
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .get();
  if (!current) return false;
  const proposed = EMAIL_KIND_TO_STATUS[email.kind];
  const summary = emailEventSummary(current.status, proposed, email.provider, email.subject);
  let changed = false;
  if (proposed) {
    const result = await transitionStatus(db, env, userId, applicationId, {
      proposed,
      source: 'email',
      eventType: 'email',
      alwaysRecord: true,
      occurredAt: email.occurredAt,
      summary,
      inboundEmailId: email.inboundEmailId,
    });
    changed = result.changed;
  } else {
    await addEvent(db, userId, applicationId, {
      type: 'email',
      source: 'email',
      summary,
      occurredAt: email.occurredAt,
      inboundEmailId: email.inboundEmailId,
    });
  }
  if (email.kind === 'interview' && email.interviewAt) {
    await addEvent(db, userId, applicationId, {
      type: 'interview',
      source: 'email',
      summary: 'Interview (from email)',
      scheduledAt: email.interviewAt,
      occurredAt: email.occurredAt,
      inboundEmailId: email.inboundEmailId,
    });
  }
  return changed;
}

export async function ingestEmail(
  db: Db,
  env: Env,
  user: AuthUser,
  input: IngestInput,
): Promise<IngestResult> {
  const userId = user.id;
  const replay = async (row: InboundEmailRow): Promise<IngestResult> => ({
    item: await getInboxItem(db, userId, row.id),
    applicationId: row.applicationId,
    created: false,
    statusChanged: false,
  });

  if (input.messageId) {
    const existing = await existingByMessageId(db, userId, input.messageId);
    if (existing) return replay(existing);
  }

  const original = unwrapForwarded(input.message);
  const body = emailBodyText(original);
  let classification = classifyEmail(original);
  let classifier: Classifier = 'rules';
  if (classification.confidence < AI_THRESHOLD && aiEnabled(env)) {
    try {
      const second = await classifyEmailWithAi(env, original, classification);
      if (second && second.confidence > classification.confidence) {
        classification = second;
        classifier = 'ai';
      }
    } catch (err) {
      console.warn('AI email classification failed', describeError(err));
    }
  }

  const occurredAt = toIso(original.date ?? null) ?? input.receivedAt;
  const id = newId();
  let storedKey: string | null = null;
  if (input.raw) {
    const key = rawKey(userId, id, input.receivedAt);
    try {
      await env.FILES.put(key, input.raw, { httpMetadata: { contentType: 'message/rfc822' } });
      storedKey = key;
    } catch (err) {
      console.warn('Could not store the raw email', describeError(err));
    }
  }

  try {
    await db.insert(inboundEmails).values({
      id,
      userId,
      messageId: input.messageId,
      fromAddress: truncate(original.from.trim() || 'unknown sender', 320),
      subject: truncate(original.subject.trim() || '(no subject)', 1000),
      receivedAt: occurredAt,
      provider: classification.provider,
      kind: classification.kind,
      company: classification.company,
      jobTitle: classification.jobTitle,
      confidence: classification.confidence,
      classifier,
      applicationId: null,
      status: 'unmatched',
      error: null,
      snippet: body ? truncate(body.replace(/\s+/g, ' ').trim(), 500) : null,
      rawKey: storedKey,
      createdAt: nowIso(),
    });
  } catch (err) {
    // The same Message-ID delivered twice at once: the other delivery won.
    if (input.messageId) {
      const existing = await existingByMessageId(db, userId, input.messageId);
      if (existing) return replay(existing);
    }
    throw err;
  }

  let status: InboxItem['status'] = 'unmatched';
  let applicationId: string | null = null;
  let created = false;
  let statusChanged = false;
  try {
    if (classification.kind === 'other') {
      status = 'ignored';
    } else {
      const match = matchApplication(classification, await candidatesFor(db, userId));
      const emailFacts = {
        kind: classification.kind,
        provider: classification.provider,
        subject: original.subject,
        occurredAt,
        inboundEmailId: id,
        interviewAt: classification.interviewAt,
      };
      if (match) {
        applicationId = match.applicationId;
        statusChanged = await applyEmailToApplication(db, env, userId, applicationId, emailFacts);
        status = 'matched';
      } else if (
        classification.kind === 'application_received' &&
        classification.company &&
        classification.jobTitle
      ) {
        const result = await createApplication(db, env, userId, {
          job: jobInputSchema.parse({
            title: classification.jobTitle,
            company: classification.company,
            url: classification.jobUrl,
            externalId: classification.externalJobId,
            source: providerSource(classification.provider),
          }),
          status: 'applied',
          capturedVia: 'email',
          source: 'email',
          appliedAt: occurredAt,
          appliedVia: providerChannel(classification.provider),
          occurredAt,
          eventType: 'email',
          summary: `Applied · ${emailNote(classification.provider, original.subject)}`,
          inboundEmailId: id,
        });
        applicationId = result.applicationId;
        if (result.duplicate) {
          statusChanged = await applyEmailToApplication(db, env, userId, applicationId, emailFacts);
          status = 'matched';
        } else {
          created = true;
          statusChanged = true;
          status = 'created';
        }
      }
    }
    await db.update(inboundEmails).set({ status, applicationId }).where(eq(inboundEmails.id, id));
  } catch (err) {
    console.error('Email ingest failed', describeError(err));
    await db
      .update(inboundEmails)
      .set({
        status: 'error',
        applicationId,
        error: errorSummary(err),
      })
      .where(eq(inboundEmails.id, id));
    return { item: await getInboxItem(db, userId, id), applicationId, created, statusChanged };
  }

  return { item: await getInboxItem(db, userId, id), applicationId, created, statusChanged };
}
