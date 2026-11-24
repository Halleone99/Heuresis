// Verify narrow revision-checked metadata updates without touching real cards.
import assert from "node:assert/strict";
import { loadTs } from "./lib/load-ts.mjs";
let calls = [], response = { data: { id: "c", updated_at: "r2" }, error: null };
let sync = { online: true, syncing: false, pending: 0, held: 0 };
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
const chain = {
  update: (patch) => { calls.push(["patch", patch]); return chain; },
  eq: (key, value) => { calls.push(["eq", key, value]); return chain; },
  select: (fields) => { calls.push(["select", fields]); return chain; },
  maybeSingle: async () => response,
};
const { updateCardMetadata } = loadTs("src/lib/cardMetadata.ts", {
  "./supabase": { supabase: { from: (table) => { calls.push(["table", table]); return chain; } } },
  "./offlineFetch": { getOfflineSyncState: () => sync },
});
const card = { id: "c", pack_id: "p", updated_at: "r1" };
assert.equal(await updateCardMetadata(card, { favourite: true, note: "do not write", data: { term: "do not write" } }), "r2");
assert.deepEqual(calls, [["table", "heuresis_cards"], ["patch", { favourite: true }], ["eq", "id", "c"], ["eq", "pack_id", "p"], ["eq", "updated_at", "r1"], ["select", "id,updated_at"]]);
calls = [];
await updateCardMetadata(card, { interest_rank: 5 });
assert.deepEqual(calls[1], ["patch", { interest_rank: 5, interesting: true }]);
calls = [];
await updateCardMetadata(card, { interest_rank: 4, interesting: false });
assert.deepEqual(calls[1], ["patch", { interest_rank: 4, interesting: false }], "Undo preserves legacy metadata exactly");
calls = [];
await assert.rejects(updateCardMetadata(card, { interest_rank: 99 }), /Invalid importance/);
assert.equal(calls.length, 0);
sync.pending = 1;
await assert.rejects(updateCardMetadata(card, { favourite: true }), /synchronising/);
assert.equal(calls.length, 0);
sync.pending = 0;
response = { data: null, error: null };
await assert.rejects(updateCardMetadata(card, { favourite: true }), /another device/);
response = { data: { id: "c" }, error: null };
await assert.rejects(updateCardMetadata(card, { favourite: true }), /could not be confirmed/);
response = { data: { id: "c", updated_at: "r1" }, error: null };
await assert.rejects(updateCardMetadata(card, { favourite: true }), /could not be confirmed/);
console.log("Card metadata safety checks passed.");
