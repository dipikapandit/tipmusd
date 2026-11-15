"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Analytics,
  CreateProfileRequest,
  CreatorProfile,
  DashboardOverview,
  MeResponse,
  NotificationItem,
  SyncResult,
  TipLink,
  TipView,
  TipsPage,
  UpdateProfileRequest,
  UsernameCheck,
} from "@/lib/api-types";
import { TERMINAL_TIP_STATUSES } from "@/lib/api-types";
import { ApiClientError, api, qs } from "@/lib/client/api";

/** Query keys. Everything API-backed lives under ["api", …] so sign-out can clear it in one go. */
export const qk = {
  me: ["api", "me"] as const,
  profile: ["api", "profile"] as const,
  overview: ["api", "dashboard", "overview"] as const,
  tips: (filters: Record<string, string>) => ["api", "dashboard", "tips", filters] as const,
  analytics: (range: string) => ["api", "dashboard", "analytics", range] as const,
  links: ["api", "links"] as const,
  notifications: ["api", "notifications"] as const,
  tip: (id: string) => ["api", "tip", id] as const,
  username: (u: string) => ["api", "username", u] as const,
};

/** /api/auth/me. A 401 means "signed out", not an error. */
export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      try {
        return await api<MeResponse>("/api/auth/me");
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 30_000,
  });
}

export function useUsernameCheck(username: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.username(username),
    queryFn: () => api<UsernameCheck>(`/api/usernames/check${qs({ u: username })}`),
    enabled: enabled && username.length > 0,
    staleTime: 15_000,
    retry: 0,
  });
}

function useSetProfile() {
  const qc = useQueryClient();
  return (p: CreatorProfile) => {
    qc.setQueryData(qk.profile, p);
    qc.setQueryData<MeResponse | null>(qk.me, (m) => (m ? { ...m, profile: p } : m));
    void qc.invalidateQueries({ queryKey: qk.overview });
  };
}

export function useCreateProfile() {
  const set = useSetProfile();
  return useMutation({
    mutationFn: (body: CreateProfileRequest) => api<CreatorProfile>("/api/profile", { method: "POST", json: body }),
    onSuccess: set,
  });
}

export function useUpdateProfile() {
  const set = useSetProfile();
  return useMutation({
    mutationFn: (body: UpdateProfileRequest) => api<CreatorProfile>("/api/profile", { method: "PATCH", json: body }),
    onSuccess: set,
  });
}

export function useUploadAvatar() {
  const set = useSetProfile();
  return useMutation({
    mutationFn: (dataUrl: string) => api<CreatorProfile>("/api/profile/avatar", { method: "PUT", json: { dataUrl } }),
    onSuccess: set,
  });
}

export function useRemoveAvatar() {
  const set = useSetProfile();
  return useMutation({
    mutationFn: () => api<CreatorProfile>("/api/profile/avatar", { method: "DELETE" }),
    onSuccess: set,
  });
}

export function useOverview(enabled = true) {
  return useQuery({ queryKey: qk.overview, queryFn: () => api<DashboardOverview>("/api/dashboard/overview"), enabled, refetchInterval: 30_000 });
}

/** Throttled catch-up of the on-chain indexer, then refresh dashboard data. */
export function useIndexerSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<SyncResult>("/api/indexer/sync", { method: "POST", json: {} }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["api", "dashboard"] }),
  });
}

export interface TipFilters {
  status?: string;
  from?: string;
  to?: string;
}

export function useTipsPage(filters: TipFilters, enabled = true) {
  const f = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string>;
  return useInfiniteQuery({
    queryKey: qk.tips(f),
    queryFn: ({ pageParam }) => api<TipsPage>(`/api/dashboard/tips${qs({ ...f, cursor: pageParam, limit: 25 })}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useAnalytics(range: Analytics["range"], enabled = true) {
  return useQuery({
    queryKey: qk.analytics(range),
    queryFn: () => api<Analytics>(`/api/dashboard/analytics${qs({ range })}`),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useTipLinks(enabled = true) {
  return useQuery({ queryKey: qk.links, queryFn: () => api<TipLink[]>("/api/profile/links"), enabled });
}

export function useCreateTipLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { slug: string; campaignName: string }) => api<TipLink>("/api/profile/links", { method: "POST", json: body }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.links }),
  });
}

export function useUpdateTipLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; campaignName?: string; isActive?: boolean }) =>
      api<TipLink>(`/api/profile/links/${encodeURIComponent(id)}`, { method: "PATCH", json: body }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.links }),
  });
}

export function useNotifications(enabled = true) {
  return useQuery({ queryKey: qk.notifications, queryFn: () => api<NotificationItem[]>("/api/notifications"), enabled, refetchInterval: 30_000 });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => api<{ ok: true }>("/api/notifications/read", { method: "POST", json: ids ? { ids } : {} }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  });
}

export const isTerminal = (s: TipView["status"] | undefined) => Boolean(s && TERMINAL_TIP_STATUSES.includes(s));

/** A tip's public status. Polls every 2.5 s until it reaches a terminal state, and keeps polling a confirmed tip
 *  for up to 2 minutes while its Bitcoin-funding claim is still being checked on chain. */
export function useTip(id: string | null | undefined, initial?: TipView) {
  return useQuery({
    queryKey: qk.tip(id ?? ""),
    queryFn: () => api<TipView>(`/api/tips/${encodeURIComponent(id!)}`),
    enabled: Boolean(id),
    initialData: initial,
    refetchInterval: (q) => {
      const t = q.state.data;
      if (!isTerminal(t?.status)) return 2_500;
      const fundingPending = t?.status === "confirmed" && t.funding && !t.funding.verified;
      const recent = t?.verifiedAt ? Date.now() - new Date(t.verifiedAt).getTime() < 120_000 : false;
      return fundingPending && recent ? 3_000 : false;
    },
    refetchIntervalInBackground: true,
  });
}
