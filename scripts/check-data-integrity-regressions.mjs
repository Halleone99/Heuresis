import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./lib/load-ts.mjs";

// Run the production queue implementation against an isolated browser/storage
// fixture. We deliberately do not connect to the production Supabase project.
const state = { values: new Map(), refuseWrites: false };
const localStorage = {
  getItem(key) { return state.values.get(key) ?? null; },
  setItem(key, value) {
    if (state.refuseWrites) throw new Error("QuotaExceededError");
    state.values.set(key, String(value));
  },
};
globalThis.window = {
  localStorage,
  clearTimeout() {},
  setTimeout() { return 0; },
};
let lockCalls = 0;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    onLine: true,
    locks: { async request(_name, run) { lockCalls++; return run(); } },
  },
});

const rejectedId = "invalid-event";
const accepted = new Set();
const fakeDb = {
  async rpc(name, { events }) {
    assert.equal(name, "heuresis_record_events");
    if (events.some((event) => event.client_event_id === rejectedId)) {
      return { error: { code: "23503", message: "foreign key violation" } };
    }
    events.forEach((event) => accepted.add(event.client_event_id));
    return { error: null };
  },
};

const study = loadTs("src/lib/study.ts", { "./supabase": { supabase: fakeDb } });
const queueKey = "heuresis.desktop.eventqueue.v1";
const entries = Array.from({ length: 3001 }, (_, index) => ({
  client_event_id: index === 130 ? rejectedId : "event-" + index,
  card_id: "card-1",
  pack_id: "pack-1",
  session_id: "session-1",
  template_id: null,
  event_type: "good",
  created_at: new Date(2026, 0, 1).toISOString(),
  attempts: 0,
}));
localStorage.setItem(queueKey, JSON.stringify(entries));
assert.equal(study.getStudyQueueState().pending, 3001, "large queues must not silently discard oldest grades");
await study.flushStudyEvents();
assert.equal(accepted.size, 3000, "an invalid event must not prevent valid review grades from uploading");
assert.equal(study.getStudyQueueState().pending, 0);
assert.equal(study.getStudyQueueState().parked, 1, "invalid event must remain for review");
assert.ok(JSON.parse(localStorage.getItem(queueKey)).some((event) => event.client_event_id === rejectedId));
assert.ok(lockCalls > 0, "multiple windows must coordinate event flushing");

state.refuseWrites = true;
await assert.rejects(
  study.recordStudyEvent({ cardId: "card-1", packId: "pack-1", sessionId: "session-1", templateId: null, eventType: "good" }),
  /Cannot save review history/,
  "failed local storage writes must be reported rather than silently acknowledged",
);
state.refuseWrites = false;

// A card editor must preserve ordinary fields outside its current schema,
// reject stale saves and use a revision filter (not just a preflight read).
let lastUpdate = null;
let filters = {};
let stale = false;
const cardsDb = {
  from(table) {
    assert.equal(table, "heuresis_cards");
    return {
      select() {
        return { eq() { return { async single() {
          return { error: null, data: { data: { term: "old", meaning: "old meaning", example: "hidden field", _sorted_at: "past" } } };
        } }; } };
      },
      update(data) {
        lastUpdate = data;
        filters = {};
        return {
          eq(key, value) { filters[key] = value; return this; },
          select() { return { async maybeSingle() { return { error: null, data: stale ? null : { id: "card-1" } }; } }; },
        };
      },
    };
  },
};
const cards = loadTs("src/lib/heuresis.ts", { "./supabase": { supabase: cardsDb } });
const pack = { cardType: { field_schema: [{ key: "term", required: true }, { key: "meaning", required: true }] } };
const values = { term: "new", meaning: "new meaning" };
await cards.updateCard(pack, "card-1", values, { expectedUpdatedAt: "revision-1" });
assert.equal(lastUpdate.data.example, "hidden field", "hidden regular fields must survive");
assert.equal(lastUpdate.data._sorted_at, "past", "internal metadata must survive");
assert.equal(lastUpdate.data.term, "new");
assert.equal(filters.updated_at, "revision-1");
stale = true;
await assert.rejects(
  cards.updateCard(pack, "card-1", values, { expectedUpdatedAt: "revision-1" }),
  /changed on another device/,
);

// Database migration checks remain in the staged SQL change, not in this client-only patch.

const packView = readFileSync("src/components/PackView.tsx", "utf8");
assert.match(packView, /patchCardData\(card\.id, \{ \[DISCARDED_AT_KEY\]/);
assert.doesNotMatch(packView, /deleteCard\(card\.id\)/);
console.log("Data-integrity regression checks passed.");
