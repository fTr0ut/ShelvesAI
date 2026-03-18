# Task 003 — Cleanup dead imports + update DependencyTree

## Context

After Task 001 removed the Gemini enrichment call from `processCatalogLookup`, the `GoogleGeminiService` import and `getGeminiService` helper in `shelvesController.js` are now dead code. The `OpenAI` import was already dead code (noted in DependencyTree). The DependencyTree must be updated to reflect these removals.

## Objective

1. Remove dead imports/code from `shelvesController.js`.
2. Update `AGENTS/DependencyTree.md` to remove the stale dependency.

## Scope

### File 1: `api/controllers/shelvesController.js`

Remove these lines:
- Line 8: `const OpenAI = require("openai");`
- Line 13: `const { GoogleGeminiService } = require('../services/googleGemini');`
- Lines 46-61: The `let geminiService;` variable and the entire `function getGeminiService() { ... }` block (including the blank line after it if present)

Do NOT remove any other imports. All other imports are still used by other functions in the controller.

### File 2: `AGENTS/DependencyTree.md`

In the `#### shelves` section under `controllers/shelvesController.js` dependencies (around line 145):
- Remove the line `  → services/googleGemini.js`

Also in the `## External Service Integrations` table (around line 1107):
- Update the `Google Gemini AI` row: change `services/googleGemini.js` to remove the reference to `controllers/shelvesController.js`. The current entry says the API file is `services/googleGemini.js` — that's still correct since the service itself still exists and is used by `visionPipeline.js`. But check if `shelvesController.js` is mentioned in that row and remove it if so.
- Update the `OpenAI` row similarly — the current entry says `controllers/shelvesController.js (imported, Gemini used instead)`. Change this to indicate it's no longer imported.

Update the `Last updated` date at the top of DependencyTree.md to today's date.

## Non-goals

- Do not refactor or change any logic.
- Do not remove any imports that are still used.
