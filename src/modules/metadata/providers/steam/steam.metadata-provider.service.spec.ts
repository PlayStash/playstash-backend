import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import {
  SteamMetadataProviderService,
  steamHtmlToMarkdown,
} from "./steam.metadata-provider.service.js";

vi.mock("../../../../configuration.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../configuration.js")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      METADATA: {
        ...actual.default.METADATA,
        STEAM: { ENABLED: true, PRIORITY: 5, REQUEST_INTERVAL_MS: 0 },
      },
    },
  };
});

describe("Steam metadata provider", () => {
  let service: SteamMetadataProviderService;
  let fetchMock: ReturnType<typeof vi.fn>;
  const media = { downloadByUrl: vi.fn().mockResolvedValue({ id: 12 }) };
  const app = {
    steam_appid: 620,
    type: "game",
    name: "Portal 2",
    required_age: "12",
    detailed_description: "<p>A puzzle <b>game</b>.</p>",
    developers: ["Valve"],
    publishers: ["Valve"],
    genres: [{ id: "1", description: "Action" }],
    categories: [{ id: 2, description: "Single-player" }],
    release_date: { coming_soon: false, date: "Apr 18, 2011" },
    pc_requirements: {
      minimum: "<strong>Minimum:</strong><ul><li>Memory: 2 GB RAM</li></ul>",
    },
    header_image:
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/header.jpg",
  };
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    service = new SteamMetadataProviderService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      media as any,
    );
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());
  const respond = (data: unknown) =>
    fetchMock.mockResolvedValue({ ok: true, json: async () => data });

  it("searches by name with encoded query parameters and discards bundles", async () => {
    respond({
      items: [
        { id: 620, name: "Portal 2", type: "app" },
        { id: 999, name: "Bundle", type: "bundle" },
      ],
    });
    expect(await service.search("Portal & test")).toEqual([
      {
        provider_slug: "steam",
        provider_data_id: "620",
        title: "Portal 2",
        cover_url: undefined,
      },
    ]);
    expect(fetchMock.mock.calls[0][0]).toContain("term=Portal+%26+test");
  });
  it("accepts an exact Steam app ID or Store URL and caches repeated details", async () => {
    respond({ 620: { success: true, data: app } });
    expect(
      (
        await service.search("https://store.steampowered.com/app/620/Portal_2/")
      )[0].provider_data_id,
    ).toBe("620");
    await service.search("620");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("maps requirements and standard metadata without requiring an account", async () => {
    respond({ 620: { success: true, data: app } });
    const result = await service.getByProviderDataIdOrFail("620");
    expect(result).toMatchObject({
      title: "Portal 2",
      age_rating: 12,
      system_requirements_minimum: "Minimum:\n- Memory: 2 GB RAM",
      cover: { id: 12 },
      genres: [
        { provider_slug: "steam", provider_data_id: "1", name: "Action" },
      ],
    });
    expect(result.release_date?.getUTCFullYear()).toBe(2011);
  });
  it("rejects unavailable apps and malformed IDs before sending requests", async () => {
    await expect(
      service.getByProviderDataIdOrFail("https://evil.example/app/620"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fetchMock).not.toHaveBeenCalled();
    respond({ 620: { success: false } });
    await expect(
      service.getByProviderDataIdOrFail("620"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it("does not download image URLs outside Steam CDNs", async () => {
    respond({
      620: {
        success: true,
        data: { ...app, header_image: "https://evil.example/image.png" },
      },
    });
    expect(
      (await service.getByProviderDataIdOrFail("620")).cover,
    ).toBeUndefined();
    expect(media.downloadByUrl).not.toHaveBeenCalled();
  });
  it("reports service errors without poisoning subsequent queued requests", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(service.search("Portal")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    respond({ items: [] });
    expect(await service.search("Portal")).toEqual([]);
  });
  it("strips active HTML including entity-encoded tags", () => {
    const result = steamHtmlToMarkdown(
      "<script>alert(1)</script><b>Text</b>&lt;img src=x onerror=1&gt; &#x3c;script&#62;",
    );
    expect(result).not.toContain("<");
    expect(result).not.toContain("alert(1)");
    expect(result).toContain("Text");
  });
});
