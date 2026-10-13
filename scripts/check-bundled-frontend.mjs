import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFrontendZip } from "../dist/src/modules/web-ui/safe-zip.js";

const repository = "https://github.com/PlayStash/playstash-frontend";
const defaultDirectory = fileURLToPath(
  new URL("../vendor/frontend/", import.meta.url),
);

async function hashFile(filename) {
  const info = await lstat(filename);
  assert.ok(
    info.isFile() && !info.isSymbolicLink(),
    "Bundle files must be ordinary files.",
  );
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return { sha256: hash.digest("hex"), size: info.size };
}

/** Validate the pinned release before copying it into a published image. */
export async function verifyBundledFrontend(directory = defaultDirectory) {
  const provenance = JSON.parse(
    await readFile(join(directory, "provenance.json"), "utf8"),
  );
  assert.equal(provenance.schemaVersion, 1);
  assert.match(provenance.version, /^\d+\.\d+\.\d+$/);
  assert.equal(provenance.repository, repository);
  assert.match(provenance.commit, /^[a-f0-9]{40}$/);
  assert.equal(provenance.source, `${repository}/tree/${provenance.commit}`);
  assert.equal(
    provenance.release,
    `${repository}/releases/tag/v${provenance.version}`,
  );
  assert.equal(provenance.asset.filename, "playstash-frontend.zip");
  assert.equal(
    provenance.asset.url,
    `${repository}/releases/download/v${provenance.version}/playstash-frontend.zip`,
  );
  assert.match(provenance.asset.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    await hashFile(join(directory, provenance.asset.filename)),
    {
      sha256: provenance.asset.sha256,
      size: provenance.asset.size,
    },
    "Bundled frontend differs from the immutable release ZIP.",
  );

  assert.equal(provenance.license.identifier, "CC-BY-NC-SA-4.0");
  assert.equal(provenance.license.file, "LICENSE");
  assert.equal(
    provenance.license.source,
    `${repository}/blob/${provenance.commit}/LICENSE`,
  );
  assert.equal(
    (await hashFile(join(directory, "LICENSE"))).sha256,
    provenance.license.sha256,
    "The complete frontend license must be preserved.",
  );
  assert.equal(provenance.notice.file, "NOTICE.txt");
  assert.equal(
    (await hashFile(join(directory, "NOTICE.txt"))).sha256,
    provenance.notice.sha256,
    "The frontend attribution notice must be preserved.",
  );
  assert.ok(
    Array.isArray(provenance.bundledLicenseFiles) &&
      provenance.bundledLicenseFiles.length === 2,
  );
  assert.ok(
    provenance.bundledLicenseFiles.some(({ path }) =>
      /^dist\/assets\/LICENSE_raw-[\w-]+\.js$/.test(path),
    ),
  );
  assert.ok(
    provenance.bundledLicenseFiles.some(({ path }) =>
      /^dist\/assets\/third-party-licenses-[\w-]+\.js$/.test(path),
    ),
  );

  const temporary = await mkdtemp(join(tmpdir(), "playstash-bundled-web-"));
  try {
    const extracted = join(temporary, "frontend");
    await extractFrontendZip(
      join(directory, provenance.asset.filename),
      extracted,
    );
    const index = await readFile(join(extracted, "dist", "index.html"), "utf8");
    assert.match(
      index,
      /<html\b/i,
      "Frontend ZIP must contain a web document.",
    );
    assert.match(
      index,
      /<script\b[^>]*\btype=["']module["']/i,
      "Frontend ZIP must contain its application entry point.",
    );
    for (const item of provenance.bundledLicenseFiles) {
      assert.match(
        item.path,
        /^dist\/assets\/(?:LICENSE_raw|third-party-licenses)-[\w-]+\.js$/,
      );
      assert.match(item.sha256, /^[a-f0-9]{64}$/);
      assert.equal(
        (await hashFile(join(extracted, item.path))).sha256,
        item.sha256,
        "Bundled license texts must be preserved.",
      );
    }
  } finally {
    assert.equal(resolve(dirname(temporary)), resolve(tmpdir()));
    await rm(temporary, { recursive: true, force: true });
  }
  return provenance;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const provenance = await verifyBundledFrontend(process.argv[2]);
  console.log(
    `Bundled PlayStash frontend ${provenance.version} verified (${provenance.commit}, ${provenance.asset.sha256}).`,
  );
}
