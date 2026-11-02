import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client as LegacyClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as LegacyHttpTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parseHttpArgs, startMcpHttpServer } from "../src/mcp/server.js";

describe("oracle-mcp streamable HTTP transport", () => {
  let server: Awaited<ReturnType<typeof startMcpHttpServer>>;
  let base: string;

  beforeAll(async () => {
    server = await startMcpHttpServer({ host: "127.0.0.1", port: 0 });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test("serves health and 404 for unknown paths", async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  test("rejects non-loopback Host and Origin headers", async () => {
    const init = (headers: Record<string, string>) => ({
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect((await fetch(`${base}/mcp`, init({ origin: "https://evil.example" }))).status).toBe(403);
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        `${base}/mcp`,
        { ...init({}), headers: { ...init({}).headers, host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end(init({}).body);
    });
    expect(status).toBe(403);
  });

  test("serves several concurrent clients from one process", async () => {
    const clients = await Promise.all(
      Array.from({ length: 4 }, async (_, i) => {
        const client = new LegacyClient({ name: `http-proof-${i}`, version: "1.0.0" });
        await client.connect(new LegacyHttpTransport(new URL(`${base}/mcp`)));
        return client;
      }),
    );
    const results = await Promise.all(
      clients.map(async (client) => {
        const tools = await client.listTools();
        const sessions = await client.callTool({ name: "sessions", arguments: { limit: 1 } });
        return { names: tools.tools.map((tool) => tool.name), isError: sessions.isError };
      }),
    );
    for (const result of results) {
      expect(result.names).toEqual(expect.arrayContaining(["consult", "sessions"]));
      expect(result.isError).toBeFalsy();
    }
    await Promise.all(clients.map((client) => client.close()));
  });

  test("routes legacy cancellation to the server instance running the call", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oracle-mcp-http-"));
    const dir = path.join(home, "sessions", "pending-session");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "meta.json"),
      JSON.stringify({
        id: "pending-session",
        createdAt: new Date().toISOString(),
        status: "running",
        model: "gpt-5.4",
        mode: "api",
        cwd: home,
        options: { prompt: "pending", file: [], model: "gpt-5.4" },
      }),
    );
    await writeFile(path.join(dir, "output.log"), "");
    await writeFile(path.join(dir, "request.json"), JSON.stringify({ prompt: "pending" }));
    const previousHome = process.env.ORACLE_HOME_DIR;
    process.env.ORACLE_HOME_DIR = home;
    const client = new LegacyClient({ name: "http-cancel-proof", version: "1.0.0" });
    const transport = new LegacyHttpTransport(new URL(`${base}/mcp`));
    await client.connect(transport);
    try {
      const session = server.legacySessions.get(transport.sessionId ?? "");
      expect(session).toBeDefined();
      const controllers = (
        session!.server.server as unknown as {
          _requestHandlerAbortControllers: Map<unknown, unknown>;
        }
      )._requestHandlerAbortControllers;
      const abort = new AbortController();
      const call = client
        .callTool({ name: "wait", arguments: { id: "pending-session" } }, undefined, {
          signal: abort.signal,
        })
        .catch((error: unknown) => error);
      await expect.poll(() => controllers.size, { timeout: 5_000 }).toBe(1);
      abort.abort();
      await call;
      await expect.poll(() => controllers.size, { timeout: 5_000 }).toBe(0);
    } finally {
      await client.close();
      if (previousHome === undefined) delete process.env.ORACLE_HOME_DIR;
      else process.env.ORACLE_HOME_DIR = previousHome;
    }
  });

  test("releases legacy sessions' inflight count after notifications and disconnects", async () => {
    const client = new LegacyClient({ name: "http-inflight-proof", version: "1.0.0" });
    const transport = new LegacyHttpTransport(new URL(`${base}/mcp`));
    await client.connect(transport);
    const id = transport.sessionId ?? "";
    const session = server.legacySessions.get(id);
    expect(session).toBeDefined();
    await client.listTools();
    // The legacy client keeps a standalone GET SSE stream open; nothing else.
    await expect.poll(() => session!.inflight, { timeout: 5_000 }).toBeLessThanOrEqual(1);
    await client.close();
    await expect.poll(() => session!.inflight, { timeout: 5_000 }).toBe(0);
    // Reopening the standalone stream for the same session must not 409.
    const controller = new AbortController();
    const reopen = () =>
      fetch(`${base}/mcp`, {
        headers: {
          accept: "text/event-stream",
          "mcp-session-id": id,
          "mcp-protocol-version": "2025-06-18",
        },
        signal: controller.signal,
      });
    let reopened = await reopen();
    for (let i = 0; i < 20 && reopened.status === 409; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      reopened = await reopen();
    }
    expect(reopened.status).toBe(200);
    controller.abort();
  });

  test("parses --http and env port", () => {
    expect(parseHttpArgs([], {})).toBeNull();
    expect(parseHttpArgs(["--http"], {})).toEqual({ host: undefined });
    expect(parseHttpArgs(["--http", "9000"], {})).toEqual({ host: undefined, port: 9000 });
    expect(parseHttpArgs([], { ORACLE_MCP_HTTP_PORT: "9001" })).toEqual({
      host: undefined,
      port: 9001,
    });
    expect(() => parseHttpArgs(["--http", "abc"], {})).toThrow(/Invalid/);
  });
});
