import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PackagesService } from "./packages.service.js";

describe("authorized package assets", () => {
  let root: string;
  let service: PackagesService;
  const user = { id: 3, username: "reader" } as any;
  const games = { findOneByGameIdOrFail: vi.fn() };
  const users = { findUserAgeByUsername: vi.fn().mockResolvedValue(18) };
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "playstash-assets-test-"));
    await mkdir(path.join(root, "Extras"));
    await mkdir(path.join(root, "Addons"));
    await writeFile(path.join(root, "game.zip"), "archive");
    await writeFile(path.join(root, "Extras", "Manual.pdf"), "manual contents");
    await writeFile(path.join(root, "Addons", "patch.zip"), "patch");
    games.findOneByGameIdOrFail
      .mockReset()
      .mockResolvedValue({ id: 8, file_path: path.join(root, "game.zip") });
    service = new PackagesService(games as any, users as any);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it("discovers extras/addons and applies game authorization before listing", async () => {
    const descriptor = await service.describe(8, user);
    expect(descriptor.extras[0]).toMatchObject({
      path: "Extras/Manual.pdf",
      title: "Manual.pdf",
      size: "15",
    });
    expect(descriptor.addons[0].kind).toBe("mod");
    expect(games.findOneByGameIdOrFail).toHaveBeenCalledWith(
      8,
      expect.objectContaining({ requestingUser: user, filterByAge: 18 }),
    );
  });
  it("propagates hidden-game authorization errors without reading its assets", async () => {
    games.findOneByGameIdOrFail.mockRejectedValue(
      new Error("Game unavailable"),
    );
    await expect(service.describe(8, user)).rejects.toThrow("Game unavailable");
  });
  it("lists and downloads case-insensitive sidecar directory names on Linux", async () => {
    await rename(path.join(root, "Extras"), path.join(root, "extras"));
    await rename(path.join(root, "Addons"), path.join(root, "ADDONS"));
    const descriptor = await service.describe(8, user);
    expect(descriptor.extras[0].path).toBe("extras/Manual.pdf");
    expect(descriptor.addons[0].path).toBe("ADDONS/patch.zip");
    const response = {
      setHeader: vi.fn(),
      status: vi.fn(),
      once: vi.fn(),
    } as any;
    const file = await service.download(
      8,
      descriptor.extras[0].id,
      user,
      response,
    );
    const chunks: Buffer[] = [];
    for await (const chunk of file.getStream()) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("manual contents");
  });
  it("downloads only listed assets and supports resumable byte ranges", async () => {
    const descriptor = await service.describe(8, user);
    const response = {
      setHeader: vi.fn(),
      status: vi.fn(),
      once: vi.fn(),
    } as any;
    await expect(
      service.download(
        8,
        Buffer.from("../secret").toString("base64url"),
        user,
        response,
      ),
    ).rejects.toThrow("not found");
    const file = await service.download(
      8,
      descriptor.extras[0].id,
      user,
      response,
      "bytes=2-5",
    );
    const chunks: Buffer[] = [];
    for await (const chunk of file.getStream()) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("nual");
    expect(response.status).toHaveBeenCalledWith(206);
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Range",
      "bytes 2-5/15",
    );
  });
  it("rejects out-of-bounds byte ranges", async () => {
    const descriptor = await service.describe(8, user);
    const response = {
      setHeader: vi.fn(),
      status: vi.fn(),
      once: vi.fn(),
    } as any;
    await expect(
      service.download(
        8,
        descriptor.extras[0].id,
        user,
        response,
        "bytes=900-1000",
      ),
    ).rejects.toMatchObject({ status: 416 });
  });
});
