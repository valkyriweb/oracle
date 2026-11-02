#!/usr/bin/env node
import "dotenv/config";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import {
  createMcpHandler,
  isLegacyRequest,
  WebStandardStreamableHTTPServerTransport,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { getCliVersion } from "../version.js";
import { registerChatGptImageTool } from "./tools/chatgptImage.js";
import { registerConsultTool } from "./tools/consult.js";
import { registerProjectSourcesTool } from "./tools/projectSources.js";
import { registerSessionsTool } from "./tools/sessions.js";
import { registerWaitTool } from "./tools/wait.js";
import { registerSessionResources } from "./tools/sessionResources.js";

export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "oracle-mcp",
      version: getCliVersion(),
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  registerConsultTool(server);
  registerChatGptImageTool(server);
  registerProjectSourcesTool(server);
  registerSessionsTool(server);
  registerWaitTool(server);
  registerSessionResources(server);
  return server;
}

export interface McpHttpServerOptions {
  host?: string;
  port?: number;
  path?: string;
}

/**
 * Serve oracle-mcp over streamable HTTP so many agent sessions can share one
 * long-running process instead of spawning a stdio copy each. Every HTTP
 * request gets a fresh McpServer from the factory (stateless), so concurrent
 * clients and tool calls never share in-memory protocol state; Oracle session
 * state lives on disk as before.
 */
export type McpHttpServer = Server & { legacySessions: Map<string, LegacySession> };

export async function startMcpHttpServer(
  options: McpHttpServerOptions = {},
): Promise<McpHttpServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8765;
  const mcpPath = options.path ?? "/mcp";
  const onerror = (error: Error) => console.error("MCP transport error:", error);
  // Modern (2026-07-28) traffic is per-request by design; cancellation aborts
  // the request itself. Legacy (2025) clients get a sessionful transport per
  // client so notifications/cancelled reaches the server instance running the
  // call, while different clients stay isolated.
  const modern = createMcpHandler(createMcpServer, { legacy: "reject", onerror });
  const legacy = createLegacySessionRouter(onerror);
  const allowedHosts = [...localhostAllowedHostnames(), ...(isLoopback(host) ? [] : [host])];
  const allowedOrigins = localhostAllowedOrigins();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
        return;
      }
      if (url.pathname !== mcpPath) {
        res.writeHead(404).end();
        return;
      }
      const controller = new AbortController();
      res.on("close", () => controller.abort());
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
        else if (value !== undefined) headers.set(key, value);
      }
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const request = new Request(url, {
        method: req.method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
        signal: controller.signal,
        // @ts-expect-error Node requires duplex for streamed request bodies.
        duplex: "half",
      });
      // DNS-rebinding / cross-site protection: only loopback Host and Origin.
      const rejection =
        hostHeaderValidationResponse(request, allowedHosts) ??
        originValidationResponse(request, allowedOrigins);
      const response =
        rejection ??
        ((await isLegacyRequest(request))
          ? await legacy.fetch(request)
          : await modern.fetch(request));
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      if (!response.body) {
        res.end();
        return;
      }
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        res.write(chunk);
      }
      res.end();
    } catch (error) {
      console.error("MCP HTTP error:", error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  // Long consults stream for many minutes; do not time out idle sockets.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  const shared = Object.assign(server, { legacySessions: legacy.sessions });
  server.on("close", () => {
    void legacy.close();
    void modern.close();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  console.error(`oracle-mcp listening on http://${host}:${port}${mcpPath}`);
  return shared;
}

const LEGACY_SESSION_IDLE_MS = 6 * 60 * 60 * 1000;

export interface LegacySession {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  lastSeen: number;
  inflight: number;
}

function jsonRpcError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }),
    { status, headers: { "content-type": "application/json" } },
  );
}

export function createLegacySessionRouter(onerror: (error: Error) => void) {
  const sessions = new Map<string, LegacySession>();
  const closeSession = async (id: string) => {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    await session.server.close().catch(onerror);
  };
  // Clients that vanish without DELETE would otherwise leak sessions.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - LEGACY_SESSION_IDLE_MS;
    for (const [id, session] of sessions) {
      if (session.inflight === 0 && session.lastSeen < cutoff) void closeSession(id);
    }
  }, 60_000);
  sweep.unref();

  const track = async (session: LegacySession, request: Request) => {
    session.inflight += 1;
    session.lastSeen = Date.now();
    try {
      const response = await session.transport.handleRequest(request);
      // Keep the session marked busy while an SSE body is still streaming.
      if (!response.body) return response;
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            session.inflight -= 1;
            session.lastSeen = Date.now();
            return;
          }
          controller.enqueue(value);
        },
        async cancel(reason) {
          session.inflight -= 1;
          await reader.cancel(reason);
        },
      });
      return new Response(body, { status: response.status, headers: response.headers });
    } catch (error) {
      session.inflight -= 1;
      throw error;
    }
  };

  return {
    sessions,
    async fetch(request: Request): Promise<Response> {
      const id = request.headers.get("mcp-session-id");
      if (id) {
        const session = sessions.get(id);
        if (!session) return jsonRpcError(404, "Session not found");
        return track(session, request);
      }
      if (request.method !== "POST") return jsonRpcError(400, "Missing mcp-session-id");
      const server = createMcpServer();
      const session: LegacySession = {
        server,
        lastSeen: Date.now(),
        inflight: 0,
        transport: new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newId) => {
            sessions.set(newId, session);
          },
          onsessionclosed: (closedId) => {
            void closeSession(closedId);
          },
        }),
      };
      await server.connect(session.transport);
      const response = await track(session, request);
      if (!session.transport.sessionId) await server.close().catch(onerror);
      return response;
    },
    async close(): Promise<void> {
      clearInterval(sweep);
      await Promise.all([...sessions.keys()].map(closeSession));
    },
  };
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function parseHttpArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): McpHttpServerOptions | null {
  const index = argv.indexOf("--http");
  const envPort = env.ORACLE_MCP_HTTP_PORT;
  if (index === -1 && !envPort) return null;
  const next = index === -1 ? undefined : argv[index + 1];
  const raw = next && !next.startsWith("-") ? next : envPort;
  const options: McpHttpServerOptions = { host: env.ORACLE_MCP_HTTP_HOST };
  if (raw) {
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`Invalid --http port: ${raw}`);
    }
    options.port = port;
  }
  return options;
}

export async function startMcpServer(argv: string[] = process.argv.slice(2)): Promise<void> {
  const http = parseHttpArgs(argv);
  if (http) {
    await startMcpHttpServer(http);
    return;
  }
  serveStdio(createMcpServer, {
    legacy: "serve",
    onerror: (error) => console.error("MCP transport error:", error),
  });
}

export function shouldStartMcpServerFromModule(
  moduleUrl: string = import.meta.url,
  argv1: string | undefined = process.argv[1],
): boolean {
  return argv1 ? moduleUrl === pathToFileURL(argv1).href : false;
}

if (shouldStartMcpServerFromModule()) {
  startMcpServer().catch((error) => {
    console.error("Failed to start oracle-mcp:", error);
    process.exitCode = 1;
  });
}
