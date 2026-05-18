"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteSession, listSessions, patchSession, qk } from "../api";
import type { SessionRow } from "../schemas";
import { MemoryPanel } from "./MemoryPanel";

interface SessionsSidebarProps {
  activeId: string | null;
  /** Pass `null` to start a brand-new (still-virtual) conversation. */
  onSelect: (id: string | null) => void;
}

export function SessionsSidebar({ activeId, onSelect }: SessionsSidebarProps) {
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: listSessions });

  return (
    <aside className="w-64 border-r bg-muted/30 flex flex-col">
      <div className="p-3 border-b">
        <Button
          className="w-full"
          onClick={() => onSelect(null)}
          variant={activeId === null ? "default" : "outline"}
        >
          <Plus className="h-4 w-4 mr-1" />
          Nueva conversación
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="text-xs uppercase font-semibold text-muted-foreground mb-2">
          Sesiones
        </div>
        <ul className="space-y-1">
          {sessions.data?.map((s) => (
            <SessionRowItem
              key={s.id}
              session={s}
              active={activeId === s.id}
              onSelect={onSelect}
            />
          ))}
        </ul>
      </div>
      <div className="border-t p-3 max-h-[40%] overflow-y-auto">
        <MemoryPanel />
      </div>
    </aside>
  );
}

function SessionRowItem({
  session,
  active,
  onSelect,
}: {
  session: SessionRow;
  active: boolean;
  onSelect: (id: string | null) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <li
      className={`group rounded transition-colors flex items-center ${
        active ? "bg-primary/10 text-primary" : "hover:bg-muted"
      }`}
    >
      <button
        onClick={() => onSelect(session.id)}
        className="flex-1 text-left px-2 py-1.5 text-sm min-w-0"
      >
        <div className="truncate">
          {session.title || (
            <span className="text-muted-foreground">Sin título</span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {formatDistanceToNow(new Date(session.updated_at), {
            addSuffix: true,
            locale: es,
          })}
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 mr-1 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <Pencil className="h-3.5 w-3.5 mr-2" />
            Renombrar
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setDeleting(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" />
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {renaming && (
        <RenameDialog
          session={session}
          onClose={() => setRenaming(false)}
        />
      )}
      {deleting && (
        <DeleteDialog
          session={session}
          active={active}
          onClose={() => setDeleting(false)}
          onSelect={onSelect}
        />
      )}
    </li>
  );
}

function RenameDialog({
  session,
  onClose,
}: {
  session: SessionRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(session.title);

  const mutation = useMutation({
    mutationFn: (newTitle: string) => patchSession(session.id, { title: newTitle }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.sessions });
      queryClient.invalidateQueries({ queryKey: qk.session(session.id) });
      toast.success("Renombrado");
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Renombrar conversación</DialogTitle>
          <DialogDescription>
            Cambiá el título que se muestra en la barra lateral.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="title-input">Título</Label>
          <Input
            id="title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") mutation.mutate(title.trim());
            }}
            autoFocus
            placeholder="Cocina Pereira"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => mutation.mutate(title.trim())}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  session,
  active,
  onClose,
  onSelect,
}: {
  session: SessionRow;
  active: boolean;
  onClose: () => void;
  onSelect: (id: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deleteSession(session.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.sessions });
      toast.success("Sesión eliminada");
      // If we deleted the one currently open, drop back to «nueva conversación».
      if (active) onSelect(null);
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Eliminar sesión</DialogTitle>
          <DialogDescription>
            Vas a borrar &laquo;{session.title || session.id.slice(0, 8)}
            &raquo; con todos sus items, mensajes y cálculos. No se puede
            deshacer.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Eliminando…" : "Eliminar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
