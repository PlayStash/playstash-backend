import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { resolveFrontendImage } from "./resolve-frontend-image.mjs";

const indexType = "application/vnd.oci.image.index.v1+json";
const manifestType = "application/vnd.oci.image.manifest.v1+json";
function fixture(change = () => {}, options = {}) {
  const index = {
    schemaVersion: 2,
    mediaType: indexType,
    manifests: ["amd64", "arm64"].map((architecture, n) => ({
      mediaType: manifestType,
      digest: `sha256:${String(n + 1).repeat(64)}`,
      size: 1200,
      platform: { os: "linux", architecture },
    })),
  };
  change(index);
  const bytes = options.bytes ?? JSON.stringify(index);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const calls = [];
  const request = async (url, settings) => {
    calls.push({ url: String(url), settings });
    if (calls.length === 1) {
      return new Response(options.tokenBody ?? '{"token":"anonymous-token"}', {
        status: options.tokenStatus ?? 200,
      });
    }
    return new Response(bytes, {
      status: options.manifestStatus ?? 200,
      headers: { "docker-content-digest": options.digest ?? digest },
    });
  };
  return { request, calls, digest, index };
}

test("stable channel pins one anonymously resolved index and both platforms", async () => {
  const { request, digest } = fixture();
  const actual = await resolveFrontendImage("latest", request);
  assert.equal(actual.image, `ghcr.io/playstash/playstash-frontend@${digest}`);
  assert.equal(
    actual.repository,
    "https://github.com/PlayStash/playstash-frontend",
  );
  assert.deepEqual(Object.keys(actual.platforms), [
    "linux/amd64",
    "linux/arm64",
  ]);
});

test("dev resolves its own channel without falling back to stable", async () => {
  const { request, calls } = fixture();
  const actual = await resolveFrontendImage("dev", request);
  assert.equal(actual.channel, "dev");
  assert.equal(
    calls[1].url,
    "https://ghcr.io/v2/playstash/playstash-frontend/manifests/dev",
  );
});

test("registry resolution never sends repository or Docker credentials", async () => {
  const { request, calls } = fixture();
  const result = await resolveFrontendImage("latest", request);
  assert.equal(calls[0].settings.headers, undefined);
  assert.equal(
    calls[1].settings.headers.Authorization,
    "Bearer anonymous-token",
  );
  assert.ok(
    calls.every(
      ({ settings }) => settings.redirect === "error" && settings.signal,
    ),
  );
  assert.ok(!JSON.stringify(result).includes("anonymous-token"));
});

test("untrusted channels fail before making a request", async () => {
  const { request, calls } = fixture();
  await assert.rejects(resolveFrontendImage("../private", request));
  assert.equal(calls.length, 0);
});

test("private or inaccessible images fail closed", async () => {
  const { request } = fixture(() => {}, { manifestStatus: 403 });
  await assert.rejects(resolveFrontendImage("latest", request), /HTTP 403/);
});

test("token lookup failures do not continue to manifest lookup", async () => {
  const { request, calls } = fixture(() => {}, { tokenStatus: 503 });
  await assert.rejects(resolveFrontendImage("dev", request), /HTTP 503/);
  assert.equal(calls.length, 1);
});

test("an absent anonymous token cannot produce an authenticated request", async () => {
  const { request, calls } = fixture(() => {}, { tokenBody: "{}" });
  await assert.rejects(resolveFrontendImage("latest", request), /no token/);
  assert.equal(calls.length, 1);
});

test("a corrupt digest cannot identify a release", async () => {
  const { request } = fixture(() => {}, { digest: "sha256:bad" });
  await assert.rejects(resolveFrontendImage("latest", request), /index digest/);
});

test("changed manifest bytes fail their immutable digest check", async () => {
  const { request } = fixture(() => {}, { digest: `sha256:${"0".repeat(64)}` });
  await assert.rejects(resolveFrontendImage("latest", request), /do not match/);
});

test("a single-architecture image cannot replace the multiarch frontend", async () => {
  const { request } = fixture((index) => {
    index.mediaType = manifestType;
  });
  await assert.rejects(resolveFrontendImage("latest", request), /multiarch/);
});

test("a missing ARM64 image is rejected before the build matrix", async () => {
  const { request } = fixture((index) => {
    index.manifests.pop();
  });
  await assert.rejects(resolveFrontendImage("latest", request), /linux\/arm64/);
});

test("ambiguous platform manifests are rejected", async () => {
  const { request } = fixture((index) => {
    index.manifests.push(index.manifests[0]);
  });
  await assert.rejects(resolveFrontendImage("latest", request), /linux\/amd64/);
});

test("attestation descriptors do not replace actual architecture manifests", async () => {
  const { request } = fixture((index) => {
    index.manifests.push({
      mediaType: manifestType,
      platform: { os: "unknown", architecture: "unknown" },
    });
  });
  await resolveFrontendImage("latest", request);
});

test("malformed platform descriptors are rejected", async () => {
  const { request } = fixture((index) => {
    index.manifests[0].digest = "../../latest";
  });
  await assert.rejects(
    resolveFrontendImage("latest", request),
    /platform digest/,
  );
});

test("an unsupported index schema is rejected", async () => {
  const { request } = fixture((index) => {
    index.schemaVersion = 1;
  });
  await assert.rejects(
    resolveFrontendImage("latest", request),
    /manifest schema/,
  );
});

test("oversized manifests and token responses are bounded", async () => {
  const oversizedToken = fixture(() => {}, {
    tokenBody: " ".repeat(65 * 1024),
  });
  await assert.rejects(
    resolveFrontendImage("latest", oversizedToken.request),
    /response-size/,
  );
  const oversizedManifest = fixture(() => {}, {
    bytes: " ".repeat(1024 * 1024 + 1),
  });
  await assert.rejects(
    resolveFrontendImage("latest", oversizedManifest.request),
    /response-size/,
  );
});
