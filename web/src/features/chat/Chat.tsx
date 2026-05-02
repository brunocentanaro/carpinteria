"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getSession, qk } from "./api";
import { ChatColumn } from "./components/ChatColumn";
import { QuotationPanel } from "./components/QuotationPanel";
import { SessionsSidebar } from "./components/SessionsSidebar";

export function Chat() {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sessionQuery = useQuery({
    queryKey: activeId ? qk.session(activeId) : ["session", "none"],
    queryFn: () => (activeId ? getSession(activeId) : null),
    enabled: !!activeId,
  });

  return (
    <div className="flex h-screen">
      <SessionsSidebar activeId={activeId} onSelect={setActiveId} />
      {activeId ? (
        <section className="flex-1 flex overflow-hidden">
          <ChatColumn session={sessionQuery.data ?? null} />
          <aside className="flex-1 min-w-[480px] border-l bg-muted/30 overflow-y-auto">
            <QuotationPanel session={sessionQuery.data ?? null} />
          </aside>
        </section>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Elegí una sesión o creá una nueva para empezar.
        </div>
      )}
    </div>
  );
}
