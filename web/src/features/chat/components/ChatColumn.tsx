"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Paperclip, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { qk, sendChat, uploadPliego } from "../api";
import type { ChatMessage, Session } from "../schemas";

const MARKDOWN_BUBBLE_CLASSES =
  "bg-muted text-foreground prose prose-sm max-w-none " +
  "prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none " +
  "prose-headings:my-2";

interface ChatColumnProps {
  session: Session | null;
}

export function ChatColumn({ session }: ChatColumnProps) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sendingStartedAt, setSendingStartedAt] = useState<number | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState<string[] | null>(null);
  const [uploadStartedAt, setUploadStartedAt] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Hydrate the message list when the active session changes. During a turn
  // we keep the optimistic local copy in sync via setMessages and don't refetch.
  useEffect(() => {
    setMessages(session?.messages ?? []);
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: sendChat,
    onMutate: () => setSendingStartedAt(Date.now()),
    onSettled: () => setSendingStartedAt(null),
  });

  const uploadMutation = useMutation({
    mutationFn: uploadPliego,
    onMutate: (input) => {
      setUploadingFiles(input.files.map((f) => f.name));
      setUploadStartedAt(Date.now());
    },
    onSettled: () => {
      setUploadingFiles(null);
      setUploadStartedAt(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onSuccess: (newSession) => {
      if (newSession && session) {
        queryClient.setQueryData(qk.session(session.id), newSession);
        // The handler appended an assistant summary message — pick it up.
        setMessages(newSession.messages ?? []);
      }
    },
  });

  const handleSend = useCallback(async () => {
    if (!session || !input.trim() || sendMutation.isPending) return;
    const userContent = input.trim();
    setMessages((m) => [...m, { role: "user", content: userContent }]);
    setInput("");
    const result = await sendMutation.mutateAsync({
      sessionId: session.id,
      message: userContent,
    });
    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        content: result.reply || result.error || "(sin respuesta)",
      },
    ]);
    // Refresh session so the panel picks up any agent-side mutations.
    queryClient.invalidateQueries({ queryKey: qk.session(session.id) });
  }, [input, session, sendMutation, queryClient]);

  const handleFiles = useCallback(
    (files: File[]) => {
      if (!session || files.length === 0 || uploadMutation.isPending) return;
      uploadMutation.mutate({ sessionId: session.id, files });
    },
    [session, uploadMutation],
  );

  // ---- Drag-and-drop (depth counter avoids the child-flicker issue) ----
  function handleDragEnter(e: React.DragEvent) {
    if (!session || uploadMutation.isPending) return;
    if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }
  function handleDragOver(e: React.DragEvent) {
    if (!session || uploadMutation.isPending) return;
    if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
    e.preventDefault();
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    handleFiles(Array.from(e.dataTransfer.files || []));
  }

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Elegí una sesión o creá una nueva para empezar.
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-background">
        {messages.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Sesión <code className="text-xs">{session.id}</code>. Arrastrá un
            pliego (PDF / XLSX / imagen) acá, o tipeá para empezar.
          </div>
        )}
        {messages.map((m, i) => (
          <ChatBubble key={i} message={m} />
        ))}
        {uploadingFiles && (
          <ProcessingBubble files={uploadingFiles} startedAt={uploadStartedAt} />
        )}
        {sendMutation.isPending && (
          <ThinkingBubble startedAt={sendingStartedAt} />
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t p-3 bg-card">
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => handleFiles(Array.from(e.target.files || []))}
          accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg"
          multiple
          className="hidden"
        />
        <div className="flex gap-2 items-end">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            title="Subir pliego (PDF / XLSX / imagen)"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Escribí algo… (Enter para enviar, Shift+Enter nueva línea)"
            className="flex-1 resize-none"
            rows={2}
            disabled={sendMutation.isPending}
          />
          <Button
            type="button"
            onClick={handleSend}
            disabled={sendMutation.isPending || !input.trim()}
          >
            <Send className="h-4 w-4 mr-1" /> Enviar
          </Button>
        </div>
      </div>

      {isDragging && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-blue-50/80 border-4 border-dashed border-blue-400 rounded pointer-events-none">
          <div className="text-blue-800 text-lg font-semibold">
            Soltá el pliego acá
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bubbles
// ---------------------------------------------------------------------------

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
          isUser
            ? "bg-primary text-primary-foreground whitespace-pre-wrap"
            : MARKDOWN_BUBBLE_CLASSES
        }`}
      >
        {isUser ? (
          message.content
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        )}
      </div>
    </div>
  );
}

function ThinkingBubble({ startedAt }: { startedAt: number | null }) {
  const elapsed = useElapsed(startedAt);
  return (
    <div className="flex justify-start">
      <div className="bg-muted text-muted-foreground text-sm px-3 py-2 rounded-lg">
        pensando…{" "}
        {elapsed > 0 && <span className="tabular-nums">({elapsed}s)</span>}
      </div>
    </div>
  );
}

function ProcessingBubble({
  files,
  startedAt,
}: {
  files: string[];
  startedAt: number | null;
}) {
  const elapsed = useElapsed(startedAt);
  return (
    <div className="flex justify-start">
      <div className="bg-blue-50 border border-blue-200 text-blue-900 text-sm px-3 py-2 rounded-lg max-w-[80%]">
        <div className="font-semibold mb-1">📎 Procesando pliego</div>
        <ul className="text-xs text-blue-800 list-disc pl-5 mb-1">
          {files.map((f, i) => (
            <li key={i} className="break-all">
              {f}
            </li>
          ))}
        </ul>
        <div className="text-xs text-blue-700">
          analizando con IA y descomponiendo muebles…{" "}
          <span className="tabular-nums">({elapsed}s)</span>
        </div>
        <div className="text-[10px] text-blue-600 mt-1">
          Puede tardar 30-90s la primera vez.
        </div>
      </div>
    </div>
  );
}

function useElapsed(startedAt: number | null): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [startedAt]);
  return elapsed;
}
