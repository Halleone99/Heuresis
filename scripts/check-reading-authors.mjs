import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const app = source("src/App.tsx");
const reading = source("src/components/workspace/ReadingView.tsx");
const authors = source("src/components/workspace/ReadingAuthors.tsx");
const quotes = source("src/components/workspace/QuotationsView.tsx");
const migration = source("supabase/migrations/20261031182227_reading_author_profiles.sql");

// One reading experience and one source of truth for books and quotations.
assert.match(reading, /label: "Your library"/);
assert.match(reading, /label: "Authors"/);
assert.match(reading, /label: "Quotations"/);
assert.match(reading, /<ReadingAuthors userId=\{userId\} books=\{api\.books\} quotes=\{api\.quotes\}/);
assert.match(reading, /<QuotationsView userId=\{userId\}/);
assert.match(reading, /onOpenBook=\{openBook\}/);
assert.match(reading, /onAddBook=\{\(author\) =>/);
assert.doesNotMatch(app, /id: "quotations", label:/);
assert.match(quotes, /useReadingLibrary\(userId\)/);

// Authors are an index of the existing reading items, not a duplicate library.
assert.match(authors, /for \(const book of books\)/);
assert.match(authors, /const key = linked\.get\(normalise\(book\.author\)\)/);
assert.match(authors, /const ids = new Set\(group\.books\.map\(book => book\.id\)\)/);
assert.match(authors, /quote\.readingId && ids\.has\(quote\.readingId\)/);
assert.match(authors, /const BUCKET = "heuresis-reading-media"/);
assert.match(authors, /createSignedUrl/);
assert.match(authors, /findPortraits\(name,/);
assert.match(authors, /uploadPortrait\(userId, choice\.file\)/);
assert.doesNotMatch(authors, /capital_reading_items.*(?:insert|upsert|delete)/);

// The migration cannot create or destroy another reading collection.
assert.match(migration, /create table if not exists public\.heuresis_reading_author_profiles/);
assert.match(migration, /enable row level security/);
assert.match(migration, /storage\.foldername\(name\)/);
assert.doesNotMatch(migration, /create table[^;]*(?:reading_books|reading_entries|capital_reading_items|capital_reading_quotes)/i);
assert.doesNotMatch(migration, /(?:delete from|truncate|drop table)\s+public\.(?:capital_reading_items|capital_reading_quotes)/i);
console.log("Reading Authors integration: shared books and quotations, isolated profiles and private portraits — OK");
