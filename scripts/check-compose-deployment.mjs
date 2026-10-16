import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Exercise the distributed Compose configuration using an already-built image.
// All writable mounts, accounts, containers and networks belong to this run.
const image = process.argv[2];
assert.ok(
  image && /^[a-z\d][a-z\d._/:@-]*$/i.test(image),
  "Provide an already-built Docker image as the first argument.",
);
const platform = process.argv[3];
const databaseImage = process.argv[4];
const frontendImage = process.argv[5];
assert.ok(
  process.argv.length <= 6 &&
    (!platform || ["linux/amd64", "linux/arm64"].includes(platform)),
  "The optional platform must be linux/amd64 or linux/arm64.",
);
assert.ok(
  !databaseImage || /^[a-z\d][a-z\d._/:@-]*$/i.test(databaseImage),
  "The optional database image must be a Docker image reference.",
);
assert.ok(
  !frontendImage || /^[a-z\d][a-z\d._/:@-]*$/i.test(frontendImage),
  "The optional frontend image must be a Docker image reference.",
);
assert.ok(
  process.env.GITHUB_ACTIONS !== "true" || (databaseImage && frontendImage),
  "CI must provide the actual database and frontend images as the fourth and fifth arguments.",
);

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceCompose = join(repository, "docker-compose.yml");
const serviceName = "playstash-backend";
const initializerName = "playstash-init";
const databaseName = "db";
const frontendName = "playstash-frontend";
const serviceNames = [serviceName, initializerName, databaseName, frontendName];
const targets = [
  "/config",
  "/files",
  "/media",
  "/logs",
  "/db",
  "/plugins",
  "/savefiles",
];
const secretTarget = "/run/playstash-secrets";
const passwordFile = `${secretTarget}/postgres-password`;
const postgresTarget = "/var/lib/postgresql/data";
const useNamedVolumes = process.platform === "win32";
const mountKeys = new Map([
  ...targets.map((target) => [
    target,
    target === "/files" ? "games" : target.slice(1),
  ]),
  [secretTarget, "secrets"],
  [postgresTarget, "postgres"],
]);
const ownedVolumeNames = new Set();
const project = `playstash-compose-${randomUUID().replaceAll("-", "")}`;
const ownershipLabel = "playstash.audit.compose";
const temporaryBase = resolve(
  process.env.RUNNER_TEMP || join(repository, ".local"),
);
mkdirSync(temporaryBase, { recursive: true });
assert.ok(
  !lstatSync(temporaryBase).isSymbolicLink(),
  "Temporary base must not be a link.",
);
const realTemporaryBase = realpathSync(temporaryBase);
const temporaryRoot = join(realTemporaryBase, project);
mkdirSync(temporaryRoot, { mode: 0o700 });
const emptyEnvironment = join(temporaryRoot, "empty.env");
const testCompose = join(temporaryRoot, "compose.json");
writeFileSync(emptyEnvironment, "", { mode: 0o600 });
writeFileSync(join(temporaryRoot, ".compose-check-owner"), project, {
  mode: 0o600,
});
let mayHaveStarted = false;
let cleanupOwnershipVerified = false;
let failure;
let lifecycle = "fresh deployment";

function docker(label, ...args) {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        PUID: "1000",
        PGID: "1000",
        PLAYSTASH_PORT: "8080",
      },
    }).trim();
  } catch (error) {
    // Detached Compose lifecycle errors contain orchestration status, not the
    // captured seed/HTTP values from exec probes. Never print exec output.
    const safeLifecycle =
      args[0] === "compose" && (args.includes("up") || args.includes("down"));
    const diagnostic = safeLifecycle
      ? String(error.stderr || "")
          .replace(/\x1b\[[\d;]*m/g, "")
          .replace(/\b(?:Bearer|Basic)\s+[^\s]+/gi, "[REDACTED AUTHORIZATION]")
          .replace(/\b[a-z\d_-]+\.[a-z\d_-]+\.[a-z\d_-]+\b/gi, "[REDACTED JWT]")
          .replace(/\b[a-f\d]{64}\b/gi, "[REDACTED VALUE]")
          .replace(
            /\b(?:password|token|secret|seed)\s*[:=]\s*[^\s]+/gi,
            "[REDACTED SECRET]",
          )
          .slice(0, 8000)
          .trim()
      : "";
    throw new Error(
      `${label} failed${Number.isInteger(error.status) ? ` (exit ${error.status})` : ""}.${diagnostic ? `\n${diagnostic}` : ""}`,
    );
  }
}

function compose(label, ...args) {
  return docker(
    label,
    "compose",
    "--project-name",
    project,
    "--env-file",
    emptyEnvironment,
    "--project-directory",
    temporaryRoot,
    "-f",
    testCompose,
    ...args,
  );
}

function assertTemporaryOwnership() {
  const distance = relative(realTemporaryBase, resolve(temporaryRoot));
  assert.ok(
    distance && !distance.startsWith("..") && !isAbsolute(distance),
    "Cleanup must stay inside its temporary base.",
  );
  assert.ok(
    !lstatSync(temporaryRoot).isSymbolicLink(),
    "Owned temporary directory must not be a link.",
  );
  assert.equal(
    realpathSync(temporaryRoot),
    temporaryRoot,
    "Owned temporary directory changed.",
  );
  assert.equal(
    readFileSync(join(temporaryRoot, ".compose-check-owner"), "utf8"),
    project,
    "Temporary ownership marker changed.",
  );
}

function assertProjectOwnership() {
  assertTemporaryOwnership();
  const containers = docker(
    "List own project containers",
    "ps",
    "--all",
    "--quiet",
    "--filter",
    `label=com.docker.compose.project=${project}`,
  )
    .split(/\s+/)
    .filter(Boolean);
  for (const id of containers) {
    const labels = JSON.parse(
      docker(
        "Verify own container labels",
        "inspect",
        "--format",
        "{{json .Config.Labels}}",
        id,
      ),
    );
    assert.ok(
      labels["com.docker.compose.project"] === project &&
        serviceNames.includes(labels["com.docker.compose.service"]) &&
        labels[ownershipLabel] === project,
      "Refusing to change a container without this run's ownership labels.",
    );
  }
  const networks = docker(
    "List own project networks",
    "network",
    "ls",
    "--quiet",
    "--filter",
    `name=${project}`,
  )
    .split(/\s+/)
    .filter(Boolean);
  for (const id of networks) {
    const labels = JSON.parse(
      docker(
        "Verify own network labels",
        "network",
        "inspect",
        "--format",
        "{{json .Labels}}",
        id,
      ),
    );
    assert.equal(
      labels["com.docker.compose.project"],
      project,
      "Refusing to change another project's network.",
    );
  }
  const volumes = docker(
    "List own project volumes",
    "volume",
    "ls",
    "--quiet",
    "--filter",
    `name=${project}_`,
  )
    .split(/\s+/)
    .filter(Boolean);
  for (const name of volumes) {
    const labels = JSON.parse(
      docker(
        "Verify own volume labels",
        "volume",
        "inspect",
        "--format",
        "{{json .Labels}}",
        name,
      ),
    );
    assert.ok(
      ownedVolumeNames.has(name) &&
        labels["com.docker.compose.project"] === project &&
        labels[ownershipLabel] === project,
      "Refusing to remove a volume without this run's ownership labels.",
    );
  }
}

function ownContainer(name = serviceName, includeStopped = false) {
  const ids = compose(
    "Resolve own service container",
    "ps",
    ...(includeStopped ? ["--all"] : []),
    "--quiet",
    name,
  )
    .split(/\s+/)
    .filter(Boolean);
  assert.equal(
    ids.length,
    1,
    "Exactly one owned service container is required.",
  );
  assertProjectOwnership();
  return ids[0];
}

function baseUrl() {
  const address = compose(
    "Resolve loopback-only test port",
    "port",
    frontendName,
    "8080",
  );
  const match = /^127\.0\.0\.1:(\d+)$/.exec(address);
  assert.ok(
    match && Number(match[1]) > 0 && Number(match[1]) <= 65535,
    "The test must publish only an ephemeral IPv4 loopback port.",
  );
  return `http://${address}`;
}

async function request(
  base,
  path,
  options = {},
  maximumBytes = 8 * 1024 * 1024,
) {
  const url = new URL(path, base);
  assert.ok(
    url.origin === base && !url.username && !url.password,
    "Requests must stay on the isolated server origin.",
  );
  // Docker Desktop can retain a dead NAT/Undici socket during recreation.
  // Never replay registration or login, which create accounts or sessions.
  const retryableGet =
    (!options.method || options.method === "GET") &&
    url.pathname !== "/api/auth/basic/login";
  const connectionErrors = new Set([
    "UND_ERR_SOCKET",
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
  ]);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      let bytes = 0;
      const chunks = [];
      for await (const chunk of response.body || []) {
        bytes += chunk.length;
        assert.ok(
          bytes <= maximumBytes,
          "Response exceeded the acceptance-test size limit.",
        );
        chunks.push(Buffer.from(chunk));
      }
      return {
        status: response.status,
        headers: response.headers,
        body: Buffer.concat(chunks),
      };
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      const code = String(error.cause?.code || error.name || "NETWORK_ERROR");
      if (retryableGet && connectionErrors.has(code) && attempt < 2) {
        await delay(250);
        continue;
      }
      throw new Error(
        `${lifecycle}: HTTP ${options.method || "GET"} ${url.pathname} failed (${/^[a-z\d_]+$/i.test(code) ? code : "NETWORK_ERROR"}).`,
      );
    }
  }
}

async function waitForServer(base, container) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const state = docker(
      "Read own container readiness",
      "inspect",
      "--format",
      "{{.State.Status}}",
      container,
    );
    assert.ok(
      !["exited", "dead"].includes(state),
      "Frontend exited before its backend proxy became ready.",
    );
    try {
      const response = await request(base, "/api/status", {}, 1024 * 1024);
      if (response.status === 200) return;
    } catch {
      /* Startup may briefly refuse connections. */
    }
    await delay(1000);
  }
  throw new Error(
    "Compose frontend/API proxy did not become ready within five minutes.",
  );
}

function checkPostgresServices() {
  const initializer = ownContainer(initializerName, true);
  const initialState = JSON.parse(
    docker(
      "Verify automatic PostgreSQL initializer",
      "inspect",
      "--format",
      "{{json .State}}",
      initializer,
    ),
  );
  assert.ok(
    initialState.Status === "exited" && initialState.ExitCode === 0,
    "Automatic PostgreSQL initialization must complete successfully.",
  );
  const database = ownContainer(databaseName);
  const health = docker(
    "Verify PostgreSQL health",
    "inspect",
    "--format",
    "{{.State.Health.Status}}",
    database,
  );
  assert.equal(
    health,
    "healthy",
    "The actual PostgreSQL server must be healthy.",
  );
  const users = docker(
    "Verify registered users exist in PostgreSQL",
    "exec",
    "--user",
    "postgres",
    database,
    "psql",
    "--username",
    "playstash",
    "--dbname",
    "playstash",
    "--no-align",
    "--tuples-only",
    "--command",
    "SELECT COUNT(*) FROM playstash_user;",
  );
  assert.equal(
    users,
    "2",
    "Both accounts must be stored in the real PostgreSQL database.",
  );
}

async function checkWeb(base, expected) {
  const page = await request(base, "/", {}, 1024 * 1024);
  assert.equal(page.status, 200, "The separate frontend must return HTTP 200.");
  assert.match(
    page.headers.get("content-type") || "",
    /text\/html/i,
    "Root must serve HTML.",
  );
  const html = page.body.toString("utf8");
  assert.match(html, /PlayStash/i, "The frontend must serve the PlayStash UI.");
  const deepLink = await request(
    base,
    "/compose-check/library",
    {},
    1024 * 1024,
  );
  assert.equal(deepLink.status, 200, "SPA deep links must serve the frontend.");
  assert.equal(
    deepLink.body.toString("utf8"),
    html,
    "SPA deep links must return the same application shell.",
  );
  const assets = [];
  for (const tag of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const attributes = Object.fromEntries(
      [
        ...tag[0].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g),
      ].map((attribute) => [
        attribute[1].toLowerCase(),
        attribute[2] ?? attribute[3] ?? attribute[4],
      ]),
    );
    const isScript = tag[1].toLowerCase() === "script" && attributes.src;
    const isStyle =
      tag[1].toLowerCase() === "link" &&
      attributes.rel?.toLowerCase().split(/\s+/).includes("stylesheet") &&
      attributes.href;
    if (isScript || isStyle) {
      const path = (isScript ? attributes.src : attributes.href).replaceAll(
        "&amp;",
        "&",
      );
      const url = new URL(path, base);
      if (isScript)
        assert.equal(
          url.origin,
          base,
          "Application JavaScript must be served by this frontend.",
        );
      // Optional external font styles are not part of the bundled asset probe.
      if (url.origin === base)
        assets.push({ kind: isScript ? "js" : "css", path });
    }
  }
  assert.ok(
    assets.some((asset) => asset.kind === "js") &&
      assets.some((asset) => asset.kind === "css"),
    "The UI must reference both JavaScript and CSS assets.",
  );
  const hashes = [];
  for (const asset of assets) {
    const response = await request(base, asset.path);
    assert.equal(
      response.status,
      200,
      "Same-origin UI assets must return HTTP 200.",
    );
    assert.match(
      response.headers.get("content-type") || "",
      asset.kind === "js" ? /javascript|ecmascript/i : /text\/css/i,
      "UI assets must not fall back to the HTML page.",
    );
    assert.ok(response.body.length > 0, "UI assets must not be empty.");
    hashes.push(
      `${asset.kind}:${createHash("sha256").update(response.body).digest("hex")}`,
    );
  }
  const result = [
    createHash("sha256").update(page.body).digest("hex"),
    ...hashes,
  ];
  if (expected)
    assert.deepEqual(
      result,
      expected,
      "The frontend application and assets must survive recreation.",
    );
  return result;
}

function inspectPersistentState(container, createMarkers = false) {
  const script = `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const crypto = require('node:crypto');
    const path = require('node:path');
    assert.equal(process.getuid(), 1000);
    for (const directory of ${JSON.stringify(targets)}) {
      const info = fs.lstatSync(directory);
      assert.ok(info.isDirectory() && !info.isSymbolicLink());
      const marker = path.join(directory, ${JSON.stringify(`compose-check-${project}`)});
      ${createMarkers ? `fs.writeFileSync(marker, ${JSON.stringify(project)}, {flag:'wx',mode:0o600});` : `assert.ok(fs.readFileSync(marker,'utf8') === ${JSON.stringify(project)}, 'Persistent mount marker changed.');`}
    }
    const seedPath = '/config/auth-seed';
    const seed = fs.lstatSync(seedPath);
    assert.ok(seed.isFile() && !seed.isSymbolicLink() && seed.nlink === 1);
    assert.equal(seed.mode & 0o777, 0o600);
    assert.equal(seed.uid, process.getuid());
    const seedBytes = fs.readFileSync(seedPath);
    assert.ok(/^[a-f0-9]{64}\\n$/.test(seedBytes.toString('utf8')));
    const passwordPath = ${JSON.stringify(passwordFile)};
    const password = fs.lstatSync(passwordPath);
    assert.ok(password.isFile() && !password.isSymbolicLink() && password.nlink === 1);
    assert.equal(password.mode & 0o777, 0o600);
    assert.equal(password.uid, process.getuid());
    const passwordBytes = fs.readFileSync(passwordPath);
    assert.ok(/^[a-f0-9]{64}\\n?$/.test(passwordBytes.toString('utf8')));
    assert.ok(!fs.existsSync('/config/frontend'), 'API-only backend must not create a frontend cache.');
    process.stdout.write(JSON.stringify({seed:{hash:crypto.createHash('sha256').update(seedBytes).digest('hex'),uid:seed.uid,mode:seed.mode & 0o777,inode:seed.ino,device:seed.dev,mtime:seed.mtimeMs},databasePassword:{hash:crypto.createHash('sha256').update(passwordBytes).digest('hex'),uid:password.uid,mode:password.mode & 0o777,inode:password.ino,device:password.dev,mtime:password.mtimeMs}}));
  `;
  return JSON.parse(
    docker(
      "Verify all persistent mounts and private signing/database keys",
      "exec",
      "--user",
      "1000:1000",
      container,
      "node",
      "--eval",
      script,
    ),
  );
}

function comparePersistentState(before, after) {
  for (const field of ["hash", "uid", "mode", "inode", "device", "mtime"])
    assert.ok(
      before.seed[field] === after.seed[field],
      "Persistent authentication seed was replaced or changed.",
    );
  for (const field of ["hash", "uid", "mode", "inode", "device", "mtime"])
    assert.ok(
      before.databasePassword[field] === after.databasePassword[field],
      "Automatically generated PostgreSQL password was replaced or changed.",
    );
}

function responseJson(response) {
  try {
    return JSON.parse(response.body);
  } catch {
    throw new Error(
      "The server returned invalid JSON; response contents withheld.",
    );
  }
}

async function checkIdentity(base, token, first, second) {
  const options = { headers: { Authorization: `Bearer ${token}` } };
  const own = await request(base, "/api/users/me", options, 1024 * 1024);
  assert.equal(own.status, 200, "The original bearer token must remain valid.");
  const user = responseJson(own);
  assert.ok(
    user.id === first.id &&
      user.username === first.username &&
      user.role === 3 &&
      user.activated === true,
    "The initial administrator must persist.",
  );
  const list = await request(base, "/api/users", options, 1024 * 1024);
  assert.equal(list.status, 200);
  const users = responseJson(list);
  assert.ok(
    Array.isArray(users) && users.length === 2,
    "Both registered users must persist without duplicate initialization.",
  );
  assert.ok(
    users.some(
      (entry) =>
        entry.id === second.id &&
        entry.username === second.username &&
        entry.role === 1 &&
        entry.activated === false,
    ),
    "The second account must remain an inactive ordinary user.",
  );
  return user;
}

function checkSeparatedContainers(backend, frontend) {
  const backendBindings = JSON.parse(
    docker(
      "Verify backend has no published host ports",
      "inspect",
      "--format",
      "{{json .HostConfig.PortBindings}}",
      backend,
    ),
  );
  assert.ok(
    !Object.values(backendBindings || {}).some((bindings) => bindings?.length),
    "The API backend must not publish a host port.",
  );
  const frontendHost = JSON.parse(
    docker(
      "Inspect separate frontend isolation",
      "inspect",
      "--format",
      "{{json .HostConfig}}",
      frontend,
    ),
  );
  assert.equal(
    frontendHost.ReadonlyRootfs,
    true,
    "The frontend root filesystem must be read-only.",
  );
  assert.ok(
    Object.hasOwn(frontendHost.Tmpfs || {}, "/tmp"),
    "Nginx writable state must use ephemeral tmpfs.",
  );
  const frontendMounts = JSON.parse(
    docker(
      "Verify frontend cannot access backend storage",
      "inspect",
      "--format",
      "{{json .Mounts}}",
      frontend,
    ),
  );
  assert.ok(
    frontendMounts.every(
      (mount) => mount.Type === "tmpfs" && mount.Destination === "/tmp",
    ),
    "The frontend must not mount backend files, PostgreSQL data or secrets.",
  );
  assert.notEqual(
    docker("Verify frontend runs without root", "exec", frontend, "id", "-u"),
    "0",
    "Nginx must run as an unprivileged user.",
  );
  docker(
    "Verify frontend contains only its web runtime",
    "exec",
    frontend,
    "sh",
    "-c",
    "! command -v node >/dev/null 2>&1 && test ! -e /app/dist && test ! -e /app/node_modules && test ! -e /run/playstash-secrets && test ! -e /opt/playstash/init-postgres.mjs && test -f /usr/share/nginx/html/index.html",
  );
  const direct = JSON.parse(
    docker(
      "Verify backend is API-only",
      "exec",
      "--user",
      "1000:1000",
      backend,
      "node",
      "--input-type=module",
      "--eval",
      `
      import assert from 'node:assert/strict';
      import { existsSync } from 'node:fs';
      for (const path of ['/', '/assets/compose-check.js']) {
        const response = await fetch('http://127.0.0.1:8080' + path, { redirect:'error', signal:AbortSignal.timeout(10000) });
        assert.equal(response.status, 404, 'Backend must not serve a frontend page or assets.');
        await response.body?.cancel();
      }
      const status = await fetch('http://127.0.0.1:8080/api/status', { redirect:'error', signal:AbortSignal.timeout(10000) });
      assert.equal(status.status, 200);
      await status.body?.cancel();
      assert.ok(!existsSync('/opt/playstash/frontend') && !existsSync('/config/frontend'), 'Backend must not contain or cache a frontend bundle.');
      process.stdout.write(JSON.stringify({api:true,frontend:false}));
    `,
    ),
  );
  assert.deepEqual(direct, { api: true, frontend: false });
}

async function checkSocketIo(base, user) {
  assert.ok(
    typeof user.api_key === "string" && /^[a-f\d]{64}$/.test(user.api_key),
    "The authenticated user must supply its own API key for the WebSocket probe.",
  );
  const endpoint = new URL("/socket.io/?EIO=4&transport=websocket", base);
  endpoint.protocol = "ws:";
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    let settled = false;
    const complete = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        /* An interrupted handshake may already be closed. */
      }
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(
      () =>
        complete(
          new Error(
            `${lifecycle}: authenticated Socket.IO proxy roundtrip timed out.`,
          ),
        ),
      20000,
    );
    socket.addEventListener("error", () =>
      complete(
        new Error(
          `${lifecycle}: WebSocket upgrade through the frontend failed.`,
        ),
      ),
    );
    socket.addEventListener("close", () => {
      if (!settled)
        complete(
          new Error(
            `${lifecycle}: WebSocket closed before the authenticated response.`,
          ),
        );
    });
    socket.addEventListener("message", ({ data }) => {
      try {
        const packet = String(data);
        assert.ok(
          Buffer.byteLength(packet) <= 1024 * 1024,
          "Socket.IO probe response is oversized.",
        );
        if (packet.startsWith("0"))
          socket.send(`40${JSON.stringify({ api_key: user.api_key })}`);
        else if (packet.startsWith("2")) socket.send(`3${packet.slice(1)}`);
        else if (packet.startsWith("40"))
          socket.send(`42${JSON.stringify(["get-activities"])}`);
        else if (packet.startsWith("44"))
          complete(new Error(`${lifecycle}: Socket.IO authentication failed.`));
        else if (packet.startsWith("42")) {
          const message = JSON.parse(packet.slice(2));
          if (message[0] === "activities") {
            assert.ok(
              Array.isArray(message[1]),
              "The real activities response must be an array.",
            );
            complete();
          } else if (message[0] === "exception")
            complete(
              new Error(
                `${lifecycle}: Socket.IO rejected the authenticated activity request.`,
              ),
            );
        }
      } catch {
        complete(
          new Error(
            `${lifecycle}: Socket.IO proxy returned an invalid response.`,
          ),
        );
      }
    });
  });
}

try {
  const rawCompose = readFileSync(sourceCompose, "utf8");
  assert.ok(
    [...rawCompose.matchAll(/\$\{[^}]+\}/g)].every(([setting]) =>
      /^\$\{[A-Z][A-Z\d_]*:-[^}]*\}$/.test(setting),
    ),
    "Default Compose must not require environment values without working defaults.",
  );
  const configuration = JSON.parse(
    docker(
      "Read distributed Compose configuration",
      "compose",
      "--project-name",
      project,
      "--env-file",
      emptyEnvironment,
      "-f",
      sourceCompose,
      "config",
      "--format",
      "json",
    ),
  );
  assert.deepEqual(
    Object.keys(configuration.services || {}).sort(),
    [...serviceNames].sort(),
    "Default deployment must contain separate initializer, PostgreSQL, backend and frontend services.",
  );
  const service = configuration.services[serviceName];
  const initializer = configuration.services[initializerName];
  const database = configuration.services[databaseName];
  const frontend = configuration.services[frontendName];
  for (const entry of Object.values(configuration.services))
    assert.ok(
      !("build" in entry) && !entry.env_file,
      "Default deployment must not build source code or require environment files.",
    );
  for (const entry of [service, initializer]) {
    assert.equal(
      entry.image,
      "ghcr.io/playstash/playstash-backend:latest",
      "Default startup must use the published backend image.",
    );
    assert.equal(
      entry.pull_policy,
      "always",
      "Default startup must refresh the published main image.",
    );
    assert.equal(String(entry.environment.PUID), "1000");
    assert.equal(String(entry.environment.PGID), "1000");
  }
  assert.ok(
    !service.command && !service.entrypoint,
    "Backend startup must use the packaged entrypoint.",
  );
  assert.deepEqual(
    initializer.entrypoint,
    ["node", "/opt/playstash/init-postgres.mjs"],
    "Database credentials must be initialized automatically by the packaged tool.",
  );
  assert.equal(initializer.restart, "no");
  assert.equal(service.environment.DB_SYSTEM, "POSTGRESQL");
  assert.equal(service.environment.DB_HOST, databaseName);
  assert.equal(service.environment.DB_USERNAME, "playstash");
  assert.equal(service.environment.DB_DATABASE, "playstash");
  assert.equal(service.environment.DB_PASSWORD_FILE, passwordFile);
  assert.equal(String(service.environment.AUTH_SEED_PERSIST), "true");
  assert.ok(
    service.environment.WEB_UI_ENABLED === undefined ||
      String(service.environment.WEB_UI_ENABLED) === "false",
    "The backend must not enable its own web interface.",
  );
  assert.equal(
    database.image,
    "ghcr.io/playstash/playstash-backend:postgres16",
    "Default deployment must use the published patched PostgreSQL 16 image.",
  );
  assert.equal(database.pull_policy, "always");
  assert.equal(database.environment.POSTGRES_USER, "playstash");
  assert.equal(database.environment.POSTGRES_DB, "playstash");
  assert.equal(database.environment.POSTGRES_PASSWORD_FILE, passwordFile);
  assert.ok(
    !database.ports?.length &&
      !initializer.ports?.length &&
      !service.ports?.length,
    "Database, initializer and backend must not publish host ports.",
  );
  assert.ok(
    service.expose?.some((port) => String(port) === "8080"),
    "The backend API must be exposed only to the Compose network.",
  );
  assert.ok(
    frontend.ports?.length === 1 && frontend.ports[0].target === 8080,
    "Only the frontend HTTP port may be published.",
  );
  assert.equal(
    frontend.image,
    "ghcr.io/playstash/playstash-frontend:latest",
    "Default startup must use the separate published frontend image.",
  );
  assert.equal(
    frontend.read_only,
    true,
    "The frontend must have a read-only root filesystem.",
  );
  assert.ok(
    frontend.tmpfs?.some((mount) => String(mount).split(":")[0] === "/tmp"),
    "The frontend must use tmpfs for temporary Nginx state.",
  );
  assert.ok(
    !frontend.volumes?.length,
    "The frontend must not have access to backend storage or database secrets.",
  );
  assert.equal(
    database.depends_on?.[initializerName]?.condition,
    "service_completed_successfully",
  );
  assert.equal(
    service.depends_on?.[initializerName]?.condition,
    "service_completed_successfully",
  );
  assert.equal(
    service.depends_on?.[databaseName]?.condition,
    "service_healthy",
  );
  assert.ok(
    database.healthcheck?.test?.length && !database.healthcheck.disable,
    "PostgreSQL must have a working readiness gate.",
  );
  assert.match(
    database.healthcheck.test.join(" "),
    /\bpg_isready\b.*\s-h\s*127\.0\.0\.1(?:\s|$)/,
    "Readiness must check the final PostgreSQL TCP listener, not its temporary initialization socket.",
  );
  assert.equal(
    Object.keys(configuration.volumes || {}).length,
    0,
    "Distributed persistence must use bind directories.",
  );
  const expectedMounts = new Map([
    [serviceName, [...targets, secretTarget]],
    [initializerName, [secretTarget]],
    [databaseName, [postgresTarget, secretTarget]],
  ]);
  const sharedSecrets = [];
  for (const [name, expectedTargets] of expectedMounts) {
    const volumes = configuration.services[name].volumes || [];
    assert.deepEqual(
      volumes.map((volume) => volume.target).sort(),
      [...expectedTargets].sort(),
      "All required backend, PostgreSQL and secrets mounts must persist.",
    );
    for (const volume of volumes) {
      assert.equal(
        volume.type,
        "bind",
        "Distributed data must use persistent bind directories.",
      );
      const shortMount = `./${relative(repository, volume.source).replaceAll("\\", "/")}:${volume.target}`;
      const shortPattern = new RegExp(
        `^\\s*-\\s*["']?${shortMount.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?::ro)?["']?\\s*(?:#.*)?$`,
        "m",
      );
      assert.ok(
        volume.bind?.create_host_path !== false &&
          (volume.bind?.create_host_path === true ||
            shortPattern.test(rawCompose)),
        "A fresh deployment must create its bind directories automatically.",
      );
      assert.equal(
        Boolean(volume.read_only),
        volume.target === secretTarget && name !== initializerName,
        "Only initializer may write the shared private password directory.",
      );
      if (volume.target === secretTarget) sharedSecrets.push(volume.source);
    }
  }
  assert.equal(
    new Set(sharedSecrets).size,
    1,
    "Initializer, database and backend must share the same password file.",
  );
  assert.ok(
    !Object.values(configuration.networks || {}).some(
      (network) => network.external,
    ),
    "The check must not use an existing external network.",
  );

  if (useNamedVolumes) configuration.volumes = {};
  for (const [name, entry] of Object.entries(configuration.services)) {
    delete entry.container_name;
    if (platform) entry.platform = platform;
    entry.labels = { ...entry.labels, [ownershipLabel]: project };
    if (name === frontendName) {
      if (frontendImage) {
        entry.image = frontendImage;
        entry.pull_policy = "never";
      }
    } else if (name !== databaseName) {
      entry.image = image;
      entry.pull_policy = "never";
    } else if (databaseImage) {
      entry.image = databaseImage;
      entry.pull_policy = "never";
    }
    for (const volume of entry.volumes || []) {
      const key = mountKeys.get(volume.target);
      assert.ok(key, "Unexpected persistent mount target.");
      if (useNamedVolumes) {
        // NTFS Docker Desktop bind mounts cannot reliably enforce mode 0600.
        // Runtime uses isolated Unix volumes here; Linux CI tests the real binds.
        const logicalName = `audit_${key}`;
        const name = `${project}_${key}`;
        volume.type = "volume";
        volume.source = logicalName;
        delete volume.bind;
        volume.volume = { nocopy: true };
        configuration.volumes[logicalName] = {
          name,
          labels: { [ownershipLabel]: project },
        };
        ownedVolumeNames.add(name);
      } else {
        volume.source =
          key === "games"
            ? join(temporaryRoot, key)
            : join(temporaryRoot, "data", key);
        // Some Compose JSON exporters omit this short-syntax default. The
        // normalized long-form copy must keep it explicit for absent paths.
        volume.bind = { ...volume.bind, create_host_path: true };
        // Match a fresh deployment: Docker creates absent bind directories as
        // root; the initializer assigns secrets to the service owner. Creating
        // these leaves as the host CI UID would fail its ownership validation.
      }
    }
  }
  frontend.ports = [
    { target: 8080, published: "0", host_ip: "127.0.0.1", protocol: "tcp" },
  ];
  writeFileSync(testCompose, JSON.stringify(configuration, null, 2), {
    mode: 0o600,
  });
  assertProjectOwnership();
  mayHaveStarted = true;
  compose(
    "Start fresh prebuilt Compose deployment",
    "up",
    "--detach",
    "--no-build",
  );
  let container = ownContainer();
  let frontendContainer = ownContainer(frontendName);
  let base = baseUrl();
  await waitForServer(base, frontendContainer);
  checkSeparatedContainers(container, frontendContainer);
  const web = await checkWeb(base);
  const suffix = randomBytes(4).toString("hex");
  const password = randomBytes(24).toString("base64url");
  const register = async (username) => {
    const response = await request(
      base,
      "/api/auth/basic/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, birth_date: "1990-01-01" }),
      },
      1024 * 1024,
    );
    assert.ok(
      [200, 201].includes(response.status),
      "Self-registration must work on a fresh default deployment.",
    );
    return responseJson(response);
  };
  const first = await register(`compose_admin_${suffix}`);
  assert.ok(
    first.role === 3 && first.activated === true,
    "The first registered user must be an activated administrator.",
  );
  const second = await register(`compose_user_${suffix}`);
  assert.ok(
    second.role === 1 && second.activated === false,
    "Subsequent registrations must remain inactive ordinary users.",
  );
  const login = await request(
    base,
    "/api/auth/basic/login",
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${first.username}:${password}`).toString("base64")}`,
      },
    },
    1024 * 1024,
  );
  assert.equal(
    login.status,
    200,
    "Initial administrator must be able to log in.",
  );
  const tokens = responseJson(login);
  assert.ok(
    typeof tokens.access_token === "string" &&
      typeof tokens.refresh_token === "string",
    "Basic login must return the real TokenPairDto fields.",
  );
  await checkSocketIo(
    base,
    await checkIdentity(base, tokens.access_token, first, second),
  );
  checkPostgresServices();
  const initialState = inspectPersistentState(container, true);
  const databaseContainer = ownContainer(databaseName);

  lifecycle = "independent frontend recreation";
  assertProjectOwnership();
  compose(
    "Recreate only the owned frontend",
    "up",
    "--detach",
    "--no-build",
    "--no-deps",
    "--force-recreate",
    frontendName,
  );
  const frontendReplacement = ownContainer(frontendName);
  assert.notEqual(
    frontendReplacement,
    frontendContainer,
    "Frontend recreation must replace only the frontend container.",
  );
  assert.equal(
    ownContainer(),
    container,
    "Frontend recreation must leave the backend running independently.",
  );
  assert.equal(
    ownContainer(databaseName),
    databaseContainer,
    "Frontend recreation must leave PostgreSQL running.",
  );
  frontendContainer = frontendReplacement;
  base = baseUrl();
  await waitForServer(base, frontendContainer);
  await checkSocketIo(
    base,
    await checkIdentity(base, tokens.access_token, first, second),
  );
  checkPostgresServices();
  checkSeparatedContainers(container, frontendContainer);
  await checkWeb(base, web);
  comparePersistentState(initialState, inspectPersistentState(container));

  lifecycle = "independent backend recreation";
  assertProjectOwnership();
  compose(
    "Recreate only the owned API backend",
    "up",
    "--detach",
    "--no-build",
    "--no-deps",
    "--force-recreate",
    serviceName,
  );
  const replacement = ownContainer();
  assert.notEqual(
    replacement,
    container,
    "Force recreation must replace the container.",
  );
  container = replacement;
  assert.equal(
    ownContainer(frontendName),
    frontendContainer,
    "Backend recreation must leave the frontend running independently.",
  );
  assert.equal(
    ownContainer(databaseName),
    databaseContainer,
    "Backend recreation must leave PostgreSQL running.",
  );
  base = baseUrl();
  await waitForServer(base, frontendContainer);
  await checkSocketIo(
    base,
    await checkIdentity(base, tokens.access_token, first, second),
  );
  checkPostgresServices();
  checkSeparatedContainers(container, frontendContainer);
  await checkWeb(base, web);
  comparePersistentState(initialState, inspectPersistentState(container));

  lifecycle = "down/up";
  assertProjectOwnership();
  compose(
    "Remove only the owned project without deleting data",
    "down",
    "--timeout",
    "20",
  );
  assertProjectOwnership();
  compose(
    "Start the same persistent deployment again",
    "up",
    "--detach",
    "--no-build",
  );
  container = ownContainer();
  frontendContainer = ownContainer(frontendName);
  base = baseUrl();
  await waitForServer(base, frontendContainer);
  await checkSocketIo(
    base,
    await checkIdentity(base, tokens.access_token, first, second),
  );
  checkPostgresServices();
  checkSeparatedContainers(container, frontendContainer);
  await checkWeb(base, web);
  comparePersistentState(initialState, inspectPersistentState(container));
} catch (error) {
  failure = error;
} finally {
  try {
    assertTemporaryOwnership();
    if (mayHaveStarted) {
      assertProjectOwnership();
      cleanupOwnershipVerified = true;
      compose(
        "Clean up only this check's containers, network and owned volumes",
        "down",
        ...(useNamedVolumes ? ["--volumes"] : []),
        "--timeout",
        "20",
      );
      // Bind directories may now belong to UID 1000 rather than the CI host UID.
      // An offline helper touches only this fresh, marked temporary directory.
      assertTemporaryOwnership();
      assert.ok(
        !temporaryRoot.includes(","),
        "Cleanup bind source cannot contain a mount separator.",
      );
      if (!useNamedVolumes)
        docker(
          "Remove only this check's temporary bind contents",
          "run",
          "--rm",
          "--pull",
          "never",
          ...(platform ? ["--platform", platform] : []),
          "--network",
          "none",
          "--user",
          "0:0",
          "--label",
          `${ownershipLabel}=${project}`,
          "--entrypoint",
          "node",
          "--mount",
          `type=bind,source=${temporaryRoot},target=/compose-check-cleanup`,
          image,
          "--eval",
          `const fs=require('node:fs');const assert=require('node:assert/strict');const root='/compose-check-cleanup';const marker=root+'/.compose-check-owner';assert.ok(fs.lstatSync(marker).isFile()&&!fs.lstatSync(marker).isSymbolicLink());assert.ok(fs.readFileSync(marker,'utf8')===${JSON.stringify(project)});for(const name of fs.readdirSync(root))fs.rmSync(root+'/'+name,{recursive:true,force:true});`,
        );
    }
    const distance = relative(realTemporaryBase, resolve(temporaryRoot));
    assert.ok(
      distance && !distance.startsWith("..") && !isAbsolute(distance),
      "Final cleanup must stay inside its temporary base.",
    );
    assert.ok(
      !lstatSync(temporaryRoot).isSymbolicLink() &&
        realpathSync(temporaryRoot) === temporaryRoot,
      "Final cleanup directory changed.",
    );
    rmSync(temporaryRoot, { recursive: true, force: true });
  } catch (error) {
    if (!cleanupOwnershipVerified && mayHaveStarted)
      failure ||= new Error(
        "Cleanup refused because project ownership could not be verified.",
      );
    else failure ||= error;
  }
}

if (failure) {
  console.error(`Compose deployment check failed: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(
    `Compose deployment check passed: separate read-only unprivileged Nginx frontend and API-only backend, automatic PostgreSQL initializer and healthy database, SPA/HTML/JS/CSS plus authenticated HTTP and Socket.IO through the frontend proxy, initial admin and inactive second user stored in PostgreSQL, seven persistent data mounts and stable private signing/database keys, original bearer and data retained after independent frontend recreation, independent backend recreation and down/up; isolated ${useNamedVolumes ? "Unix-volume" : "bind-directory"} cleanup completed.`,
  );
}
