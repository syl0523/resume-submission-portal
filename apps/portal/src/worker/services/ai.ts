import type { AiAnswer, EmailClassification, Profile } from '@jsp/core';
import type { EmailMessage } from '@jsp/integrations';
import type { ResumeRow } from '../db/schema';
import type { Env } from '../env';
import { HttpError } from '../lib/errors';

/**
 * Claude-powered helpers. Owned by the automation API agent (KAN-32, KAN-33, KAN-39, KAN-44, KAN-45):
 * email second opinion, fit report + cover letter, answers, saved-search and profile drafts from a
 * resume, hit re-ranking. Keep the two exported signatures below stable: other routes call them.
 */

export function aiEnabled(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim());
}

export function requireAi(env: Env): void {
  if (!aiEnabled(env)) {
    throw new HttpError(501, 'feature_disabled', 'AI is not configured (set ANTHROPIC_API_KEY)');
  }
}

export interface AnswerQuestionInput {
  question: string;
  maxWords: number;
  profile: Profile;
  job: { title: string; company: string; description: string | null } | null;
}

/** Draft an answer to an application question, grounded in the profile. TODO(api-automation agent). */
export async function answerQuestion(env: Env, input: AnswerQuestionInput): Promise<AiAnswer> {
  requireAi(env);
  void input;
  throw new HttpError(501, 'feature_disabled', 'AI answers are not implemented yet');
}

/**
 * Read contact details, headline, summary, skills, languages, experience and education from a
 * resume (PDF as a document block, other files from their stored text), merged over `current`.
 * Not saved. TODO(api-automation agent, KAN-44).
 */
export async function draftProfileFromResume(
  env: Env,
  resume: ResumeRow,
  current: Profile,
): Promise<Profile> {
  requireAi(env);
  void resume;
  void current;
  throw new HttpError(501, 'feature_disabled', 'Profile drafts are not implemented yet');
}

/**
 * Second opinion for an email the rules are unsure about (confidence < 0.6). Returns null when it
 * cannot do better. TODO(KAN-32).
 */
export async function classifyEmailWithAi(
  env: Env,
  message: EmailMessage,
  rules: EmailClassification,
): Promise<EmailClassification | null> {
  void env;
  void message;
  void rules;
  return null;
}
