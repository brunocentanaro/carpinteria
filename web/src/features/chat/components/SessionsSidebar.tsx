"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createSession, listSessions, qk } from "../api";
import { MemoryPanel } from "./MemoryPanel";

interface SessionsSidebarProps {
  activeId: string | null;
  onSelect: (id: string) => void;
}

export function SessionsSidebar({ activeId, onSelect }: SessionsSidebarProps) {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: listSessions });

  const createMutation = useMutation({
    mutationFn: createSession,
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: qk.sessions });
      onSelect(s.id);
    },
  });

  return (
    <aside className="w-64 border-r bg-muted/30 flex flex-col">
      <div className="p-3 border-b">
        <Button
          className="w-full"
          onClick={() => createMutation.mutate({})}
          disabled={createMutation.isPending}
        >
          <Plus className="h-4 w-4 mr-1" />
          Nueva sesión
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="text-xs uppercase font-semibold text-muted-foreground mb-2">
          Sesiones
        </div>
        <ul className="space-y-1">
          {sessions.data?.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => onSelect(s.id)}
                className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                  activeId === s.id
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted"
                }`}
              >
                <div className="truncate">{s.title || s.id.slice(0, 8)}</div>
                <div className="text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(s.updated_at), {
                    addSuffix: true,
                    locale: es,
                  })}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t p-3 max-h-[40%] overflow-y-auto">
        <MemoryPanel />
      </div>
    </aside>
  );
}
