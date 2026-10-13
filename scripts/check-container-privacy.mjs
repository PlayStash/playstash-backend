import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const image = process.argv[2];
assert.ok(
  image && !image.startsWith("-"),
  "Provide the image built by this workflow.",
);
const platform = process.argv[3];
if (platform) assert.ok(["linux/amd64", "linux/arm64"].includes(platform));
const platformArgs = platform ? ["--platform", platform] : [];
const volume = `playstash-privacy-${randomUUID()}`;
const nonrootVolume = `playstash-privacy-${randomUUID()}`;
const label = "playstash.audit=container-privacy";
const createdVolumes = [];
function docker(...args) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
const mount = ["--mount", `type=volume,source=${volume},target=/db`];
try {
  docker("volume", "create", "--label", label, volume);
  createdVolumes.push(volume);
  // Simulate data inherited from the previous world-readable container defaults.
  docker(
    "run",
    ...platformArgs,
    "--rm",
    ...mount,
    "--entrypoint",
    "node",
    image,
    "--eval",
    `
    const fs = require('node:fs');
    fs.chmodSync('/db', 0o755);
    fs.writeFileSync('/db/preexisting', 'synthetic private fixture', {mode:0o644});
    fs.chmodSync('/db/preexisting', 0o644);
  `,
  );
  docker(
    "run",
    ...platformArgs,
    "--rm",
    ...mount,
    image,
    "--eval",
    `
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    assert.equal(process.getuid(), 1000);
    assert.equal(process.umask(), 0o077);
    assert.equal(fs.statSync('/db').mode & 0o777, 0o700);
    assert.equal(fs.statSync('/db/preexisting').mode & 0o777, 0o600);
    assert.equal(fs.readFileSync('/db/preexisting', 'utf8'), 'synthetic private fixture');
    fs.writeFileSync('/db/new-private', 'new synthetic private fixture');
    assert.equal(fs.statSync('/db/new-private').mode & 0o777, 0o600);
  `,
  );
  docker(
    "run",
    ...platformArgs,
    "--rm",
    "--user",
    "2001:2001",
    ...mount,
    "--entrypoint",
    "node",
    image,
    "--eval",
    `
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    for (const path of ['/db/preexisting', '/db/new-private']) {
      assert.throws(() => fs.readFileSync(path), {code:'EACCES'});
    }
  `,
  );
  // An explicit non-root account receives a volume prepared by its operator.
  docker("volume", "create", "--label", label, nonrootVolume);
  createdVolumes.push(nonrootVolume);
  const nonrootMount = [
    "--mount",
    `type=volume,source=${nonrootVolume},target=/db`,
  ];
  docker(
    "run",
    ...platformArgs,
    "--rm",
    ...nonrootMount,
    "--entrypoint",
    "node",
    image,
    "--eval",
    `
    const fs = require('node:fs');
    fs.chownSync('/db', 2001, 2001);
    fs.chmodSync('/db', 0o700);
    fs.writeFileSync('/db/owner-marker', 'operator-provided private fixture', {mode:0o600});
    fs.chownSync('/db/owner-marker', 2001, 2001);
  `,
  );
  docker(
    "run",
    ...platformArgs,
    "--rm",
    "--user",
    "2001:2001",
    ...nonrootMount,
    image,
    "--eval",
    `
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    assert.equal(process.getuid(), 2001);
    assert.equal(process.umask(), 0o077);
    assert.ok(fs.readFileSync('/app/dist/src/main.js').length > 0);
    assert.equal(fs.statSync('/app/dist/src/main.js').uid, 1000);
    assert.equal(fs.readFileSync('/db/owner-marker', 'utf8'), 'operator-provided private fixture');
    fs.writeFileSync('/db/nonroot-private', 'new private fixture');
    assert.equal(fs.statSync('/db/nonroot-private').mode & 0o777, 0o600);
    fs.mkdirSync('/db/nonroot-folder');
    assert.equal(fs.statSync('/db/nonroot-folder').mode & 0o777, 0o700);
  `,
  );
  docker(
    "run",
    ...platformArgs,
    "--rm",
    "--user",
    "1000:1000",
    ...nonrootMount,
    "--entrypoint",
    "node",
    image,
    "--eval",
    `
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    for (const path of ['/db/owner-marker', '/db/nonroot-private']) {
      assert.throws(() => fs.readFileSync(path), {code:'EACCES'});
    }
  `,
  );
  // Root-started deployments still transfer the writable cache to custom PUIDs.
  docker(
    "run",
    ...platformArgs,
    "--rm",
    "--env",
    "PUID=2001",
    "--env",
    "PGID=2001",
    image,
    "--eval",
    `
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    assert.equal(process.getuid(), 2001);
    assert.equal(process.umask(), 0o077);
    assert.equal(fs.statSync('/app/dist').uid, 2001);
    fs.writeFileSync('/app/dist/owner-write-probe', 'writable cache fixture');
    assert.equal(fs.readFileSync('/app/dist/owner-write-probe', 'utf8'), 'writable cache fixture');
  `,
  );
  console.log(
    "Container privacy passed: inherited/new data private, explicit non-root code/storage access intact, custom PUID cache writable, foreign UIDs denied.",
  );
} finally {
  // Only remove the uniquely named volume created and labelled by this invocation.
  for (const created of createdVolumes.reverse()) {
    const owned = docker(
      "volume",
      "inspect",
      "--format",
      '{{index .Labels "playstash.audit"}}',
      created,
    );
    assert.equal(owned, "container-privacy");
    docker("volume", "rm", created);
  }
}
