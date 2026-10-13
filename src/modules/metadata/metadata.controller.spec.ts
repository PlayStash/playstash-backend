import type { Mock } from "vitest";
import { MINIMUM_ROLE_KEY } from "../../decorators/minimum-role.decorator.js";
import { Role } from "../users/models/role.enum.js";
import { MetadataController } from "./metadata.controller.js";

describe("MetadataController", () => {
  let controller: MetadataController;
  let metadataService: {
    providers: { getDto: Mock }[];
    getProviderBySlugOrFail: Mock;
  };

  beforeEach(() => {
    metadataService = {
      providers: [{ getDto: vi.fn().mockReturnValue({ slug: "igdb" }) }],
      getProviderBySlugOrFail: vi.fn(),
    };
    controller = new MetadataController(metadataService as any);
  });

  it("maps providers to their dto", async () => {
    const result = await controller.getProviders();
    expect(result).toEqual([{ slug: "igdb" }]);
    expect(metadataService.providers[0].getDto).toHaveBeenCalled();
  });
  it("queues a real metadata recache for administrators only", async () => {
    const recache = vi
      .fn()
      .mockResolvedValue({ queued_games: 42, processing: true });
    (metadataService as any).recacheAll = recache;
    expect(await controller.recacheAll()).toEqual({
      queued_games: 42,
      processing: true,
    });
    expect(recache).toHaveBeenCalledOnce();
    expect(
      Reflect.getMetadata(
        MINIMUM_ROLE_KEY,
        MetadataController.prototype.recacheAll,
      ),
    ).toBe(Role.ADMIN);
  });

  it("searches via the provider resolved by slug", async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1 }]);
    metadataService.getProviderBySlugOrFail.mockReturnValue({ search });
    const result = await controller.getSearchResultsByProvider(
      { provider_slug: "igdb" } as any,
      "zelda",
    );
    expect(metadataService.getProviderBySlugOrFail).toHaveBeenCalledWith(
      "igdb",
    );
    expect(search).toHaveBeenCalledWith("zelda");
    expect(result).toEqual([{ id: 1 }]);
  });
});
