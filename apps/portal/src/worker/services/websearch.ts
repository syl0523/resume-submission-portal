import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  MessageParam,
  ToolUnion,
} from '@anthropic-ai/sdk/resources/messages/messages';
import {
  findMetro,
  type SearchQuery,
  type SearchResult,
  truncate,
  WEB_SEARCH_ALLOWED_DOMAINS,
  WEB_SEARCH_SYSTEM,
  type WebSearchPosting,
  webSearchItems,
  webSearchPrompt,
} from '@jsp/integrations';
import { z } from 'zod';
import { type Env, outboundFetch } from '../env';

/**
 * Claude web search as a Job Match source (KAN-63). Claude searches employers' careers sites and
 * ATS boards (server-side web_search tool restricted with allowed_domains, never LinkedIn or
 * Indeed) and reports open postings through a strict client tool; every reported URL must be one
 * of the search results. Costs a web search fee per search plus tokens, so it is capped
 * (WEB_SEARCH_MAX_USES searches per query, WEB_SEARCH_MAX_QUERIES queries per run) and only runs
 * on manual runs, never in the weekly refresh.
 *
 * Web search docs: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
 */

export const WEB_SEARCH_TOOL = 'web_search_20260318';
export const WEB_SEARCH_MAX_USES = 3;
export const WEB_SEARCH_MAX_QUERIES = 2;
export const WEB_SEARCH_TIMEOUT_MS = 90_000;
const DEFAULT_FAST_MODEL = 'claude-haiku-5-5';
/** pause_turn continuations before giving up on a long search turn. */
const MAX_CONTINUATIONS = 2;
const MAX_POSTINGS = 10;
const REPORT_TOOL = 'record_job_postings';

/** Needs the Anthropic key itself (not just "AI on"): web search is billed to that key. */
export function webSearchEnabled(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim());
}

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const REPORT_INPUT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['postings'],
  properties: {
    postings: {
      type: 'array',
      description: 'Open job postings found in the search results (up to 10).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'company', 'location', 'url', 'postedAt', 'snippet'],
        properties: {
          title: { type: 'string' },
          company: { type: 'string' },
          location: nullableString,
          url: { type: 'string', description: 'The posting URL exactly as in the search result.' },
          postedAt: { ...nullableString, description: 'YYYY-MM-DD when the page shows it.' },
          snippet: { ...nullableString, description: 'One or two sentences on the role.' },
        },
      },
    },
  },
};

const postingSchema = z.object({
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).nullable(),
  url: z.string().trim().min(1).max(2000),
  postedAt: z.string().trim().max(40).nullable(),
  snippet: z
    .string()
    .trim()
    .max(4000)
    .nullable()
    .transform((s) => (s ? truncate(s, 600) : null)),
});

const reportSchema = z.object({ postings: z.array(z.unknown()).max(50) });

function client(env: Env): Anthropic {
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    fetch: outboundFetch(env),
    timeout: WEB_SEARCH_TIMEOUT_MS,
    maxRetries: 1,
  });
}

function tools(q: SearchQuery): ToolUnion[] {
  const metro = !q.remote && q.location ? findMetro(q.location) : null;
  return [
    {
      type: WEB_SEARCH_TOOL,
      name: 'web_search',
      max_uses: WEB_SEARCH_MAX_USES,
      allowed_domains: [...WEB_SEARCH_ALLOWED_DOMAINS],
      // Plain searches (no code-execution filtering): cheaper, and works on every model.
      allowed_callers: ['direct'],
      user_location: metro
        ? { type: 'approximate', ...metro.providers.userLocation }
        : { type: 'approximate', country: 'US' },
    },
    {
      name: REPORT_TOOL,
      description: 'Report the open job postings found with web_search. Call exactly once.',
      input_schema: REPORT_INPUT_SCHEMA,
      strict: true,
    },
  ];
}

/** URLs of every search result in a response. */
function resultUrls(content: ContentBlock[]): string[] {
  const urls: string[] = [];
  for (const block of content) {
    if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue;
    for (const r of block.content) urls.push(r.url);
  }
  return urls;
}

/** SDK errors as short provider messages (shown on the Job Match status strip). */
function describeFailure(err: unknown): Error {
  if (err instanceof Anthropic.RateLimitError) {
    return new Error('Claude web search is busy (rate limited)');
  }
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    return new Error('Claude web search: the API key was rejected');
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new Error(`Claude web search was refused: ${truncate(err.message, 160)}`);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new Error('Claude web search could not be reached');
  }
  if (err instanceof Anthropic.APIError) {
    return new Error(`Claude web search failed (${err.status ?? 'network error'})`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * One title x location query: Claude searches (at most WEB_SEARCH_MAX_USES times), then reports
 * postings through the record_job_postings tool. Only postings whose URL is an allowed careers or
 * ATS page that appeared in the search results are returned.
 */
export async function searchWeb(
  env: Env,
  q: SearchQuery,
  opts: { signal?: AbortSignal } = {},
): Promise<SearchResult> {
  const model = env.AI_MODEL_FAST?.trim() || DEFAULT_FAST_MODEL;
  const messages: MessageParam[] = [
    { role: 'user', content: webSearchPrompt(q, WEB_SEARCH_MAX_USES) },
  ];
  const urls: string[] = [];
  let report: unknown = null;
  try {
    for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
      const res = await client(env).messages.create(
        {
          model,
          max_tokens: 4096,
          system: WEB_SEARCH_SYSTEM,
          messages,
          tools: tools(q),
          tool_choice: { type: 'auto' },
        },
        { signal: opts.signal },
      );
      urls.push(...resultUrls(res.content));
      const call = res.content.find((b) => b.type === 'tool_use' && b.name === REPORT_TOOL);
      if (call && call.type === 'tool_use') {
        report = call.input;
        break;
      }
      // A long search turn can pause; send it back unchanged to let Claude continue.
      if (res.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: res.content });
    }
  } catch (err) {
    throw describeFailure(err);
  }

  const parsed = reportSchema.safeParse(report);
  if (!parsed.success) return { items: [], total: 0 };
  const postings: WebSearchPosting[] = [];
  for (const raw of parsed.data.postings) {
    const p = postingSchema.safeParse(raw);
    if (p.success) postings.push(p.data);
  }
  const items = webSearchItems(postings, urls, MAX_POSTINGS);
  return { items, total: items.length };
}
