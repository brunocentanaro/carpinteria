import { spawn } from "child_process";
import path from "path";

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(process.cwd(), "..");

export async function callPython(
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "python", "-m", "carpinteria.cli_api"], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.on("close", (code: number) => {
      if (code !== 0) {
        reject(new Error(`Python exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Invalid JSON: ${stdout}`));
      }
    });

    // Use end(data, encoding) instead of write() + end() to guarantee the
    // payload is fully flushed before the pipe closes. The split form was
    // truncating multi-byte / longer inputs (e.g. file paths with tmpdir's
    // full path) somewhere around char ~150 on darwin.
    child.stdin.end(JSON.stringify(input), "utf-8");
  });
}

/**
 * Spawn the Python subprocess in streaming mode: each line written to stdout
 * is emitted as a chunk through the returned ReadableStream. Used by the
 * SSE chat endpoint so the agent's tokens / tool calls land in the browser
 * as they happen instead of buffered until the turn finishes.
 */
export function streamPython(
  input: Record<string, unknown>,
): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      const child = spawn(
        "uv",
        ["run", "python", "-m", "carpinteria.cli_api"],
        {
          cwd: PROJECT_ROOT,
          env: {
            ...process.env,
            PYTHONDONTWRITEBYTECODE: "1",
            // PYTHONUNBUFFERED so each json.dumps + flush lands here right
            // away, instead of being block-buffered by libc.
            PYTHONUNBUFFERED: "1",
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      let buf = "";
      let stderr = "";

      child.stdout.on("data", (d: Buffer) => {
        buf += d.toString();
        let idx = buf.indexOf("\n");
        while (idx !== -1) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line) controller.enqueue(line);
          idx = buf.indexOf("\n");
        }
      });

      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });

      child.on("close", (code: number) => {
        if (buf) controller.enqueue(buf);
        if (code !== 0 && stderr) {
          // Surface the subprocess error as a final event so the client knows.
          controller.enqueue(
            JSON.stringify({ type: "error", message: stderr.trim() }),
          );
        }
        controller.close();
      });

      child.stdin.end(JSON.stringify(input), "utf-8");
    },
  });
}
