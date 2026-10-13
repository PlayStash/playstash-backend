import { lookup } from "node:dns/promises";
import { EventEmitter } from "node:events";
import http, { type IncomingMessage, type RequestOptions } from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { downloadPublicMedia, isPublicAddress } from "./public-download.js";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:http", () => ({ default: { get: vi.fn() } }));
vi.mock("node:https", () => ({ default: { get: vi.fn() } }));

describe("public media downloads", () => {
  const responses: IncomingMessage[] = [];
  const options: RequestOptions[] = [];
  function response(chunks: string[], headers = {}, statusCode = 200) {
    const stream = Readable.from(
      chunks.map((chunk) => Buffer.from(chunk)),
    ) as IncomingMessage;
    stream.headers = headers;
    stream.statusCode = statusCode;
    responses.push(stream);
    return stream;
  }
  beforeEach(() => {
    vi.clearAllMocks();
    responses.length = options.length = 0;
    vi.mocked(lookup).mockResolvedValue([
      { address: "93.184.215.14", family: 4 },
    ] as never);
    const get = (
      _url: URL,
      opts: RequestOptions,
      callback: (value: IncomingMessage) => void,
    ) => {
      options.push(opts);
      queueMicrotask(() => callback(responses.shift()!));
      return new EventEmitter() as never;
    };
    vi.mocked(http.get).mockImplementation(get as never);
    vi.mocked(https.get).mockImplementation(get as never);
  });
  it.each([
    "0.0.0.0",
    "10.1.1.1",
    "100.64.1.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.31.255.255",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:8.8.8.8",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "2001::1",
    "3fff::1",
  ])("denies special-use address %s", (address) =>
    expect(isPublicAddress(address)).toBe(false),
  );
  it.each(["8.8.8.8", "93.184.215.14", "2606:4700:4700::1111"])(
    "allows public address %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
  it.each([
    "http://127.0.0.1/x",
    "http://2130706433/x",
    "http://0x7f000001/x",
    "http://[::1]/x",
    "file:///etc/passwd",
    "https://user:secret@example.com/x",
  ])("rejects unsafe URL %s before opening a connection", async (url) => {
    await expect(downloadPublicMedia(url, 100)).rejects.toThrow();
    expect(http.get).not.toHaveBeenCalled();
    expect(https.get).not.toHaveBeenCalled();
  });
  it("denies hostnames with any private DNS answer", async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: "93.184.215.14", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ] as never);
    await expect(
      downloadPublicMedia("https://images.example/x", 100),
    ).rejects.toThrow("public addresses");
    expect(https.get).not.toHaveBeenCalled();
  });
  it("pins the actual connection to vetted DNS answers", async () => {
    response(["hello"]);
    expect(await downloadPublicMedia("https://images.example/x", 5)).toEqual(
      Buffer.from("hello"),
    );
    const pinned = vi.fn();
    options[0].lookup!("images.example", {}, pinned);
    expect(pinned).toHaveBeenCalledWith(null, "93.184.215.14", 4);
    options[0].lookup!("images.example", { all: true }, pinned);
    expect(pinned).toHaveBeenLastCalledWith(null, [
      { address: "93.184.215.14", family: 4 },
    ]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(options[0].agent).toBe(false);
  });
  it("rechecks redirect destinations and never contacts local services", async () => {
    const redirect = response(
      [],
      { location: "http://169.254.169.254/latest/meta-data" },
      302,
    );
    await expect(
      downloadPublicMedia("https://images.example/x", 100),
    ).rejects.toThrow("public addresses");
    expect(https.get).toHaveBeenCalledTimes(1);
    expect(http.get).not.toHaveBeenCalled();
    expect(redirect.destroyed).toBe(true);
  });
  it("uses one total timeout across allowed redirects", async () => {
    response([], { location: "https://cdn.example/x" }, 302);
    response(["ok"]);
    expect(await downloadPublicMedia("https://images.example/x", 100)).toEqual(
      Buffer.from("ok"),
    );
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(options[0].signal).toBe(options[1].signal);
  });
  it("rejects declared oversized responses before reading", async () => {
    const body = response(["not read"], { "content-length": "10000000" });
    await expect(
      downloadPublicMedia("https://images.example/x", 5),
    ).rejects.toThrow("size limit");
    expect(body.destroyed).toBe(true);
  });
  it("aborts oversized chunked responses even without a length header", async () => {
    const body = response(["1234", "5678"]);
    await expect(
      downloadPublicMedia("https://images.example/x", 5),
    ).rejects.toThrow("size limit");
    expect(body.destroyed).toBe(true);
  });
  it("bounds slow DNS resolution and closes its timeout listener", async () => {
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(controller.signal);
    try {
      vi.mocked(lookup).mockImplementation(() => new Promise(() => {}));
      const timed = downloadPublicMedia("https://images.example/x", 5);
      const rejected = expect(timed).rejects.toThrow("timed out");
      controller.abort();
      await rejected;
    } finally {
      timeout.mockRestore();
    }
  });
});
