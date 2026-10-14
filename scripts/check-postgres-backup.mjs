import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Use the built production service and real PostgreSQL, without touching a server.
const [image, platform, databaseImage] = process.argv.slice(2);
const imageReference = /^[a-z\d][a-z\d._/:@-]*$/i;
assert.ok(
  process.argv.length <= 5 && imageReference.test(image || ""),
  "Provide the built backend image.",
);
assert.ok(
  !platform || ["linux/amd64", "linux/arm64"].includes(platform),
  "Platform must be linux/amd64 or linux/arm64.",
);
assert.ok(
  imageReference.test(databaseImage || ""),
  "Provide the actual PostgreSQL 16 image as the third argument.",
);

const owner = `playstash-backup-${randomUUID().replaceAll("-", "")}`;
const label = "playstash.audit.postgres-backup";
const containers = [];
const platformArgs = platform ? ["--platform", platform] : [];
const fixture = fileURLToPath(
  new URL("./postgres-backup-fixture.mjs", import.meta.url),
);
const environment = {
  ...process.env,
  POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
};
environment.PG_REVIEW_PASSWORD = environment.POSTGRES_PASSWORD;
let network;
let failure;

function docker(stage, args, timeout = 180_000) {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: environment,
    }).trim();
  } catch (error) {
    // Child output may contain database diagnostics; never print it or credentials.
    throw new Error(
      `${stage} failed${Number.isInteger(error.status) ? ` (exit ${error.status})` : ""}.`,
    );
  }
}

function container(name, args) {
  const id = docker("Create isolated test container", [
    "create",
    "--pull",
    "never",
    ...platformArgs,
    "--name",
    `${owner}-${name}`,
    "--label",
    `${label}=${owner}`,
    "--network",
    network,
    ...args,
  ]);
  assert.match(id, /^[a-f\d]{64}$/);
  containers.push(id);
  return id;
}

function assertOwnership(kind, id) {
  const labels = JSON.parse(
    docker("Verify cleanup ownership", [
      ...(kind === "network" ? ["network"] : []),
      "inspect",
      "--format",
      kind === "network" ? "{{json .Labels}}" : "{{json .Config.Labels}}",
      id,
    ]),
  );
  assert.equal(
    labels?.[label],
    owner,
    "Refusing cleanup without this run's ownership label.",
  );
}

try {
  network = docker("Create isolated network", [
    "network",
    "create",
    "--label",
    `${label}=${owner}`,
    owner,
  ]);
  assert.match(network, /^[a-f\d]{64}$/);
  const postgres = container("postgres", [
    "--network-alias",
    "pg",
    "--env",
    "POSTGRES_PASSWORD",
    "--env",
    "POSTGRES_USER=review",
    "--env",
    "POSTGRES_DB=review_source",
    databaseImage,
  ]);
  docker("Start isolated PostgreSQL", ["start", postgres]);
  const deadline = Date.now() + 120_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      docker(
        "Wait for PostgreSQL",
        [
          "exec",
          postgres,
          "pg_isready",
          "-h",
          "127.0.0.1",
          "-U",
          "review",
          "-d",
          "review_source",
        ],
        10_000,
      );
      ready = true;
      break;
    } catch {
      await delay(1000);
    }
  }
  assert.ok(ready, "The isolated PostgreSQL server did not become ready.");
  const probe = container("service", [
    "--user",
    "1000:1000",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,mode=1777",
    "--tmpfs",
    "/db:rw,nosuid,nodev,uid=1000,gid=1000,mode=0700",
    "--env",
    "PG_REVIEW_PASSWORD",
    "--env",
    "AUTH_SEED_PERSIST=false",
    "--mount",
    `type=bind,source=${fixture},target=/postgres-backup-fixture.mjs,readonly`,
    "--entrypoint",
    "node",
    image,
    "/postgres-backup-fixture.mjs",
  ]);
  const output = docker("Run actual PostgreSQL backup/restore regression", [
    "start",
    "--attach",
    probe,
  ]);
  const state = JSON.parse(
    docker("Check probe exit", [
      "inspect",
      "--format",
      "{{json .State}}",
      probe,
    ]),
  );
  assert.equal(
    state.ExitCode,
    0,
    "The production-service backup/restore probe failed.",
  );
  const prefix = "PLAYSTASH_POSTGRES_BACKUP_RESULT ";
  const result = output
    .split(/\r?\n/)
    .findLast((line) => line.startsWith(prefix));
  assert.ok(
    result,
    "The production-service probe did not report verification results.",
  );
  console.log(
    JSON.stringify({
      platform: platform || "native",
      backendImage: image,
      databaseImage,
      ...JSON.parse(result.slice(prefix.length)),
    }),
  );
} catch (error) {
  failure = error;
} finally {
  // Remove only known IDs, and only after inspecting their unique run label.
  for (const id of containers.reverse()) {
    try {
      assertOwnership("container", id);
      docker("Remove owned test container", ["rm", "--force", "--volumes", id]);
    } catch (error) {
      failure ||= error;
    }
  }
  if (network) {
    try {
      assertOwnership("network", network);
      docker("Remove owned network", ["network", "rm", network]);
    } catch (error) {
      failure ||= error;
    }
  }
}
if (failure) {
  console.error(failure.message);
  process.exitCode = 1;
}
