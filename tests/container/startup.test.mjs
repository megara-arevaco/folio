import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

test("container recovers after SIGKILL, excludes a second writer and preserves restore journals", { timeout: 90000 }, async () => {
  const suffix = randomUUID();
  const volume = `folio-startup-test-${suffix}`;
  const container = `folio-startup-test-${suffix}`;
  const duplicate = `${container}-second`;
  const image = process.env.FOLIO_TEST_IMAGE || "folio-api";
  const seed = code => docker("run", "--rm", "--user", "root", "--entrypoint", "node", "-v", `${volume}:/data`, image, "--input-type=module", "-e", code);
  const record = role => JSON.stringify({ pid: 7, role, token: randomUUID(), startedAt: new Date().toISOString() });
  async function healthy() {
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        if (docker("exec", container, "node", "-e", "fetch('http://127.0.0.1:3001/api/reading-log').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))") === "") return;
      } catch {}
      await setTimeout(250);
    }
    throw new Error(docker("logs", container));
  }
  try {
    docker("volume", "create", volume);
    seed(`import {writeFileSync,chownSync} from 'node:fs'; chownSync('/data',1000,1000); writeFileSync('/data/.folio-instance.lock', ${JSON.stringify(record("api"))});`);
    docker("run", "-d", "--name", container, "-v", `${volume}:/data`, image);
    await healthy();
    assert.throws(() => docker("run", "--name", duplicate, "-v", `${volume}:/data`, image));
    docker("kill", "--signal", "KILL", container);
    docker("start", container);
    await healthy();
    docker("stop", "--time", "10", container);
    seed(`import {writeFileSync} from 'node:fs'; writeFileSync('/data/.folio-instance.guard', ${JSON.stringify(record("folio-lock-guard"))});`);
    docker("start", container);
    await healthy();
    docker("stop", "--time", "10", container);
    seed("import {writeFileSync} from 'node:fs'; writeFileSync('/data/.folio-restore-journal.json','{}');");
    docker("start", container);
    assert.equal(docker("wait", container), "1");
    assert.equal(seed("import {readFileSync} from 'node:fs'; console.log(readFileSync('/data/.folio-restore-journal.json','utf8'));"), "{}");
  } finally {
    for (const name of [duplicate, container]) { try { docker("rm", "-f", name); } catch {} }
    docker("volume", "rm", volume);
  }
});
