#!/usr/bin/env node
import "dotenv/config";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import {
  createMcpHandler,
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
export async function startMcpHttpServer(options: McpHttpServerOptions = {}): Promise<Server> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8765;
  const mcpPath = options.path ?? "/mcp";
  const handler = createMcpHandler(createMcpServer, {
    legacy: "stateless",
    onerror: (error) => console.error("MCP transport error:", error),
  });
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
      const response = rejection ?? (await handler.fetch(request));
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
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  console.error(`oracle-mcp listening on http://${host}:${port}${mcpPath}`);
  return server;
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
