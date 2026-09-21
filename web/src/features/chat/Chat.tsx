"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";

import { useBrandEnvironment } from "@/components/BrandEnvironmentProvider";
import { getAuthMe, getSession, qk } from "./api";
import { ChatColumn } from "./components/ChatColumn";
import { QuotationPanel } from "./components/QuotationPanel";
import { SessionsSidebar } from "./components/SessionsSidebar";

export function Chat() {
  // The active session lives in the URL (?sessionId=…) so a conversation is
  // linkable/refreshable. nuqs keeps state and the query string in sync; every
  // setActiveId call updates the URL.
  const { brandId } = useBrandEnvironment();
  const [originParam, setOrigin] = useQueryState("origin");
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

  const origin = originParam === "pirone" || (originParam !== "casa" && sessionQuery.data?.brand_id === "pirone") ? "pirone" : "casa";
  const changeOrigin = (value: "casa" | "pirone") => {
    if (value !== origin) setActiveId("");
    setOrigin(value);
  };
  const onCreated = (id: string) => {
    if (brandId === "pirone") setOrigin("pirone");
    setActiveId(id);
  };

  // The owner (área "administracion") sees the agent trace panel for debugging.
  const meQuery = useQuery({ queryKey: ["auth", "me"], queryFn: getAuthMe, staleTime: 5 * 60 * 1000 });
  const isAdmin = meQuery.data?.area === "administracion";
  const isOwner = meQuery.data?.area === "administracion" || !!meQuery.data?.allAccess;

  return (
    <div className="flex h-screen min-w-0 overflow-hidden">
      <SessionsSidebar activeId={activeId} onSelect={setActiveId} origin={origin} onOriginChange={changeOrigin} />
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {brandId === "pirone" && <div className="border-b bg-muted/30 px-4 py-2 text-sm font-medium">
          {sessionQuery.data ? (sessionQuery.data.brand_id === "pirone" ? "Cotización propia de Juan Pirone" : "Cotización de La Casa del Carpintero") : "Las nuevas cotizaciones se crean a nombre de Juan Pirone"}
        </div>}
        <div className="flex min-h-0 flex-1 overflow-hidden">
        <ChatColumn
          session={sessionQuery.data ?? null}
          onSessionCreated={onCreated}
          isOwner={isOwner}
        />
        <aside className="hidden min-w-[480px] flex-1 overflow-y-auto border-l bg-muted/30 xl:block">
          <QuotationPanel session={sessionQuery.data ?? null} isAdmin={isAdmin} />
        </aside>
        </div>
      </section>
    </div>
  );
}
