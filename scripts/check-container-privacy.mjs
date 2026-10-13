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
const label = "playstash.audit=container-privacy";
function docker(...args) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
docker("volume", "create", "--label", label, volume);
const mount = ["--mount", `type=volume,source=${volume},target=/db`];
try {
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
  console.log(
    "Container privacy passed: inherited/new data private, service access intact, foreign UID denied.",
  );
} finally {
  // Only remove the uniquely named volume created and labelled by this invocation.
  const owned = docker(
    "volume",
    "inspect",
    "--format",
    '{{index .Labels "playstash.audit"}}',
    volume,
  );
  assert.equal(owned, "container-privacy");
  docker("volume", "rm", volume);
}
