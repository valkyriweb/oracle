import type { AddressInfo } from "node:net";
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
