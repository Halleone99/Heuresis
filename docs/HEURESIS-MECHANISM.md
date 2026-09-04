# Heuresis mechanism

This document is the behavioural contract for standalone Heuresis. The Personal OS implementation remains the design reference, but the rules below are product invariants and should not drift when the desktop UI changes.

## 1. A card is a nucleus, not a flat record

The central term/concept is surrounded by expandable knowledge dimensions.

For language topics the canonical dimensions are:

- **Parts** — characters, radicals, morphological pieces
- **Words** — synonyms, antonyms and related vocabulary
- **Origin** — etymology and history
- **Grammar** — patterns, constructions, collocations and usage
- **Examples** — the card in real contexts
- **Facts** — memorable supporting information
- **Notes** — personal observations

Conceptual topics adapt the labels (for example Related, Structure and Instances) without changing the nucleus + dimensions model.

Existing structured card fields are routed into the appropriate dimension. Additional free knowledge is stored on the card under `_workspace_blocks`. Editing normal card fields must preserve internal `_...` metadata.

## 2. Words are structured relations

Words added around a language card are not generic notes. They are related vocabulary records with a source card and a relation type:

- synonym
- antonym
- related

They remain attributable to their source flashcard, appear in the global Related catalogue and can later be promoted to normal cards.

## 3. Sort and Review are different operations

### Sort

Sort is organisation. It may change:

- interest rank 1–5
- sorting badges/tags
- `_sorted_at`

**Skip** leaves the card unsorted so it can return later. Sort must not create Again/Hard/Good/Easy review grades and must not pretend that organisation is memory practice.

### Review / Flashcards

Review is recall. A review session records:

- encountered
- revealed
- Again / Hard / Good / Easy

A card normally enters Review after completing Sort. Knowledge dimensions stay closed before reveal so they do not leak the answer.

## 4. Learning actions are not grades

After reveal the user may record what they actually did to retain the card, for example:

- Write
- Say aloud
- Hear
- Sentence
- Rephrase
- Own example

These are tracked learning actions. They supplement a review grade; they do not replace it.

## 5. Study work is a separate window

Flashcard Review and Sort open in a dedicated Heuresis Cosmos window rather than replacing the library/navigation surface. The popup/window is the focused learning workspace; the main desktop window remains the library and management surface.

## 6. Database ownership

Standalone Heuresis and Personal OS use the same canonical Supabase Heuresis tables/RPCs. The desktop application must not fork learning data into a second local database. Local state may cache UI/session information, but Supabase remains the source of truth.

## 7. Verification rule

Treat these as separate states:

1. intended behaviour
2. implemented code
3. build/CI verified
4. runtime verified against the live Supabase account

Do not call a feature complete merely because it compiles.
