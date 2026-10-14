import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFrontendZip } from "../dist/src/modules/web-ui/safe-zip.js";
import { verifyBundledFrontend } from "./check-bundled-frontend.mjs";

const source = fileURLToPath(new URL("../vendor/frontend/", import.meta.url));
assert.ok(process.argv[2], "Provide an empty frontend Docker build directory.");
const destination = resolve(process.argv[2]);
assert.notEqual(destination, resolve(source));
await mkdir(destination, { recursive: true });
assert.equal(
  (await readdir(destination)).length,
  0,
  "Build directory must be empty.",
);
const provenance = await verifyBundledFrontend(source);
const temporary = await mkdtemp(join(tmpdir(), "playstash-frontend-build-"));
try {
  const extracted = join(temporary, "extracted");
  await extractFrontendZip(join(source, provenance.asset.filename), extracted);
  await cp(join(extracted, "dist"), join(destination, "dist"), {
    recursive: true,
  });
  for (const filename of [
    "Dockerfile.runtime",
    "nginx.runtime.conf",
    "start-runtime.sh",
    "LICENSE",
    "NOTICE.txt",
    "provenance.json",
  ]) {
    await cp(join(source, filename), join(destination, filename));
  }
  console.log(
    `Separate frontend image build context verified: ${provenance.version} (${provenance.commit}).`,
  );
} finally {
  assert.equal(resolve(dirname(temporary)), resolve(tmpdir()));
  await rm(temporary, { recursive: true, force: true });
}
