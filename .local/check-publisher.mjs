import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const YAML = require('yaml');
const repository = path.resolve('.');
const workflow = YAML.parse(fs.readFileSync(path.join(repository, '.github/workflows/deploy.yml'), 'utf8'));
const script = workflow.jobs.publish.steps.find((step) => step.name === 'Publish manifest and release').run;
const directory = path.join(repository, '.local/publisher-fixtures');
fs.mkdirSync(directory, { recursive: true });
const fakeCli = path.join(directory, 'fake-cli.mjs');
fs.writeFileSync(fakeCli, `import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const [command, ...args] = process.argv.slice(2);
const scenario = process.env.PUBLISHER_SCENARIO;
fs.appendFileSync(process.env.PUBLISHER_LOG, JSON.stringify({ command, args }) + '\\n');
if (command === 'node') {
  if (args[0] === '-e') {
    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    process.exit(result.status ?? 1);
  }
  console.log(args[0] === '-p' ? '17.1.0' : 'Release notes');
} else if (command === 'jq') {
  const data = JSON.parse(fs.readFileSync(args.at(-1), 'utf8'));
  console.log(data[args[1].slice(1)] ?? 'null');
} else if (command === 'gh' && args[0] === 'api') {
  // A pending draft is deliberately unavailable through the REST by-tag route.
  if (args[1].includes('/releases/tags/')) {
    console.error('gh: Not Found (HTTP 404)'); process.exit(1);
  }
  if (args[1] === 'graphql') {
    if (scenario === 'forbidden') {
      console.error('gh: Forbidden (HTTP 403)'); process.exit(1);
    } else if (scenario === 'network') {
      console.error('dial tcp: connection refused'); process.exit(1);
    } else if (scenario === 'null-repository') {
      console.log(JSON.stringify({ data: { repository: null } }));
    } else if (scenario === 'graphql-errors') {
      console.log(JSON.stringify({ errors: [{ message: 'Forbidden' }], data: { repository: { id: 'R1', release: null } } }));
    } else if (scenario === 'missing-release-field') {
      console.log(JSON.stringify({ data: { repository: { id: 'R1' } } }));
    } else {
      const absent = ['new', 'create-fails', 'image-fails', 'publish-fails'].includes(scenario);
      console.log(JSON.stringify({ data: { repository: { id: 'R1', release: absent ? null : {
        databaseId: 7, isDraft: scenario === 'published' ? false : scenario === 'invalid' ? null : true } } } }));
    }
  } else if (scenario === 'details-fail') {
    console.error('gh: Not Found (HTTP 404)'); process.exit(1);
  } else {
    console.log(JSON.stringify({ id: 7, tag_name: 'v17.1.0', draft: scenario === 'published' ? false : true,
      target_commitish: scenario === 'other-commit' ? 'b'.repeat(40) : process.env.GITHUB_SHA }));
  }
} else if (command === 'gh' && args[0] === 'release' && args[1] === 'create' && scenario === 'create-fails') {
  process.exit(42);
} else if (command === 'gh' && args.includes('--draft=false') && scenario === 'publish-fails') {
  process.exit(43);
} else if (command === 'docker' && scenario === 'image-fails') {
  process.exit(44);
}
`);

const bashPath = (value) => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_match, drive) => `/${drive.toLowerCase()}`);
const fakeBin = path.join(directory, 'fakebin');
fs.mkdirSync(fakeBin, { recursive: true });
for (const command of ['gh', 'docker', 'node', 'jq']) {
  fs.writeFileSync(path.join(fakeBin, command), `#!/bin/sh\nexec "${bashPath(process.execPath)}" "${bashPath(fakeCli)}" ${command} "$@"\n`);
}
const scenarios = ['dev', 'new', 'forbidden', 'network', 'same-commit', 'other-commit', 'published', 'invalid', 'create-fails', 'image-fails', 'publish-fails', 'null-repository', 'graphql-errors', 'missing-release-field', 'details-fail'];
for (const scenario of scenarios) {
  const fixture = path.join(directory, scenario);
  fs.mkdirSync(path.join(fixture, 'digests'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'digests', 'c'.repeat(64)), '');
  fs.writeFileSync(path.join(fixture, 'publisher.sh'), `export PATH="${bashPath(fakeBin)}:$PATH"\n${script}`);
  const log = path.join(fixture, 'calls.jsonl');
  fs.writeFileSync(log, '');
  const result = spawnSync('C:\\Program Files\\Git\\bin\\bash.exe', ['-e', 'publisher.sh'], {
    cwd: fixture, encoding: 'utf8', env: { ...process.env, GITHUB_REPOSITORY: 'PlayStash/playstash-backend',
      GITHUB_SHA: 'a'.repeat(40), REF_NAME: scenario === 'dev' ? 'dev' : 'main',
      PUBLISHER_SCENARIO: scenario, PUBLISHER_LOG: log },
  });
  if (result.error) throw result.error;
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const index = (command, argument) => calls.findIndex((call) => call.command === command && (!argument || call.args.includes(argument)));
  const imageIndex = index('docker');
  const createIndex = index('gh', 'create');
  const publishIndex = index('gh', '--draft=false');
  const expectedSuccess = ['dev', 'new', 'same-commit', 'published'].includes(scenario);
  assert.equal(result.status === 0, expectedSuccess, `${scenario}: ${result.stderr}`);
  assert.ok(!calls.some((call) => call.command === 'gh' && call.args.some((argument) => argument.includes('/releases/tags/'))), 'Lookup must support pending draft tags');
  if (['forbidden', 'network', 'other-commit', 'invalid', 'create-fails', 'null-repository', 'graphql-errors', 'missing-release-field', 'details-fail'].includes(scenario)) {
    assert.equal(imageIndex, -1, `${scenario} must not publish images`);
    assert.equal(publishIndex, -1, `${scenario} must not publish release`);
  }
  if (['new', 'image-fails', 'publish-fails'].includes(scenario)) {
    assert.ok(createIndex >= 0 && imageIndex > createIndex, `${scenario}: draft must precede image`);
    assert.ok(calls[createIndex].args.includes('--draft'));
    assert.ok(calls[createIndex].args.includes('a'.repeat(40)));
  }
  if (['new', 'same-commit', 'publish-fails'].includes(scenario)) {
    assert.ok(imageIndex >= 0 && publishIndex > imageIndex, `${scenario}: release must follow image`);
  }
  if (scenario === 'image-fails') assert.equal(publishIndex, -1);
  if (scenario === 'published') {
    assert.ok(imageIndex >= 0);
    assert.equal(createIndex, -1);
    assert.equal(publishIndex, -1);
    assert.equal(index('gh', 'edit'), -1);
    assert.ok(!calls[imageIndex].args.includes('ghcr.io/playstash/playstash-backend:v17.1.0'));
    assert.ok(calls[imageIndex].args.includes('ghcr.io/playstash/playstash-backend:latest'));
  }
  if (scenario === 'dev') {
    assert.equal(index('gh'), -1);
    assert.ok(calls[imageIndex].args.includes('ghcr.io/playstash/playstash-backend:dev'));
    assert.ok(!calls[imageIndex].args.includes('ghcr.io/playstash/playstash-backend:v17.1.0'));
  }
  console.log(`PASS ${scenario}`);
}
console.log(`Publisher: ${scenarios.length} scenarios passed using the actual workflow script and fake CLIs.`);
