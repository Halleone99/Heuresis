import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./lib/load-ts.mjs";

// Exercise the production journal reader against an IndexedDB-shaped store:
// the active account is included; other users are not; old unowned entries
// are counted for separate review but never copied into an account backup.
const rows = [
  { id: "queued-1", ownerId: "user-a", url: "https://db.test/rest/v1/knowledge_records",
    method: "POST", body: '{"id":"note-1"}', createdAt: "2026-10-25T08:00:00Z", attempts: 1 },
  { id: "other-account", ownerId: "user-b", url: "https://db.test/rest/v1/knowledge_records",
    method: "POST", body: "secret", createdAt: "2026-10-25T08:01:00Z", attempts: 0 },
  { id: "unassigned", url: "https://db.test/rest/v1/knowledge_records",
    method: "POST", body: "unassigned content", createdAt: "2026-10-25T08:02:00Z", attempts: 0 },
  { id: "held", ownerId: "user-a", url: "https://db.test/rest/v1/knowledge_records?id=eq.note-1",
    method: "PATCH", body: '{"body":"new text"}', createdAt: "2026-10-25T08:03:00Z", attempts: 3,
    rejected: { status: 409, message: "conflict", at: "2026-10-25T08:04:00Z" } },
];
let failRead = false;
const database = {
  transaction() {
    return { objectStore() {
      return { getAll() {
        const request = {};
        queueMicrotask(() => {
          if (failRead) { request.error = Error("disk unavailable"); request.onerror(); }
          else { request.result = rows; request.onsuccess(); }
        });
        return request;
      } };
    } };
  },
};
globalThis.indexedDB = {
  open() {
    const request = { result: database };
    queueMicrotask(() => request.onsuccess());
    return request;
  },
};
const offline = loadTs("src/lib/offlineFetch.ts");
offline.setOfflineAccount("user-a");
const snapshot = await offline.snapshotOfflineWritesForBackup("user-a");
assert.deepEqual(snapshot.entries.map((row) => row.id), ["queued-1", "held"]);
assert.equal(snapshot.entries[1].rejected.status, 409, "refused edits survive as recoverable data");
assert.equal(snapshot.legacy_unassigned_count, 1);
assert.ok(!JSON.stringify(snapshot).includes("secret"), "another account must not enter the copy");
assert.ok(!JSON.stringify(snapshot).includes("unassigned content"), "old unowned content stays quarantined");
await assert.rejects(() => offline.snapshotOfflineWritesForBackup("user-b"), /account/);
failRead = true;
await assert.rejects(() => offline.snapshotOfflineWritesForBackup("user-a"), /disk unavailable/, "a failed queue read must prevent completion");

const backup = readFileSync("src/lib/localBackup.ts", "utf8");
const { backupAgeNotice } = loadTs("src/lib/backupFreshness.ts");
const onDate = new Date(2026, 9, 25, 10, 0);
assert.equal(backupAgeNotice("2026-10-25", onDate), null);
assert.equal(backupAgeNotice("2026-10-23", onDate), null);
assert.match(backupAgeNotice("2026-10-22", onDate), /Last PC backup/);
assert.match(backupAgeNotice(null, onDate), /No PC backup saved yet/);
const native = readFileSync("src-tauri/src/local_backup.rs", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const notebook = readFileSync("src/components/workspace/NotebookView.tsx", "utf8");
assert.match(backup, /snapshotOfflineWritesForBackup\(userId\)/);
assert.match(backup, /page_key\.like\.heuresis-%/, "Each Heuresis page wallpaper belongs in the backup");
assert.doesNotMatch(backup, /query\.eq\("page_key", "heuresis"\)/, "Backup must not omit per-page background rows");
assert.match(app, /localBackupAgeNotice/, "Quiet stale status appears in the account menu");
assert.match(backup, /JSON\.stringify\(offlineAtStart\) !== JSON\.stringify\(await snapshotOfflineWritesForBackup\(userId\)\)/,
  "offline edits changing mid-export must abort publishing");
assert.match(backup, /offline_recovery:/, "the full snapshot must include recovery data");
assert.match(native, /pending_offline_writes/, "native manifest records the recovery journal count");
assert.match(native, /offline_recovery\/entries/, "native code must validate recovery journal presence");
assert.doesNotMatch(app, /Backup needs attention:/, "background backup never posts an alarming banner");
assert.doesNotMatch(notebook, /className="nb-capture-summary"/, "Notebook does not nag about captures");
assert.match(notebook, /Captures\{pendingCaptures/, "the compact navigation to pending captures remains");
console.log("Backup safety and quiet interface checks passed.");
