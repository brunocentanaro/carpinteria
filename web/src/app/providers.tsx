"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The Python subprocess is ~1-2s per call; cache freshness at 30s
            // strikes a balance between staleness and avoiding hammering it.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
          mutations: {
            // Default error notification for every mutation. Each callsite
            // can still add `onSuccess` for explicit confirmation toasts.
            onError: (error) => {
              const msg = error instanceof Error ? error.message : String(error);
              console.error(msg);
            },
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
