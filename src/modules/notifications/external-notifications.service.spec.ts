import { Logger } from "@nestjs/common";
import configuration from "../../configuration.js";
import { ExternalNotificationsService } from "./external-notifications.service.js";

vi.mock("../../configuration.js", () => ({
  default: {
    NOTIFICATIONS: {
      WEBHOOK_URL: undefined,
      WEBHOOK_TOKEN: undefined,
      WEBHOOK_FORMAT: "json",
    },
  },
}));

describe("external notifications", () => {
  let service: ExternalNotificationsService;
  let fetchMock: ReturnType<typeof vi.fn>;
  const game = {
    id: 7,
    title: "My game",
    version: "v1.2",
    file_path: "/private/games/my-game.zip",
  } as any;
  beforeEach(() => {
    (configuration.NOTIFICATIONS as any).WEBHOOK_URL =
      "https://notifications.example/events";
    (configuration.NOTIFICATIONS as any).WEBHOOK_TOKEN = "secret";
    (configuration.NOTIFICATIONS as any).WEBHOOK_FORMAT = "json";
    fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 204,
        body: { cancel: vi.fn().mockResolvedValue(undefined) },
      });
    vi.stubGlobal("fetch", fetchMock);
    service = new ExternalNotificationsService();
  });
  afterEach(() => {
    service.onModuleDestroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("does not send anything when disabled", () => {
    (configuration.NOTIFICATIONS as any).WEBHOOK_URL = undefined;
    service.publish("game.added", game);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not disclose restricted games to external channels", () => {
    service.publish("game.added", { ...game, access_restricted: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends only public game information and authenticates the configured webhook", async () => {
    service.publish("game.added", game);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const options = fetchMock.mock.calls[0][1];
    expect(options.headers.Authorization).toBe("Bearer secret");
    expect(options.redirect).toBe("error");
    const payload = JSON.parse(options.body);
    expect(payload.event).toBe("game.added");
    expect(payload.game).toEqual({ id: 7, title: "My game", version: "v1.2" });
    expect(options.body).not.toContain("/private");
  });
  it("formats Discord notifications and disables mentions", async () => {
    (configuration.NOTIFICATIONS as any).WEBHOOK_FORMAT = "discord";
    service.publish("game.updated", { ...game, title: "@everyone" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      content: "PlayStash — Updated game: @everyone (v1.2)",
      allowed_mentions: { parse: [] },
    });
  });
  it("does not retry a permanent failure and never rejects indexing", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    const warning = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    expect(() => service.publish("game.added", game)).not.toThrow();
    await vi.waitFor(() => expect(warning).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("retries temporary errors and stops after shutdown", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    service.publish("game.added", game);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {
      timeout: 1500,
    });
    service.onModuleDestroy();
    service.publish("game.updated", game);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
