import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { verifyBundledFrontend } from "./check-bundled-frontend.mjs";

const bundled = fileURLToPath(new URL("../vendor/frontend/", import.meta.url));
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "playstash-web-fixture-"));
  try {
    await cp(bundled, directory, { recursive: true });
    const provenance = JSON.parse(
      await readFile(join(directory, "provenance.json"), "utf8"),
    );
    await run(directory, provenance);
  } finally {
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
}

test("the published frontend and all license texts validate offline", async () => {
  assert.equal((await verifyBundledFrontend()).version, "17.2.3");
});

test("a modified archive cannot pass the release checksum", () =>
  fixture(async (directory) => {
    const filename = join(directory, "playstash-frontend.zip");
    const data = await readFile(filename);
    data[data.length - 1] ^= 1;
    await writeFile(filename, data);
    await assert.rejects(
      verifyBundledFrontend(directory),
      /immutable release ZIP/,
    );
  }));

test("the declared release version cannot disagree with its source URLs", () =>
  fixture(async (directory, provenance) => {
    provenance.version = "17.2.4";
    await writeFile(
      join(directory, "provenance.json"),
      JSON.stringify(provenance),
    );
    await assert.rejects(verifyBundledFrontend(directory));
  }));

test("missing original attribution fails the build", () =>
  fixture(async (directory) => {
    await writeFile(
      join(directory, "NOTICE.txt"),
      "Replacement without original attribution",
    );
    await assert.rejects(
      verifyBundledFrontend(directory),
      /attribution notice/,
    );
  }));

test("third-party notices cannot silently disappear from the provenance", () =>
  fixture(async (directory, provenance) => {
    provenance.bundledLicenseFiles.pop();
    await writeFile(
      join(directory, "provenance.json"),
      JSON.stringify(provenance),
    );
    await assert.rejects(verifyBundledFrontend(directory));
  }));

test("a missing required license module is rejected even with a valid ZIP hash", () =>
  fixture(async (directory, provenance) => {
    provenance.bundledLicenseFiles[0].path =
      "dist/assets/LICENSE_raw-missing.js";
    await writeFile(
      join(directory, "provenance.json"),
      JSON.stringify(provenance),
    );
    await assert.rejects(verifyBundledFrontend(directory), /ENOENT/);
  }));

test("a changed frontend runtime definition cannot pass the release checksum", () =>
  fixture(async (directory) => {
    await writeFile(
      join(directory, "nginx.runtime.conf"),
      "Modified proxy configuration",
    );
    await assert.rejects(verifyBundledFrontend(directory), /immutable release/);
  }));

test("missing frontend runtime definitions are rejected", () =>
  fixture(async (directory, provenance) => {
    provenance.runtimeFiles.pop();
    await writeFile(
      join(directory, "provenance.json"),
      JSON.stringify(provenance),
    );
    await assert.rejects(
      verifyBundledFrontend(directory),
      /runtime definitions/,
    );
  }));
