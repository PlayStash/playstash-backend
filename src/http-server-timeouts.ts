import type { Server } from "node:http";

/** Bound upload duration without inheriting Node's five-minute request limit. */
export function configureHttpServerTimeouts(
  server: Pick<Server, "requestTimeout" | "headersTimeout">,
): void {
  server.requestTimeout = 3_600_000;
  server.headersTimeout = 60_000;
}
