import { lookup } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

const blockedV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blockedV4.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new BlockList();
blockedV6.addSubnet("2001::", 23, "ipv6");
blockedV6.addSubnet("2001:db8::", 32, "ipv6");
blockedV6.addSubnet("2002::", 16, "ipv6");
blockedV6.addSubnet("3fff::", 20, "ipv6");

/** Reject local, special-use and transition addresses, including mapped IPv4. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !blockedV4.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !blockedV6.check(address, "ipv6");
}

async function resolvePublicHost(url: URL, signal: AbortSignal) {
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Media download requires an HTTP(S) URL without credentials.",
    );
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await abortable(lookup(hostname, { all: true, verbatim: true }), signal);
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  )
    throw new Error(
      "Media downloads must resolve exclusively to public addresses.",
    );
  // Pass only the vetted answers to the connection: a second DNS lookup could
  // otherwise rebind a public hostname to a private address after validation.
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  };
  return pinnedLookup;
}

async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("Media download timed out."));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort!);
  }
}

/** Bounded, DNS-pinned public download; every redirect gets the same validation. */
function parseMediaUrl(value: string, base?: URL): URL {
  try {
    return new URL(value, base);
  } catch {
    throw new Error("Invalid media download URL.");
  }
}

export async function downloadPublicMedia(
  source: string,
  maxBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new Error("A positive media download limit is required.");
  const signal = AbortSignal.timeout(30_000);
  let url = parseMediaUrl(source);
  for (let redirects = 0; ; redirects++) {
    const pinnedLookup = await resolvePublicHost(url, signal);
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = (url.protocol === "https:" ? https : http).get(
        url,
        {
          agent: false,
          lookup: pinnedLookup,
          signal,
          headers: {
            "User-Agent": "PlayStash-Backend",
            "Accept-Encoding": "identity",
          },
        },
        resolve,
      );
      request.once("error", () =>
        reject(new Error("Media download connection failed.")),
      );
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      const location = response.headers.location;
      response.destroy();
      if (redirects >= 5 || !location)
        throw new Error("Invalid media download redirect.");
      url = parseMediaUrl(location, url);
      continue;
    }
    if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
      response.destroy();
      throw new Error("Media download returned an unsuccessful response.");
    }
    const length = response.headers["content-length"];
    if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
      response.destroy();
      throw new Error("Media download exceeds the configured size limit.");
    }
    let size = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of response) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > maxBytes)
          throw new Error("Media download exceeds the configured size limit.");
        chunks.push(bytes);
      }
    } finally {
      response.destroy();
    }
    return Buffer.concat(chunks, size);
  }
}
