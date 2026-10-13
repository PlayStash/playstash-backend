import { WinstonLogger } from "nest-winston";
import { PassThrough } from "node:stream";
import winston from "winston";
import { consoleFormat } from "winston-console-format";
import { createBackendLogFormat } from "./logging.js";
import { redactLogValue } from "./security-log.js";

vi.mock("./configuration.js", () => ({
  default: {
    SERVER: { LOG_LEVEL: "off", LOG_FILES_ENABLED: false },
    TESTING: { MOCK_FILES: true },
  },
}));

describe("production log sink credential redaction", () => {
  const user = {
    id: 7,
    username: "safe_username",
    password: "secret-password-hash",
    api_key: "secret-api-key",
  };
  const session = {
    id: 9,
    user,
    refresh_token_hash: "secret-refresh-hash",
    expires_at: new Date("2026-10-13T00:00:00Z"),
  };
  function logger(consoleOutput: boolean) {
    const output = new PassThrough();
    let text = "";
    output.on("data", (chunk: Buffer) => {
      text += chunk.toString();
    });
    const transport = new winston.transports.Stream({
      stream: output,
      ...(consoleOutput
        ? {
            format: consoleFormat({
              inspectOptions: { depth: 8, colors: false },
            }),
          }
        : {}),
    });
    const native = winston.createLogger({
      level: "debug",
      format: createBackendLogFormat(),
      transports: [transport],
    });
    return { native, nest: new WinstonLogger(native), text: () => text };
  }
  it.each([false, true])(
    "redacts normal Nest login/session records before transport (console=%s)",
    async (consoleOutput) => {
      const capture = logger(consoleOutput);
      capture.nest.log({ message: "Basic login", user }, "BasicAuthController");
      capture.nest.debug!(
        { message: "Created session", session },
        "AuthenticationService",
      );
      await new Promise((resolve) => setImmediate(resolve));
      const text = capture.text();
      for (const secret of [
        user.password,
        user.api_key,
        session.refresh_token_hash,
      ])
        expect(text).not.toContain(secret);
      expect(text).toContain("safe_username");
      expect(text).toContain("**REDACTED**");
      expect(text).toContain("AuthenticationService");
      capture.native.close();
    },
  );
  it.each([false, true])(
    "redacts both interpolated and symbol-backed splat arguments (console=%s)",
    async (consoleOutput) => {
      const capture = logger(consoleOutput);
      capture.native.info("Session %j", session);
      capture.native.info("Session %o", session);
      capture.native.info("Meta record", {
        session,
        Authorization: "Bearer secret-bearer-token",
      });
      await new Promise((resolve) => setImmediate(resolve));
      for (const secret of [
        user.password,
        user.api_key,
        session.refresh_token_hash,
        "secret-bearer-token",
      ])
        expect(capture.text()).not.toContain(secret);
      expect(capture.text()).toContain("safe_username");
      capture.native.close();
    },
  );
  it("keeps level symbols and redacts symbol metadata without mutating input", () => {
    const level = Symbol.for("level"),
      splat = Symbol.for("splat");
    const input = {
      level: "debug",
      message: "Session",
      [level]: "debug",
      [splat]: [{ session }],
    };
    const sanitized = redactLogValue(input) as typeof input;
    expect(sanitized[level]).toBe("debug");
    expect(sanitized[splat][0].session.refresh_token_hash).toBe("**REDACTED**");
    expect(input[splat][0].session.refresh_token_hash).toBe(
      "secret-refresh-hash",
    );
  });
  it("redacts nested errors, authorization text and signed connection URLs", () => {
    const error = new Error(
      "Unable to use https://login:secret-userinfo@example.com/image?token=secret-query#secret-fragment with Basic c2VjcmV0LWJhc2lj",
    );
    const safe = redactLogValue({
      error,
      nested: {
        AUTH_SEED: "secret-seed",
        refresh_token_hash: "secret-refresh",
      },
    });
    const text = JSON.stringify(safe);
    for (const secret of [
      "secret-userinfo",
      "secret-query",
      "secret-fragment",
      "c2VjcmV0LWJhc2lj",
      "secret-seed",
      "secret-refresh",
    ])
      expect(text).not.toContain(secret);
    expect(text).toContain("Unable to use");
  });
});
