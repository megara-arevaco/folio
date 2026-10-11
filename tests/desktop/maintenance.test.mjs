import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createMaintenanceController, runDataTool } from "../../apps/desktop/maintenance.mjs";
import { acquireInstanceLock } from "../../packages/data-safety/src/instanceLock.mjs";

const root = resolve(".");

test("native maintenance serializes work and restarts after success or failure, not verification", async () => {
  const events = [];
  const controller = createMaintenanceController({
    stop: async () => { events.push("stop"); },
    run: async command => { events.push(command); if (command === "restore") throw new Error("injected error"); return "ok"; },
    restart: async () => { events.push("restart"); },
  });
  await controller.execute("backup", "test.zip");
  assert.deepEqual(events, ["stop", "backup", "restart"]);
  events.length = 0;
  await assert.rejects(controller.execute("restore", "test.zip"), /injected error/);
  assert.deepEqual(events, ["stop", "restore", "restart"]);
  events.length = 0;
  await controller.execute("verify", "test.zip");
  assert.deepEqual(events, ["verify"]);
  assert.equal(controller.busy, false);
  await assert.rejects(controller.execute("delete", "test.zip"), /no admitida/);

  let finish;
  const blocked = createMaintenanceController({ stop: async () => {}, run: () => new Promise(resolve => { finish = resolve; }), restart: async () => {} });
  const first = blocked.execute("verify", "test.zip");
  await assert.rejects(blocked.execute("verify", "test.zip"), /otra operación/);
  finish("ok");
  await first;
});

test("desktop tool performs offline backup, verification, restore and explicit lock recovery", async () => {
  const temp = await mkdtemp(join(tmpdir(), "folio-desktop-maintenance-"));
  const data = join(temp, "data");
  const archive = join(temp, "copy.zip");
  let release;
  try {
    await mkdir(join(data, "books"), { recursive: true });
    await writeFile(join(data, "books", "example.epub"), "original-book");
    await writeFile(join(data, "settings.json"), JSON.stringify({ encryptedOpenRouterApiKey: "fake-secret" }));
    release = await acquireInstanceLock(data, "api");
    await assert.rejects(runDataTool({ root, data, command: "backup", file: archive }), /Folio está activo/);
    await release();
    release = undefined;
    await runDataTool({ root, data, command: "backup", file: archive });
    await runDataTool({ root, data, command: "verify", file: archive });
    await assert.rejects(runDataTool({ root, data, command: "backup", file: archive }));
    await writeFile(join(data, "books", "example.epub"), "changed-book");
    await runDataTool({ root, data, command: "restore", file: archive });
    assert.equal(await readFile(join(data, "books", "example.epub"), "utf8"), "original-book");
    assert.equal(JSON.parse(await readFile(join(data, "settings.json"), "utf8")).encryptedOpenRouterApiKey, "fake-secret");
    assert.ok((await readdir(join(data, "backups"))).some(name => name.endsWith(".zip")));
    const badZip = join(temp, "bad.zip");
    await writeFile(badZip, "invalid archive");
    await assert.rejects(runDataTool({ root, data, command: "verify", file: badZip }));
    assert.equal(await readFile(join(data, "books", "example.epub"), "utf8"), "original-book");
    await writeFile(join(data, ".folio-instance.lock"), JSON.stringify({
      pid: 1073741823, role: "api", token: randomUUID(), startedAt: new Date().toISOString(),
    }));
    await runDataTool({ root, data, command: "recover" });
    assert.ok(!(await readdir(data)).includes(".folio-instance.lock"));
  } finally {
    await release?.();
    await rm(temp, { recursive: true, force: true });
  }
});
