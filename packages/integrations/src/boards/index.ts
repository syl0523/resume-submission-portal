import type { BoardProvider, JobDraft, JobInputParsed } from '@jsp/core';
import { NotImplementedError } from '../errors';

export interface FetchOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export interface BoardJob {
  externalId: string;
  job: JobInputParsed;
}

export interface BoardRef {
  provider: BoardProvider;
  token: string;
}

/**
 * Recognise a company careers URL hosted on a supported ATS.
 * TODO(integrations agent): implement for Greenhouse, Lever, Ashby and SmartRecruiters.
 */
export function parseBoardUrl(url: string): BoardRef | null {
  void url;
  return null;
}

/**
 * List open postings from an ATS's official public job-board API.
 * TODO(integrations agent): implement.
 */
export async function fetchBoardJobs(
  provider: BoardProvider,
  token: string,
  opts: FetchOptions = {},
): Promise<BoardJob[]> {
  void provider;
  void token;
  void opts;
  throw new NotImplementedError('fetchBoardJobs');
}

/**
 * Fetch one posting's details from the official API when the URL belongs to a supported ATS.
 * Returns null for unsupported URLs (LinkedIn, Indeed, unknown company sites).
 * TODO(integrations agent): implement.
 */
export async function fetchJobFromUrl(
  url: string,
  opts: FetchOptions = {},
): Promise<JobDraft | null> {
  void url;
  void opts;
  return null;
}
