"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Paperclip, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createSession, qk, sendChat, uploadPliego } from "../api";
import type { ChatMessage, Session } from "../schemas";

const MARKDOWN_BUBBLE_CLASSES =
  "bg-muted text-foreground prose prose-sm max-w-none " +
  "prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none " +
  "prose-headings:my-2";

interface ChatColumnProps {
  session: Session | null;
  /** Called once we've created a session lazily (first message or upload). */
  onSessionCreated: (id: string) => void;
}

export function ChatColumn({ session, onSessionCreated }: ChatColumnProps) {
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

  // Hydrate the message list when the active session changes (or clears).
  // During a turn we keep the optimistic local copy in sync via setMessages
  // and don't refetch.
  useEffect(() => {
    setMessages(session?.messages ?? []);
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Create-on-first-action: if there's no active session yet, the first
  // message or upload spawns one. We share the in-flight promise so a
  // concurrent send + upload both wait on the same session creation.
  const pendingSessionRef = useRef<Promise<Session> | null>(null);
  async function ensureSession(): Promise<Session> {
    if (session) return session;
    if (!pendingSessionRef.current) {
      pendingSessionRef.current = createSession({}).then((s) => {
        onSessionCreated(s.id);
        queryClient.invalidateQueries({ queryKey: qk.sessions });
        return s;
      });
    }
    try {
      return await pendingSessionRef.current;
    } finally {
      pendingSessionRef.current = null;
    }
  }

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
  });

  const handleSend = useCallback(async () => {
    if (!input.trim() || sendMutation.isPending) return;
    const userContent = input.trim();
    setMessages((m) => [...m, { role: "user", content: userContent }]);
    setInput("");
    try {
      const s = await ensureSession();
      const result = await sendMutation.mutateAsync({
        sessionId: s.id,
        message: userContent,
      });
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: result.reply || result.error || "(sin respuesta)",
        },
      ]);
      queryClient.invalidateQueries({ queryKey: qk.session(s.id) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `❌ Error: ${msg}` },
      ]);
    }
  }, [input, sendMutation, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || uploadMutation.isPending) return;
      try {
        const s = await ensureSession();
        const newSession = await uploadMutation.mutateAsync({
          sessionId: s.id,
          files,
        });
        if (newSession) {
          queryClient.setQueryData(qk.session(s.id), newSession);
          setMessages(newSession.messages ?? []);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setMessages((m) => [
          ...m,
          { role: "assistant", content: `❌ Error subiendo pliego: ${msg}` },
        ]);
      }
    },
    [uploadMutation, queryClient], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---- Drag-and-drop (depth counter avoids the child-flicker issue) ----
  function handleDragEnter(e: React.DragEvent) {
    if (uploadMutation.isPending) return;
    if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }
  function handleDragOver(e: React.DragEvent) {
    if (uploadMutation.isPending) return;
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
            {session ? (
              <>
                Sesión <code className="text-xs">{session.id}</code>. Arrastrá
                un pliego (PDF / XLSX / imagen) acá, o tipeá para empezar.
              </>
            ) : (
              <>
                Nueva conversación. Arrastrá un pliego acá o escribí algo — la
                sesión se crea cuando mandes el primer mensaje.
              </>
            )}
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
