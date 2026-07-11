"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ClipboardList, ImagePlus, Paperclip, Send, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createSession, qk, streamChat, uploadFurniturePhoto, uploadOrderPhoto, uploadPliego } from "../api";
import type { Attachment, ChatMessage, Session, ToolTraceEntry } from "../schemas";
import { useBrandEnvironment } from "@/components/BrandEnvironmentProvider";

const TOOL_LABELS: Record<string, string> = {
  get_state: "leyendo el estado",
  ingest_pliego: "ingiriendo el pliego",
  quote_moldura_price: "buscando precio de moldura",
  add_custom_item: "actualizando la cotizacion",
  set_color: "ajustando el color",
  set_payment_days: "ajustando los días de pago",
  set_destination: "ajustando el destino",
  set_additional_services: "ajustando servicios adicionales",
  set_hardware_quantity: "ajustando cantidad de herraje",
  set_hardware_price: "guardando precio de herraje",
  list_hardware_catalog: "listando catálogo de herrajes",
  set_piece_quantity: "ajustando cantidad de pieza",
  recalculate: "recalculando",
  remember_fact: "anotando hecho",
  forget_fact: "olvidando hecho",
  list_facts: "leyendo hechos",
};

const MARKDOWN_BUBBLE_CLASSES =
  "bg-muted text-foreground prose prose-sm max-w-none " +
  "prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none " +
  "prose-headings:my-2";

function clipboardImageFiles(clipboardData: DataTransfer): File[] {
  const files = Array.from(clipboardData.files || []).filter((file) =>
    file.type.startsWith("image/"),
  );
  if (files.length > 0) return files;
  return Array.from(clipboardData.items || [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item, index) => {
      const file = item.getAsFile();
      if (!file) return null;
      const extension = file.type.split("/")[1] || "png";
      return new File([file], file.name || `orden-pegada-${index + 1}.${extension}`, {
        type: file.type,
      });
    })
    .filter((file): file is File => file !== null);
}

interface ChatColumnProps {
  session: Session | null;
  /** Called once we've created a session lazily (first message or upload). */
  onSessionCreated: (id: string) => void;
  /** Owner (área administracion) sees the per-turn agent trace for debugging. */
  isOwner?: boolean;
}

export function ChatColumn({ session, onSessionCreated, isOwner = false }: ChatColumnProps) {
  const queryClient = useQueryClient();
  const { brandId } = useBrandEnvironment();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendingStartedAt, setSendingStartedAt] = useState<number | null>(null);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState<string[] | null>(null);
  const [uploadStartedAt, setUploadStartedAt] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pasteMode, setPasteMode] = useState<"furniture" | "order">("furniture");
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const orderInputRef = useRef<HTMLInputElement | null>(null);
  const furnitureInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Hydrate the message list when the active session changes (or clears).
  // During a turn we keep the optimistic local copy in sync via setMessages
  // and don't refetch.
  useEffect(() => {
    setMessages(session?.messages ?? []);
  }, [session?.id, session?.messages?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Create-on-first-action: if there's no active session yet, the first
  // message or upload spawns one. We share the in-flight promise so a
  // concurrent send + upload both wait on the same session creation.
  const pendingSessionRef = useRef<Promise<Session> | null>(null);
  async function ensureSession(): Promise<Session> {
    if (session) return session;
    if (!pendingSessionRef.current) {
      pendingSessionRef.current = createSession({ brandId }).then((s) => {
        onSessionCreated(s.id);
        queryClient.invalidateQueries({ queryKey: qk.sessions(brandId) });
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

  const orderPhotoMutation = useMutation({
    mutationFn: uploadOrderPhoto,
    onMutate: (input) => {
      setUploadingFiles(input.files.map((f) => f.name));
      setUploadStartedAt(Date.now());
    },
    onSettled: () => {
      setUploadingFiles(null);
      setUploadStartedAt(null);
      if (orderInputRef.current) orderInputRef.current.value = "";
    },
  });

  const furniturePhotoMutation = useMutation({
    mutationFn: uploadFurniturePhoto,
    onMutate: (input) => {
      setUploadingFiles(input.files.map((f) => f.name));
      setUploadStartedAt(Date.now());
    },
    onSettled: () => {
      setUploadingFiles(null);
      setUploadStartedAt(null);
      if (furnitureInputRef.current) furnitureInputRef.current.value = "";
    },
  });

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;
    const userContent = input.trim();
    setMessages((m) => [
      ...m,
      { role: "user", content: userContent },
      // Placeholder assistant bubble that we mutate as tokens arrive.
      { role: "assistant", content: "" },
    ]);
    setInput("");
    setSending(true);
    setSendingStartedAt(Date.now());
    setCurrentTool(null);

    try {
      const s = await ensureSession();
      let buffer = "";
      for await (const event of streamChat({
        sessionId: s.id,
        message: userContent,
      })) {
        if (event.type === "token") {
          buffer += event.delta;
          setMessages((m) => {
            const copy = m.slice();
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") {
              copy[copy.length - 1] = { ...last, content: buffer };
            }
            return copy;
          });
        } else if (event.type === "tool_call") {
          setCurrentTool(event.tool);
        } else if (event.type === "tool_result") {
          setCurrentTool(null);
        } else if (event.type === "error") {
          const trace = event.trace ?? [];
          setMessages((m) => {
            const copy = m.slice();
            const last = copy[copy.length - 1];
            if (last?.role === "assistant" && !last.content) {
              copy[copy.length - 1] = {
                ...last,
                content: `❌ Error: ${event.message}`,
                trace,
              };
              return copy;
            }
            return [
              ...m,
              { role: "assistant", content: `❌ Error: ${event.message}`, trace },
            ];
          });
        } else if (event.type === "done") {
          // Attach the per-turn trace to the assistant bubble so the owner can
          // expand "¿por qué?" without reloading the session from Mongo.
          const trace = event.trace ?? [];
          if (trace.length > 0) {
            setMessages((m) => {
              const copy = m.slice();
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") {
                copy[copy.length - 1] = { ...last, trace };
              }
              return copy;
            });
          }
        }
      }
      queryClient.invalidateQueries({ queryKey: qk.session(s.id) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((m) => {
        const copy = m.slice();
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && !last.content) {
          copy[copy.length - 1] = { ...last, content: `❌ Error: ${msg}` };
          return copy;
        }
        return [...m, { role: "assistant", content: `❌ Error: ${msg}` }];
      });
    } finally {
      setSending(false);
      setSendingStartedAt(null);
      setCurrentTool(null);
    }
  }, [input, sending, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOrderPhotos = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || orderPhotoMutation.isPending) return;
      try {
        const s = await ensureSession();
        const newSession = await orderPhotoMutation.mutateAsync({
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
          { role: "assistant", content: `❌ Error leyendo foto de orden: ${msg}` },
        ]);
      }
    },
    [orderPhotoMutation, queryClient], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleFurniturePhotos = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || furniturePhotoMutation.isPending) return;
      const context = input.trim();
      try {
        const s = await ensureSession();
        const newSession = await furniturePhotoMutation.mutateAsync({
          sessionId: s.id,
          files,
          message: context || undefined,
        });
        if (newSession) {
          queryClient.setQueryData(qk.session(s.id), newSession);
          setMessages(newSession.messages ?? []);
          if (context) setInput("");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setMessages((m) => [
          ...m,
          { role: "assistant", content: `âŒ Error interpretando foto del pedido: ${msg}` },
        ]);
      }
    },
    [furniturePhotoMutation, input, queryClient], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Clip / drag-drop entry point. Route by type: images (photos, hand-drawn
  // plans) go through the vision pipeline; PDF/Excel go to the pliego pipeline.
  // Previously everything went to pliego, so a photographed plan was read as
  // UTF-8 text and produced a garbage quote.
  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const isImage = (f: File) =>
        f.type.startsWith("image/") ||
        /\.(png|jpe?g|webp|gif|bmp|heic|tiff?)$/i.test(f.name);
      const images = files.filter(isImage);
      const docs = files.filter((f) => !isImage(f));

      if (images.length > 0) {
        await handleFurniturePhotos(images);
      }
      if (docs.length > 0) {
        if (uploadMutation.isPending) return;
        try {
          const s = await ensureSession();
          const newSession = await uploadMutation.mutateAsync({
            sessionId: s.id,
            files: docs,
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
      }
    },
    [uploadMutation, handleFurniturePhotos, queryClient], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = clipboardImageFiles(e.clipboardData);
      if (files.length === 0) return;
      e.preventDefault();
      if (pasteMode === "order") {
        handleOrderPhotos(files);
      } else {
        handleFurniturePhotos(files);
      }
    },
    [handleFurniturePhotos, handleOrderPhotos, pasteMode],
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
      onPaste={handlePaste}
    >
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-background">
        {messages.length === 0 && (
          <div className="text-sm text-muted-foreground">
            {session ? (
              <>
                Sesión <code className="text-xs">{session.id}</code>. Arrastrá
                un pliego acá, pegá una foto de mueble u orden, o tipeá para empezar.
              </>
            ) : (
              <>
                Nueva conversación. Arrastrá un pliego, pegá una foto de mueble u orden
                o escribí algo — la sesión se crea con la primera acción.
              </>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <ChatBubble key={i} message={m} isOwner={isOwner} sessionId={session?.id} />
        ))}
        {uploadingFiles && (
          <ProcessingBubble files={uploadingFiles} startedAt={uploadStartedAt} />
        )}
        {sending && (() => {
          const last = messages[messages.length - 1];
          // While streaming, show the thinking bubble only until the assistant
          // bubble has actual content. After that, tokens render in place.
          const hasContent = last?.role === "assistant" && last.content.length > 0;
          if (hasContent) return null;
          return (
            <ThinkingBubble
              startedAt={sendingStartedAt}
              tool={currentTool}
            />
          );
        })()}
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
        <input
          type="file"
          ref={orderInputRef}
          onChange={(e) => handleOrderPhotos(Array.from(e.target.files || []))}
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
        />
        <input
          type="file"
          ref={furnitureInputRef}
          onChange={(e) => handleFurniturePhotos(Array.from(e.target.files || []))}
          accept="image/png,image/jpeg,image/webp"
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
          <div className="flex h-10 rounded-md border bg-background p-1">
            <Button
              type="button"
              variant={pasteMode === "furniture" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => setPasteMode("furniture")}
              title="Pegar fotos como pedido/mueble para cotizar"
            >
              Mueble
            </Button>
            <Button
              type="button"
              variant={pasteMode === "order" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => setPasteMode("order")}
              title="Pegar fotos como papel de orden"
            >
              Orden
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => furnitureInputRef.current?.click()}
            disabled={furniturePhotoMutation.isPending}
            title="Cotizar foto de mueble"
          >
            <ImagePlus className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => orderInputRef.current?.click()}
            disabled={orderPhotoMutation.isPending}
            title="Leer foto de orden"
          >
            <ClipboardList className="h-4 w-4" />
          </Button>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Escribí algo… (Enter para enviar, Shift+Enter nueva línea)"
            className="flex-1 resize-none"
            rows={2}
            disabled={sending}
          />
          <Button
            type="button"
            onClick={handleSend}
            disabled={sending || !input.trim()}
          >
            <Send className="h-4 w-4 mr-1" /> Enviar
          </Button>
        </div>
      </div>

      {isDragging && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 border-4 border-dashed border-primary/50 rounded pointer-events-none">
          <div className="text-primary text-lg font-semibold">
            Soltá acá — pliego (PDF/Excel) o foto/plano
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bubbles
// ---------------------------------------------------------------------------

function ChatBubble({
  message,
  isOwner,
  sessionId,
}: {
  message: ChatMessage;
  isOwner?: boolean;
  sessionId?: string;
}) {
  const isUser = message.role === "user";
  const trace = message.trace ?? [];
  const attachments = message.attachments ?? [];
  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
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
      {attachments.length > 0 && (
        <Attachments attachments={attachments} sessionId={sessionId} />
      )}
      {isOwner && !isUser && trace.length > 0 && <TracePanel trace={trace} />}
    </div>
  );
}

// Thumbnails / links for the files the user submitted this turn. The <img> src
// hits our /api/images route, which redirects to a short-lived presigned URL.
function Attachments({
  attachments,
  sessionId,
}: {
  attachments: Attachment[];
  sessionId?: string;
}) {
  const list = attachments;
  const src = (key: string) =>
    `/api/images?key=${encodeURIComponent(key)}&sessionId=${encodeURIComponent(sessionId ?? "")}`;
  return (
    <div className="mt-1 flex flex-wrap gap-2 max-w-[80%]">
      {list.map((att, i) => {
        const isImage = (att.content_type ?? "").startsWith("image/");
        if (isImage) {
          return (
            <a key={i} href={src(att.key)} target="_blank" rel="noreferrer" title={att.filename}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src(att.key)}
                alt={att.filename || "adjunto"}
                className="h-20 w-20 rounded-md border object-cover hover:opacity-90"
              />
            </a>
          );
        }
        return (
          <a
            key={i}
            href={src(att.key)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs hover:bg-muted"
          >
            <Paperclip className="h-3 w-3" />
            {att.filename || "archivo"}
          </a>
        );
      })}
    </div>
  );
}

// Owner-only "why did the agent do this?" panel. Shows each tool the agent
// called this turn, the arguments it passed (e.g. the material/color it chose),
// and a preview of what the tool returned — so mismatches are debuggable.
function TracePanel({ trace }: { trace: ToolTraceEntry[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="max-w-[80%] mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <Wrench className="h-3 w-3" />
        {open ? "Ocultar" : "¿Por qué?"} · {trace.length} paso{trace.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="mt-1 space-y-2 rounded-md border bg-muted/40 p-2 text-[11px]">
          {trace.map((entry, i) => {
            const args = entry.args ?? {};
            const argKeys = Object.keys(args);
            return (
              <div key={i} className="border-b border-border/50 pb-2 last:border-0 last:pb-0">
                <div className="font-mono font-semibold text-foreground">
                  {i + 1}. {TOOL_LABELS[entry.tool] || entry.tool}
                </div>
                {argKeys.length > 0 && (
                  <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                    {argKeys.map((k) => (
                      <Fragment key={k}>
                        <span className="text-muted-foreground">{k}:</span>
                        <span className="font-mono break-words">{formatArg(args[k])}</span>
                      </Fragment>
                    ))}
                  </div>
                )}
                {entry.output && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted-foreground">resultado</summary>
                    <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] text-foreground/80">
                      {entry.output}
                    </pre>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatArg(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function ThinkingBubble({
  startedAt,
  tool,
}: {
  startedAt: number | null;
  tool?: string | null;
}) {
  const elapsed = useElapsed(startedAt);
  const label = tool ? TOOL_LABELS[tool] || tool : "pensando";
  return (
    <div className="flex justify-start">
      <div className="bg-muted text-muted-foreground text-sm px-3 py-2 rounded-lg">
        {label}…{" "}
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
      <div className="bg-primary/10 border border-primary/20 text-foreground text-sm px-3 py-2 rounded-lg max-w-[80%]">
        <div className="font-semibold mb-1">Procesando adjunto</div>
        <ul className="text-xs text-foreground/80 list-disc pl-5 mb-1">
          {files.map((f, i) => (
            <li key={i} className="break-all">
              {f}
            </li>
          ))}
        </ul>
        <div className="text-xs text-foreground/80">
          analizando con IA…{" "}
          <span className="tabular-nums">({elapsed}s)</span>
        </div>
        <div className="text-[10px] text-primary mt-1">
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
