import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { extractFrontendZip, MAX_FRONTEND_ZIP_BYTES } from "./safe-zip.js";

// Real central-directory ZIP fixtures exercise the parser and filesystem.
function zip(
  entries: {
    name: string;
    data?: string;
    mode?: number;
    size?: number;
    deflate?: boolean;
  }[],
) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.from(entry.data ?? "");
    const data = entry.deflate ? deflateRawSync(raw) : raw;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(entry.size ?? raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(0x0314, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(entry.size ?? raw.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(((entry.mode ?? 0x8000) << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, data);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

describe("frontend ZIP extraction", () => {
  let root: string;
  let source: string;
  let destination: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "playstash-safe-zip-"));
    source = join(root, "bundle.zip");
    destination = join(root, "frontend");
    await mkdir(destination);
    await writeFile(join(destination, "existing.txt"), "preserved");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("extracts a real compressed web bundle and replaces the cache after validation", async () => {
    await writeFile(
      source,
      zip([
        { name: "dist/index.html", data: "<html>ok</html>", deflate: true },
        { name: "dist/assets/app.js", data: "console.log('safe')" },
      ]),
    );
    await extractFrontendZip(source, destination);
    expect(
      await readFile(join(destination, "dist", "index.html"), "utf8"),
    ).toBe("<html>ok</html>");
    await expect(readFile(join(destination, "existing.txt"))).rejects.toThrow();
  });
  it.each([
    "../outside.txt",
    "/absolute.txt",
    "C:/escaped.txt",
    "dist/../../escaped",
    "dist\\..\\escaped",
    "dist/a:stream",
    "dist/NUL",
    "dist/.. /escaped",
  ])(
    "rejects unsafe path %s without changing the active cache",
    async (name) => {
      await writeFile(source, zip([{ name, data: "malicious" }]));
      await expect(extractFrontendZip(source, destination)).rejects.toThrow();
      expect(await readFile(join(destination, "existing.txt"), "utf8")).toBe(
        "preserved",
      );
    },
  );
  it("rejects Unix symbolic links rather than creating or following them", async () => {
    await writeFile(
      source,
      zip([{ name: "dist/link", data: "../../outside", mode: 0xa000 }]),
    );
    await expect(extractFrontendZip(source, destination)).rejects.toThrow(
      "link",
    );
    expect(await readFile(join(destination, "existing.txt"), "utf8")).toBe(
      "preserved",
    );
  });
  it("rejects case-folded duplicate paths across operating systems", async () => {
    await writeFile(
      source,
      zip([
        { name: "dist/A.js", data: "one" },
        { name: "dist/a.js", data: "two" },
      ]),
    );
    await expect(extractFrontendZip(source, destination)).rejects.toThrow(
      "duplicate paths",
    );
  });
  it("bounds expanded bytes before inflating a suspicious entry", async () => {
    await writeFile(
      source,
      zip([
        {
          name: "dist/index.html",
          data: "small",
          size: MAX_FRONTEND_ZIP_BYTES + 1,
          deflate: true,
        },
      ]),
    );
    await expect(extractFrontendZip(source, destination)).rejects.toThrow(
      "Expanded frontend ZIP",
    );
  });
  it("rejects dishonest decompressed sizes during streaming", async () => {
    await writeFile(
      source,
      zip([
        {
          name: "dist/index.html",
          data: "long payload",
          size: 1,
          deflate: true,
        },
      ]),
    );
    await expect(extractFrontendZip(source, destination)).rejects.toThrow();
    expect(await readFile(join(destination, "existing.txt"), "utf8")).toBe(
      "preserved",
    );
  });
  it("requires a real web entry point before replacing the cache", async () => {
    await writeFile(source, zip([{ name: "unrelated.txt", data: "no UI" }]));
    await expect(extractFrontendZip(source, destination)).rejects.toThrow();
    expect(await readFile(join(destination, "existing.txt"), "utf8")).toBe(
      "preserved",
    );
  });
});
