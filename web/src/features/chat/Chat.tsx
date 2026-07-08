"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { getSession, qk } from "./api";
import { ChatColumn } from "./components/ChatColumn";
import { QuotationPanel } from "./components/QuotationPanel";
import { SessionsSidebar } from "./components/SessionsSidebar";

export function Chat() {
  const searchParams = useSearchParams();
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const id = searchParams.get("sessionId") || searchParams.get("session");
    if (id) setActiveId(id);
  }, [searchParams]);

  // The chat column and the quotation panel render even when no session is
  // active — the column starts a session lazily on the first message or
  // upload. That avoids creating empty docs every time someone clicks
  // «+ Nueva conversación».
  const sessionQuery = useQuery({
    queryKey: activeId ? qk.session(activeId) : ["session", "none"],
    queryFn: () => (activeId ? getSession(activeId) : null),
    enabled: !!activeId,
  });

  return (
    <div className="flex h-screen min-w-0 overflow-hidden">
      <SessionsSidebar activeId={activeId} onSelect={setActiveId} />
      <section className="flex min-w-0 flex-1 overflow-hidden">
        <ChatColumn
          session={sessionQuery.data ?? null}
          onSessionCreated={setActiveId}
        />
        <aside className="hidden min-w-[480px] flex-1 overflow-y-auto border-l bg-muted/30 xl:block">
          <QuotationPanel session={sessionQuery.data ?? null} />
        </aside>
      </section>
    </div>
  );
}
