import { selectPostgresClients } from "./postgres-client.js";

const mocks = vi.hoisted(() => ({
  platform: vi.fn(),
  lstat: vi.fn(),
  access: vi.fn(),
}));
vi.mock("node:os", () => ({ platform: mocks.platform }));
vi.mock("node:fs/promises", () => ({
  lstat: mocks.lstat,
  access: mocks.access,
}));

describe("PostgreSQL client selection", () => {
  beforeEach(() => {
    mocks.platform.mockReturnValue("linux");
    mocks.lstat.mockResolvedValue({
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    mocks.access.mockResolvedValue(undefined);
    vi.clearAllMocks();
  });

  it("selects the fixed, executable PostgreSQL 16 pair for a version-16 server", async () => {
    const query = vi.fn().mockResolvedValue([{ server_version_num: "160015" }]);
    expect(await selectPostgresClients({ query })).toEqual({
      dump: "/usr/libexec/postgresql16/pg_dump",
      restore: "/usr/libexec/postgresql16/pg_restore",
    });
    expect(query).toHaveBeenCalledWith("SHOW server_version_num");
    expect(mocks.access).toHaveBeenCalledTimes(2);
  });

  it.each(["170010", "180006"])(
    "keeps PATH tools for server %s",
    async (version) => {
      expect(
        await selectPostgresClients({
          query: vi.fn().mockResolvedValue([{ server_version_num: version }]),
        }),
      ).toEqual({ dump: "pg_dump", restore: "pg_restore" });
      expect(mocks.lstat).not.toHaveBeenCalled();
    },
  );

  it("keeps PATH tools on Windows even when the server is PostgreSQL 16", async () => {
    mocks.platform.mockReturnValue("win32");
    expect(
      await selectPostgresClients({
        query: vi.fn().mockResolvedValue([{ server_version_num: "160015" }]),
      }),
    ).toEqual({ dump: "pg_dump", restore: "pg_restore" });
    expect(mocks.lstat).not.toHaveBeenCalled();
  });

  it("does not select a partial, missing or non-executable client pair", async () => {
    mocks.access.mockRejectedValueOnce(new Error("ENOENT"));
    expect(
      await selectPostgresClients({
        query: vi.fn().mockResolvedValue([{ server_version_num: 160015 }]),
      }),
    ).toEqual({ dump: "pg_dump", restore: "pg_restore" });
  });

  it("does not follow a substituted symlink", async () => {
    mocks.lstat.mockResolvedValue({
      isFile: () => false,
      isSymbolicLink: () => true,
    });
    expect(
      await selectPostgresClients({
        query: vi.fn().mockResolvedValue([{ server_version_num: "160015" }]),
      }),
    ).toEqual({ dump: "pg_dump", restore: "pg_restore" });
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it.each(["160015; command", "16", null, 160015.5])(
    "rejects malformed version metadata %s",
    async (version) => {
      await expect(
        selectPostgresClients({
          query: vi.fn().mockResolvedValue([{ server_version_num: version }]),
        }),
      ).rejects.toThrow("invalid server version");
      expect(mocks.lstat).not.toHaveBeenCalled();
    },
  );
});
