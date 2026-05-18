import { NextRequest, NextResponse } from "next/server";
import { streamPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/chat — Server-Sent Events with the streamed agent run.
//
// Each NDJSON line emitted by the Python subprocess is wrapped as one SSE
// `data:` message. The body of the message is the original JSON event:
// `{type: "token", delta: "Hola"}` / `{type: "tool_call", tool: "..."}` /
// `{type: "tool_result", output: "..."}` / `{type: "done", reply, last_response_id}` /
// `{type: "error", message}`.
//
// We don't try to be clever about retries — the client picks the conversation
// up on the next turn via the persisted session.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId = body?.session_id;
    const message = body?.message;
    if (!sessionId || !message) {
      return NextResponse.json(
        { error: "missing session_id or message" },
        { status: 400 },
      );
    }

    const ndjson = streamPython({
      action: "chat_stream",
      session_id: sessionId,
      message,
    });

    const sse = ndjson.pipeThrough(
      new TransformStream<string, string>({
        transform(line, controller) {
          controller.enqueue(`data: ${line}\n\n`);
        },
      }),
    );

    return new Response(sse.pipeThrough(new TextEncoderStream()), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
