"use client";

import { useQuery } from "@tanstack/react-query";
import { listPendingSessions, qk } from "./api";

export function usePendingSessions(brandId: string, limit = 50) {
  return useQuery({
    queryKey: [...qk.sessions(brandId), "pending", limit],
    queryFn: () => listPendingSessions(brandId, limit),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
