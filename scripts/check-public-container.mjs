import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const image = process.argv[2];
assert.match(
  image,
  /^ghcr\.io\/playstash\/playstash-backend:(?:latest|dev|v\d+\.\d+\.\d+|postgres16(?:-dev|-v\d+\.\d+\.\d+)?)$/,
  "Provide the published PlayStash server image tag.",
);
const directory = mkdtempSync(join(tmpdir(), "playstash-anonymous-pull-"));
const environment = { ...process.env, DOCKER_CONFIG: directory };
delete environment.DOCKER_AUTH_CONFIG;
try {
  execFileSync("docker", ["pull", image], {
    env: environment,
    stdio: "inherit",
    timeout: 300_000,
  });
  console.log(`Anonymous container pull verified for ${image}.`);
} finally {
  assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
  rmSync(directory, { recursive: true, force: true });
}
