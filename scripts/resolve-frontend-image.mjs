import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageName = "playstash/playstash-frontend";
const imageName = `ghcr.io/${packageName}`;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const indexTypes = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
];
const manifestTypes = [
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
];

async function readBounded(response, maximum, description) {
  assert.ok(response.ok, `${description} failed (HTTP ${response.status}).`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > maximum) {
      throw new Error(`${description} exceeded its response-size limit.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Resolve once without Docker/GitHub credentials, then share the same digest. */
export async function resolveFrontendImage(channel, request = fetch) {
  assert.ok(
    ["latest", "dev"].includes(channel),
    "Select the public frontend latest or dev channel.",
  );
  const authorization = new URL("https://ghcr.io/token");
  authorization.searchParams.set("service", "ghcr.io");
  authorization.searchParams.set("scope", `repository:${packageName}:pull`);
  const tokenResponse = await request(authorization, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const tokenData = JSON.parse(
    await readBounded(tokenResponse, 64 * 1024, "Anonymous registry access"),
  );
  const token = tokenData.token ?? tokenData.access_token;
  assert.ok(
    typeof token === "string" && token.length > 0,
    "Anonymous registry access returned no token.",
  );
  const response = await request(
    `https://ghcr.io/v2/${packageName}/manifests/${channel}`,
    {
      headers: {
        Accept: indexTypes.join(", "),
        Authorization: `Bearer ${token}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    },
  );
  const bytes = await readBounded(response, 1024 * 1024, "Frontend manifest");
  const digest = response.headers.get("docker-content-digest");
  assert.match(digest ?? "", digestPattern, "Invalid frontend index digest.");
  assert.equal(
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    digest,
    "Frontend manifest bytes do not match their immutable digest.",
  );
  const index = JSON.parse(bytes);
  assert.equal(index.schemaVersion, 2, "Unsupported frontend manifest schema.");
  assert.ok(
    indexTypes.includes(index.mediaType),
    "A multiarch index is required.",
  );
  assert.ok(
    Array.isArray(index.manifests),
    "Frontend platform list is missing.",
  );
  const platforms = {};
  for (const architecture of ["amd64", "arm64"]) {
    const matches = index.manifests.filter(
      (item) =>
        item.platform?.os === "linux" &&
        item.platform.architecture === architecture,
    );
    assert.equal(
      matches.length,
      1,
      `Exactly one frontend linux/${architecture} image is required.`,
    );
    const item = matches[0];
    assert.match(item.digest ?? "", digestPattern, "Invalid platform digest.");
    assert.ok(
      manifestTypes.includes(item.mediaType),
      "Invalid platform manifest.",
    );
    assert.ok(Number.isSafeInteger(item.size) && item.size > 0);
    assert.ok(
      !item.platform.variant ||
        (architecture === "arm64" && item.platform.variant === "v8"),
      "Unsupported frontend architecture variant.",
    );
    platforms[`linux/${architecture}`] = item.digest;
  }
  return {
    schemaVersion: 1,
    repository: "https://github.com/PlayStash/playstash-frontend",
    channel,
    image: `${imageName}@${digest}`,
    digest,
    platforms,
    verifiedAt: new Date().toISOString(),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await resolveFrontendImage(process.argv[2]);
  await writeFile(
    "frontend-image-provenance.json",
    `${JSON.stringify(result, null, 2)}\n`,
  );
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `image=${result.image}\n`);
  }
  console.log(`Public frontend ${result.channel} resolved to ${result.image}.`);
}
