import * as fsExtraModule from "fs-extra";
import { extractFull } from "node-7z";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { Mock } from "vitest";
import configurationModule from "../../configuration.js";
import { WebUIService } from "./web-ui.service.js";

vi.mock("../../configuration.js", () => ({
  __esModule: true,
  default: {
    SERVER: { VERSION: "16.3.0" },
    WEB_UI: { VERSION: undefined },
    VOLUMES: { CONFIG: "/tmp/playstash-config" },
  },
}));

vi.mock("node-7z", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const overrides = { extractFull: vi.fn() };
  return {
    ...actual,
    ...overrides,
    default: { ...(actual as any).default, ...overrides },
  };
});

vi.mock("fs-extra", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const overrides = {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    remove: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn().mockResolvedValue(""),
    createWriteStream: vi.fn(() => ({
      on: vi.fn(),
    })),
  };
  return {
    ...actual,
    ...overrides,
    default: { ...(actual as any).default, ...overrides },
  };
});

describe("WebUIService", () => {
  let service: WebUIService;

  beforeEach(() => {
    service = new WebUIService(configurationModule);
    vi.restoreAllMocks();
    (configurationModule.WEB_UI as any).GITHUB_TOKEN = undefined;
    (configurationModule.WEB_UI as any).LOCAL_BUNDLE = undefined;
  });

  describe("prepareFrontend", () => {
    it("uses an explicitly configured local bundle without contacting GitHub", async () => {
      (configurationModule.WEB_UI as any).LOCAL_BUNDLE = "/opt/frontend.zip";
      const prepare = vi
        .spyOn(service as any, "prepareLocalBundle")
        .mockResolvedValue(undefined);
      const fetchSpy = vi.spyOn(global, "fetch");
      await service.prepareFrontend();
      expect(prepare).toHaveBeenCalledWith("/opt/frontend.zip");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("caches local bundles by content and requires the web entry point", async () => {
      const fs = (fsExtraModule as any).default;
      vi.spyOn(fs, "stat").mockResolvedValue({ isFile: () => true });
      vi.spyOn(fs, "createReadStream").mockReturnValue(
        Readable.from(["test-bundle"]),
      );
      const copy = vi.spyOn(fs, "copyFile").mockResolvedValue(undefined);
      vi.spyOn(service as any, "isCached").mockResolvedValue(false);
      vi.spyOn(service as any, "cleanCacheExceptZip").mockResolvedValue(
        undefined,
      );
      vi.spyOn(service as any, "extractZip").mockResolvedValue(undefined);
      fs.pathExists.mockResolvedValue(true);
      const write = vi
        .spyOn(service as any, "writeVersionFile")
        .mockResolvedValue(undefined);
      await (service as any).prepareLocalBundle("/opt/frontend.zip");
      expect(copy).toHaveBeenCalled();
      expect(write).toHaveBeenCalledWith(
        expect.stringMatching(/^local-[a-f0-9]{64}$/),
      );
      fs.pathExists.mockResolvedValue(false);
      vi.spyOn(fs, "createReadStream").mockReturnValue(
        Readable.from(["invalid-bundle"]),
      );
      await expect(
        (service as any).prepareLocalBundle("/opt/frontend.zip"),
      ).rejects.toThrow("dist/index.html");
    });

    it("sends the read token only to the GitHub API and strips it from asset redirects", async () => {
      (configurationModule.WEB_UI as any).GITHUB_TOKEN = "test-secret";
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValueOnce({
          status: 302,
          headers: new Headers({
            location: "https://assets.example.com/bundle.zip",
          }),
          body: null,
        } as Response)
        .mockResolvedValueOnce({ ok: true, body: null } as Response);
      await expect(
        (service as any).downloadFile(
          "https://api.github.com/repos/PlayStash/playstash-frontend/releases/assets/123",
          "/tmp/test.zip",
        ),
      ).rejects.toThrow("Response body is empty");
      expect(fetchSpy.mock.calls[0][1]?.headers).toMatchObject({
        Authorization: "Bearer test-secret",
      });
      expect(fetchSpy.mock.calls[1][1]?.headers).toBeUndefined();
    });

    it("resolves private release assets through their authenticated API IDs", async () => {
      (configurationModule.WEB_UI as any).GITHUB_TOKEN = "test-secret";
      vi.spyOn(service as any, "isCached").mockResolvedValue(false);
      const download = vi
        .spyOn(service as any, "downloadFile")
        .mockResolvedValue(undefined);
      vi.spyOn(service as any, "cleanCacheExceptZip").mockResolvedValue(
        undefined,
      );
      vi.spyOn(service as any, "extractZip").mockResolvedValue(undefined);
      vi.spyOn(service as any, "writeVersionFile").mockResolvedValue(undefined);
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          assets: [{ id: 123, name: "playstash-frontend.zip" }],
        }),
      } as Response);
      await (service as any).ensureFrontendCached("v17.2.0");
      expect(download).toHaveBeenCalledWith(
        "https://api.github.com/repos/PlayStash/playstash-frontend/releases/assets/123",
        expect.any(String),
      );
    });
    it("should use forced version and skip download when cached", async () => {
      (service as any).compatibleVersion = "";
      vi.spyOn(service as any, "isCached").mockResolvedValue(true);

      const config = configurationModule as any;
      config.WEB_UI.VERSION = "v16.2.0";

      const fetchSpy = vi.spyOn(global, "fetch" as any);
      const ensureSpy = vi.spyOn(service as any, "ensureFrontendCached");

      await service.prepareFrontend();

      expect((service as any).compatibleVersion).toBe("v16.2.0");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(ensureSpy).not.toHaveBeenCalled();
    });

    it("should fetch releases and cache selected compatible version when not cached", async () => {
      const config = configurationModule as any;
      config.WEB_UI.VERSION = undefined;
      config.SERVER.VERSION = "16.3.0";

      vi.spyOn(service as any, "isCached").mockResolvedValue(false);
      const ensureSpy = vi
        .spyOn(service as any, "ensureFrontendCached")
        .mockResolvedValue(undefined);

      vi.spyOn(global, "fetch" as any).mockResolvedValue({
        ok: true,
        json: async () => [
          { tag_name: "16.3.0" },
          { tag_name: "17.0.0" },
          { tag_name: "unstable" },
        ],
      } as Response);

      await service.prepareFrontend();

      expect((service as any).compatibleVersion).toBe("16.3.0");
      expect(ensureSpy).toHaveBeenCalledWith("16.3.0");
    });

    it("should fallback to nearest newer stable when no compatible stable release is found", async () => {
      const config = configurationModule as any;
      config.WEB_UI.VERSION = undefined;
      config.SERVER.VERSION = "16.3.0";

      vi.spyOn(service as any, "isCached").mockResolvedValue(false);
      const ensureSpy = vi
        .spyOn(service as any, "ensureFrontendCached")
        .mockResolvedValue(undefined);

      vi.spyOn(global, "fetch" as any).mockResolvedValue({
        ok: true,
        json: async () => [{ tag_name: "17.0.0" }, { tag_name: "unstable" }],
      } as Response);

      await service.prepareFrontend();

      expect((service as any).compatibleVersion).toBe("17.0.0");
      expect(ensureSpy).toHaveBeenCalledWith("17.0.0");
    });

    it("should fallback to unstable when no stable releases are available", async () => {
      const config = configurationModule as any;
      config.WEB_UI.VERSION = undefined;
      config.SERVER.VERSION = "16.3.0";

      vi.spyOn(service as any, "isCached").mockResolvedValue(false);
      const ensureSpy = vi
        .spyOn(service as any, "ensureFrontendCached")
        .mockResolvedValue(undefined);

      vi.spyOn(global, "fetch" as any).mockResolvedValue({
        ok: true,
        json: async () => [{ tag_name: "unstable" }],
      } as Response);

      await service.prepareFrontend();

      expect((service as any).compatibleVersion).toBe("unstable");
      expect(ensureSpy).toHaveBeenCalledWith("unstable");
    });

    it("should fallback to unstable default list when GitHub API fails", async () => {
      const config = configurationModule as any;
      config.WEB_UI.VERSION = undefined;

      vi.spyOn(service as any, "isCached").mockResolvedValue(false);
      const ensureSpy = vi
        .spyOn(service as any, "ensureFrontendCached")
        .mockResolvedValue(undefined);

      vi.spyOn(global, "fetch" as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as Response);

      await service.prepareFrontend();

      expect((service as any).compatibleVersion).toBe("unstable");
      expect(ensureSpy).toHaveBeenCalledWith("unstable");
    });
  });

  describe("cleanCacheExceptZip", () => {
    it("should remove all files except frontend zip", async () => {
      const fs = fsExtraModule as any;
      fs.readdir.mockResolvedValue([
        "playstash-frontend.zip",
        "dist",
        ".version",
      ]);

      await service.cleanCacheExceptZip();

      expect(fs.remove).toHaveBeenCalledTimes(2);
      expect(fs.remove.mock.calls[0][0]).toContain("dist");
      expect(fs.remove.mock.calls[1][0]).toContain(".version");
    });
  });

  describe("private helpers", () => {
    it("should detect valid cache for matching version", async () => {
      const fs = fsExtraModule as any;
      fs.pathExists.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      fs.readFile.mockResolvedValue("16.3.0\n");

      const result = await (service as any).isCached("16.3.0");
      expect(result).toBe(true);
    });

    it("should return false cache when files are missing", async () => {
      const fs = fsExtraModule as any;
      fs.pathExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const result = await (service as any).isCached("16.3.0");
      expect(result).toBe(false);
    });

    it("should sort semver releases before non-semver releases", async () => {
      vi.spyOn(global, "fetch" as any).mockResolvedValue({
        ok: true,
        json: async () => [
          { tag_name: "unstable" },
          { tag_name: "16.2.0" },
          { tag_name: "16.3.0" },
        ],
      } as Response);

      const releases = await (service as any).fetchReleases();
      expect(releases.map((r: any) => r.tag_name)).toEqual([
        "16.3.0",
        "16.2.0",
        "unstable",
      ]);
    });

    it("should return null compatible release for invalid server semver", () => {
      const release = (service as any).selectCompatibleRelease("invalid", [
        { tag_name: "16.3.0" },
        { tag_name: "unstable" },
      ]);
      expect(release).toBeNull();
    });

    it("should pick latest patch when server and release minors match", () => {
      const release = (service as any).selectCompatibleRelease("16.3.2", [
        { tag_name: "16.3.9" },
        { tag_name: "16.3.1" },
        { tag_name: "16.2.9" },
        { tag_name: "unstable" },
      ]);

      expect(release).toEqual({ tag_name: "16.3.9" });
    });

    it("should throw when fallback unstable release is missing", () => {
      expect(() =>
        (service as any).getCompatibleOrFallbackRelease("16.3.0", [
          { tag_name: "15.9.0" },
        ]),
      ).toThrow("No unstable release found");
    });

    it("should skip frontend download when cached and not force redownload", async () => {
      vi.spyOn(service as any, "isCached").mockResolvedValue(true);
      const downloadSpy = vi.spyOn(service as any, "downloadFile");

      await (service as any).ensureFrontendCached("16.3.0");

      expect(downloadSpy).not.toHaveBeenCalled();
    });

    it("should execute full cache refresh flow when not cached", async () => {
      const fs = fsExtraModule as any;
      vi.spyOn(service as any, "isCached").mockResolvedValue(false);
      const downloadSpy = vi
        .spyOn(service as any, "downloadFile")
        .mockResolvedValue(undefined);
      const cleanSpy = vi
        .spyOn(service as any, "cleanCacheExceptZip")
        .mockResolvedValue(undefined);
      const extractSpy = vi
        .spyOn(service as any, "extractZip")
        .mockResolvedValue(undefined);
      const writeVersionSpy = vi
        .spyOn(service as any, "writeVersionFile")
        .mockResolvedValue(undefined);

      await (service as any).ensureFrontendCached("16.3.0");

      expect(downloadSpy).toHaveBeenCalled();
      expect(cleanSpy).toHaveBeenCalled();
      expect(extractSpy).toHaveBeenCalled();
      expect(fs.remove).toHaveBeenCalled();
      expect(writeVersionSpy).toHaveBeenCalledWith("16.3.0");
    });

    it("should resolve zip extraction when 7z emits end", async () => {
      (extractFull as Mock).mockImplementation(() => {
        const emitter = new EventEmitter();
        setImmediate(() => emitter.emit("end"));
        return emitter;
      });

      await expect(
        (service as any).extractZip("/tmp/test.zip"),
      ).resolves.toBeUndefined();
    });

    it("should reject zip extraction when 7z emits error", async () => {
      (extractFull as Mock).mockImplementation(() => {
        const emitter = new EventEmitter();
        setImmediate(() => emitter.emit("error", new Error("extract failed")));
        return emitter;
      });

      await expect(
        (service as any).extractZip("/tmp/test.zip"),
      ).rejects.toThrow("extract failed");
    });

    it("should throw when download response is not ok", async () => {
      vi.spyOn(global, "fetch" as any).mockResolvedValue({
        ok: false,
        statusText: "Not Found",
      } as Response);

      await expect(
        (service as any).downloadFile(
          "https://example.com/a.zip",
          "/tmp/a.zip",
        ),
      ).rejects.toThrow("Failed to download file: Not Found");
    });

    it("should throw when download response body is empty", async () => {
      vi.spyOn(global, "fetch" as any).mockResolvedValue({
        ok: true,
        body: null,
      } as Response);

      await expect(
        (service as any).downloadFile(
          "https://example.com/a.zip",
          "/tmp/a.zip",
        ),
      ).rejects.toThrow("Response body is empty");
    });
  });
});
