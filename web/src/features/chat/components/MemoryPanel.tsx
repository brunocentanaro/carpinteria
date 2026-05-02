"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  addMemoryFact,
  deleteMemoryFact,
  listMemory,
  qk,
} from "../api";
import {
  MemoryFactDraftSchema,
  type MemoryFactDraft,
} from "../schemas";

export function MemoryPanel() {
  const queryClient = useQueryClient();
  const facts = useQuery({ queryKey: qk.memory, queryFn: listMemory });

  const form = useForm<MemoryFactDraft>({
    resolver: zodResolver(MemoryFactDraftSchema),
    defaultValues: { text: "" },
  });

  const addMutation = useMutation({
    mutationFn: addMemoryFact,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.memory });
      form.reset();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMemoryFact,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.memory }),
  });

  const items = facts.data ?? [];

  return (
    <div>
      <div className="text-xs uppercase font-semibold text-muted-foreground mb-2">
        Memoria ({items.length})
      </div>
      <ul className="space-y-1.5 mb-2">
        {items.length === 0 && (
          <li className="text-xs text-muted-foreground italic">
            Sin hechos guardados. Pedile al agente &laquo;acordate de…&raquo;.
          </li>
        )}
        {items.map((f) => (
          <li
            key={f.id}
            className="border rounded p-2 bg-card text-xs flex items-start gap-2"
          >
            <div className="flex-1">
              <div>{f.text}</div>
              {f.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {f.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={() => deleteMutation.mutate(f.id)}
              disabled={deleteMutation.isPending}
              title="Olvidar"
            >
              <X className="h-3 w-3" />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-1"
        onSubmit={form.handleSubmit((v) => addMutation.mutate({ text: v.text }))}
      >
        <Input
          {...form.register("text")}
          placeholder="Anotar un hecho…"
          className="h-8 text-xs"
          disabled={addMutation.isPending}
        />
        <Button
          type="submit"
          size="sm"
          className="h-8 px-2"
          disabled={addMutation.isPending}
        >
          +
        </Button>
      </form>
    </div>
  );
}
