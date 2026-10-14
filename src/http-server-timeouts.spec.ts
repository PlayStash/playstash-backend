import { createServer, request } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { configureHttpServerTimeouts } from "./http-server-timeouts.js";

describe("HTTP server upload deadlines", () => {
  it("allows a streamed HTTP upload beyond the previous request deadline", async () => {
    const server = createServer(
      {
        requestTimeout: 40,
        headersTimeout: 40,
        connectionsCheckingInterval: 10,
      },
      (req, res) => {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => res.end(body));
      },
    );
    configureHttpServerTimeouts(server);
    expect(server.requestTimeout).toBe(3_600_000);
    expect(server.headersTimeout).toBe(60_000);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const result = new Promise<{ status: number | undefined; body: string }>(
        (resolve, reject) => {
          const upload = request(
            {
              host: "127.0.0.1",
              port: (server.address() as AddressInfo).port,
              method: "POST",
              headers: { "Content-Length": "2" },
            },
            (response) => {
              let body = "";
              response.setEncoding("utf8");
              response.on("data", (chunk) => {
                body += chunk;
              });
              response.on("end", () =>
                resolve({ status: response.statusCode, body }),
              );
              response.on("error", reject);
            },
          );
          upload.on("error", reject);
          upload.write("a");
          void delay(120).then(() => upload.end("b"));
        },
      );
      expect(await result).toEqual({ status: 200, body: "ab" });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("applies the same finite request and header deadlines to HTTPS", () => {
    const server = createHttpsServer();
    configureHttpServerTimeouts(server);
    expect(server.requestTimeout).toBe(3_600_000);
    expect(server.headersTimeout).toBe(60_000);
  });
});
