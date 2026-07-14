"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";

import { getAuthMe, getSession, qk } from "./api";
import { ChatColumn } from "./components/ChatColumn";
import { QuotationPanel } from "./components/QuotationPanel";
import { SessionsSidebar } from "./components/SessionsSidebar";

export function Chat() {
  // The active session lives in the URL (?sessionId=…) so a conversation is
  // linkable/refreshable. nuqs keeps state and the query string in sync; every
  // setActiveId call updates the URL.
  const [sessionIdParam, setActiveId] = useQueryState("sessionId");

  // Back-compat: honor an older ?session=… alias by deriving it (no effect —
  // the nuqs value wins once the user selects/creates a session).
  const legacyId = useSearchParams().get("session");
  const activeId = sessionIdParam ?? legacyId;

  // The chat column and the quotation panel render even when no session is
  // active — the column starts a session lazily on the first message or
  // upload. That avoids creating empty docs every time someone clicks
  // «+ Nueva conversación».
  const sessionQuery = useQuery({
    queryKey: activeId ? qk.session(activeId) : ["session", "none"],
    queryFn: () => (activeId ? getSession(activeId) : null),
    enabled: !!activeId,
  });

  // The owner (área "administracion") sees the agent trace panel for debugging.
  const meQuery = useQuery({ queryKey: ["auth", "me"], queryFn: getAuthMe, staleTime: 5 * 60 * 1000 });
  const isOwner = meQuery.data?.area === "administracion" || !!meQuery.data?.allAccess;

  return (
    <div className="flex h-screen">
      <SessionsSidebar activeId={activeId} onSelect={setActiveId} />
      <section className="flex-1 flex overflow-hidden">
        <ChatColumn
          session={sessionQuery.data ?? null}
          onSessionCreated={setActiveId}
          isOwner={isOwner}
        />
        <aside className="flex-1 min-w-[480px] border-l bg-muted/30 overflow-y-auto">
          <QuotationPanel session={sessionQuery.data ?? null} />
        </aside>
      </section>
    </div>
  );
}
