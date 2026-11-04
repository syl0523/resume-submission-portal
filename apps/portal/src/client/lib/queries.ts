import type {
  ApiTokenInfo,
  ApplicationDetail,
  ApplicationListItem,
  BoardPosting,
  DashboardStats,
  InboxItem,
  ListResponse,
  MeResponse,
  Profile,
  Resume,
  SavedSearch,
  SearchHit,
  WatchedBoard,
} from '@jsp/core';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { api, qs } from './api';

/** Query keys and hooks for every API resource the portal shows. */

export const keys = {
  me: ['me'] as const,
  stats: ['stats'] as const,
  applications: (params: ApplicationParams) => ['applications', params] as const,
  applicationsAll: ['applications'] as const,
  application: (id: string) => ['application', id] as const,
  resumes: (archived: boolean) => ['resumes', archived] as const,
  resumesAll: ['resumes'] as const,
  profile: ['profile'] as const,
  tokens: ['tokens'] as const,
  inbox: (status: string) => ['inbox', status] as const,
  inboxAll: ['inbox'] as const,
  boards: ['boards'] as const,
  postings: (params: PostingParams) => ['postings', params] as const,
  postingsAll: ['postings'] as const,
  searches: ['searches'] as const,
  search: (id: string) => ['search', id] as const,
  hits: (id: string, params: HitParams) => ['hits', id, params] as const,
  hitsAll: ['hits'] as const,
};

export interface ApplicationParams {
  q?: string;
  status?: string;
  source?: string;
  sort?: string;
  limit?: number;
}

export interface PostingParams {
  boardId?: string;
  onlyNew?: boolean;
  q?: string;
}

export interface HitParams {
  onlyNew?: boolean;
  sort?: 'fit' | 'new';
}

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: () => api<MeResponse>('/api/me'), staleTime: 5 * 60_000 });

export const useStats = () =>
  useQuery({ queryKey: keys.stats, queryFn: () => api<DashboardStats>('/api/stats') });

export const useApplications = (params: ApplicationParams) =>
  useQuery({
    queryKey: keys.applications(params),
    queryFn: () => api<ListResponse<ApplicationListItem>>(`/api/applications${qs({ ...params })}`),
    placeholderData: (prev) => prev,
  });

export const useApplication = (id: string) =>
  useQuery({
    queryKey: keys.application(id),
    queryFn: () => api<ApplicationDetail>(`/api/applications/${id}`),
  });

export const useResumes = (includeArchived = false) =>
  useQuery({
    queryKey: keys.resumes(includeArchived),
    queryFn: () =>
      api<Resume[]>(`/api/resumes${qs({ includeArchived: includeArchived ? 'true' : null })}`),
  });

export const useProfile = () =>
  useQuery({ queryKey: keys.profile, queryFn: () => api<Profile>('/api/profile') });

export const useTokens = () =>
  useQuery({ queryKey: keys.tokens, queryFn: () => api<ApiTokenInfo[]>('/api/tokens') });

export const useInbox = (status: string) =>
  useQuery({
    queryKey: keys.inbox(status),
    queryFn: () => api<ListResponse<InboxItem>>(`/api/inbox${qs({ status, limit: 100 })}`),
  });

export const useBoards = () =>
  useQuery({ queryKey: keys.boards, queryFn: () => api<WatchedBoard[]>('/api/boards') });

export const usePostings = (params: PostingParams) =>
  useQuery({
    queryKey: keys.postings(params),
    queryFn: () =>
      api<ListResponse<BoardPosting>>(
        `/api/boards/postings${qs({ boardId: params.boardId, onlyNew: params.onlyNew ? 'true' : null, q: params.q, limit: 100 })}`,
      ),
    placeholderData: (prev) => prev,
  });

export const useSearches = () =>
  useQuery({ queryKey: keys.searches, queryFn: () => api<SavedSearch[]>('/api/searches') });

export const useSearch = (id: string) =>
  useQuery({ queryKey: keys.search(id), queryFn: () => api<SavedSearch>(`/api/searches/${id}`) });

export const useHits = (id: string, params: HitParams) =>
  useQuery({
    queryKey: keys.hits(id, params),
    queryFn: () =>
      api<ListResponse<SearchHit>>(
        `/api/searches/${id}/hits${qs({ onlyNew: params.onlyNew ? 'true' : null, sort: params.sort, limit: 100 })}`,
      ),
  });

/** After anything that changes applications: lists, detail, dashboard. */
export function invalidateApplications(qc: QueryClient, id?: string) {
  void qc.invalidateQueries({ queryKey: keys.applicationsAll });
  void qc.invalidateQueries({ queryKey: keys.stats });
  if (id) void qc.invalidateQueries({ queryKey: keys.application(id) });
}
