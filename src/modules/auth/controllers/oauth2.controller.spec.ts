import { runInNewContext } from "node:vm";
import { OAuth2Controller } from "./oauth2.controller.js";

vi.mock("../../../configuration.js", () => ({
  default: {
    AUTH: {
      OAUTH2: {
        SCOPES: [],
        CALLBACK_URL: "https://backend.example/api/auth/oauth2/login",
      },
    },
    SERVER: { CORS_ALLOWED_ORIGINS: ["https://client.example"] },
  },
}));

describe("OAuth2 client token handoff", () => {
  function setup(origin: string, token = "access-token") {
    const controller = new OAuth2Controller({
      login: vi
        .fn()
        .mockResolvedValue({
          access_token: token,
          refresh_token: "refresh-token",
        }),
    } as any);
    const request = {
      user: { username: "user" },
      ip: "127.0.0.1",
      headers: {},
      session: { oauth2ReturnOrigin: origin },
    } as any;
    const response = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      contentType: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as any;
    return { controller, request, response };
  }

  it("posts tokens only to the validated initiating client and clears session state", async () => {
    const { controller, request, response } = setup("https://client.example");
    await controller.getAuthOauth2Login(request, response);
    const script = response.send.mock.calls[0][0].match(
      /<script>([\s\S]*?)<\/script>/,
    )[1];
    const window = {
      opener: { closed: false, postMessage: vi.fn() },
      close: vi.fn(),
      location: { origin: "https://backend.example", replace: vi.fn() },
    };
    runInNewContext(script, { window });
    expect(window.opener.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "playstash:sso",
        access_token: "access-token",
      }),
      "https://client.example",
    );
    expect(window.close).toHaveBeenCalled();
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(request.session.oauth2ReturnOrigin).toBeUndefined();
    expect(response.set).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(response.set).toHaveBeenCalledWith("Referrer-Policy", "no-referrer");
  });

  it("rejects a forged untrusted session origin before returning tokens", async () => {
    const { controller, request, response } = setup("https://evil.example");
    await controller.getAuthOauth2Login(request, response);
    const script = response.send.mock.calls[0][0].match(
      /<script>([\s\S]*?)<\/script>/,
    )[1];
    const window = {
      opener: { closed: false, postMessage: vi.fn() },
      location: { origin: "https://backend.example", replace: vi.fn() },
    };
    runInNewContext(script, { window });
    expect(window.opener.postMessage).not.toHaveBeenCalled();
    expect(window.location.replace).toHaveBeenCalledWith(
      "https://backend.example/?access_token=access-token&refresh_token=refresh-token",
    );
  });

  it("escapes token data before embedding it in an HTML script", async () => {
    const { controller, request, response } = setup(
      "https://client.example",
      "</script><script>attack()</script>",
    );
    await controller.getAuthOauth2Login(request, response);
    const html = response.send.mock.calls[0][0];
    expect(html).not.toContain("</script><script>attack()");
    expect(html).toContain("\\u003c/script>");
  });
});
