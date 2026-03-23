const { GoogleGenerativeAI } = require("@google/generative-ai");
const { logPayload } = require('../utils/payloadLogger');
const fs = require('fs');
const path = require('path');
const { normalizeCollectableKind } = require('./collectables/kind');
const { withTimeout } = require('../utils/withTimeout');
const logger = require('../logger');

const DEFAULT_VISION_CONFIDENCE = 0.7;
const MAX_VISION_ITEMS = 50;
// Higher output tokens for enrichment calls to prevent JSON truncation
const ENRICHMENT_MAX_OUTPUT_TOKENS = 16384;
const DEFAULT_REQUEST_TIMEOUT_MS = 60000;

// Load vision settings from config file
let visionSettings = null;
try {
    const configPath = path.join(__dirname, '../config/visionSettings.json');
    if (fs.existsSync(configPath)) {
        visionSettings = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        logger.info('[GoogleGeminiService] Loaded vision settings from config');
    }
} catch (err) {
    logger.warn('[GoogleGeminiService] Failed to load visionSettings.json:', err.message);
}

function resolveVisionSettingsKey(shelfType) {
    if (!visionSettings?.types || !shelfType) return null;
    if (visionSettings.types[shelfType]) return shelfType;

    const normalized = normalizeCollectableKind(shelfType, shelfType);
    if (visionSettings.types[normalized]) return normalized;

    if (normalized === 'album' && visionSettings.types.vinyl) return 'vinyl';

    const plural = normalized.endsWith('s') ? normalized : `${normalized}s`;
    if (visionSettings.types[plural]) return plural;

    return null;
}

function resolveVisionCategory(shelfType) {
    const normalized = normalizeCollectableKind(shelfType, shelfType);
    if (normalized === 'album') return 'music';
    return normalized;
}

/**
 * Get vision settings for a specific shelf type
 * @param {string} shelfType
 * @returns {{ confidenceMax: number, confidenceMin: number, prompt: string, enrichmentPrompt: string|null }}
 */
function getVisionSettingsForType(shelfType) {
    const defaults = visionSettings?.defaults || {
        confidenceMax: 0.92,
        confidenceMin: 0.85,
        prompt: null,
        enrichmentPrompt: null
    };
    const typeKey = resolveVisionSettingsKey(shelfType);
    const typeSettings = typeKey ? visionSettings?.types?.[typeKey] || {} : {};
    return {
        confidenceMax: typeSettings.confidenceMax ?? defaults.confidenceMax,
        confidenceMin: typeSettings.confidenceMin ?? defaults.confidenceMin,
        prompt: typeSettings.prompt || defaults.prompt || null,
        enrichmentPrompt: typeSettings.enrichmentPrompt || defaults.enrichmentPrompt || null
    };
}

function cleanJsonResponse(text) {
    let clean = String(text || '').replace(/```json/g, '').replace(/```/g, '').trim();
    // specific fix for "text before json" - extract the array
    const firstOpen = clean.indexOf('[');
    const lastClose = clean.lastIndexOf(']');
    if (firstOpen >= 0 && lastClose > firstOpen) {
        clean = clean.substring(firstOpen, lastClose + 1);
    }
    return clean;
}

function isTransientGeminiRequestError(err) {
    const message = String(err?.message || '').toLowerCase();
    const stack = String(err?.stack || '').toLowerCase();
    const haystack = `${message} ${stack}`;
    return (
        message.includes('fetch failed')
        || message.includes('timed out')
        || message.includes('abort')
        || haystack.includes('etimedout')
        || haystack.includes('econnreset')
        || haystack.includes('enotfound')
        || haystack.includes('eai_again')
        || haystack.includes('und_err')
    );
}

function buildVisionExtractionError(err) {
    const transient = isTransientGeminiRequestError(err);
    const wrapped = new Error(
        transient
            ? 'Vision extraction provider request failed. Please retry.'
            : 'Vision extraction failed.',
    );
    wrapped.code = transient ? 'VISION_PROVIDER_UNAVAILABLE' : 'VISION_EXTRACTION_FAILED';
    wrapped.cause = err;
    return wrapped;
}

function parseInlineImage(base64Image) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(String(base64Image || ''));
    if (match) {
        return { data: match[2], mimeType: match[1] };
    }
    return { data: base64Image, mimeType: 'image/jpeg' };
}

function normalizeString(value) {
    if (value == null) return '';
    return String(value).trim();
}

function coerceConfidence(value, fallback = DEFAULT_VISION_CONFIDENCE) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(1, num));
}

function normalizeBox2d(value) {
    if (!Array.isArray(value) || value.length !== 4) return null;
    const numeric = value.map((entry) => Number(entry));
    if (!numeric.every((entry) => Number.isFinite(entry))) return null;
    const clamped = numeric.map((entry) => Math.max(0, Math.min(1000, Math.round(entry))));
    const [yMin, xMin, yMax, xMax] = clamped;
    if (yMax <= yMin || xMax <= xMin) return null;
    return clamped;
}

class GoogleGeminiService {
    constructor(options = {}) {
        const apiKey = process.env.GOOGLE_GEN_AI_KEY;
        this.requestTimeoutMs = Number.isFinite(options.requestTimeoutMs)
            ? options.requestTimeoutMs
            : Number.parseInt(process.env.GOOGLE_GEMINI_TIMEOUT_MS || '', 10) || DEFAULT_REQUEST_TIMEOUT_MS;
        if (apiKey) {
            this.genAI = new GoogleGenerativeAI(apiKey);
            const textModelName =
                process.env.GOOGLE_GEMINI_TEXT_MODEL ||
                process.env.GOOGLE_GEMINI_MODEL ||
                process.env.GOOGLE_GEN_AI_MODEL ||
                "gemini-1.0-pro";
            const visionModelName =
                process.env.GOOGLE_GEMINI_VISION_MODEL ||
                textModelName;
            this.textModelName = textModelName;
            this.visionModelName = visionModelName;
            const requestOptions = { timeout: this.requestTimeoutMs };
            this.textModel = this.genAI.getGenerativeModel({ model: textModelName }, requestOptions);
            this.visionModel = this.genAI.getGenerativeModel({ model: visionModelName }, requestOptions);
            this.modelName = textModelName;
            this.model = this.textModel;
        } else {
            logger.warn('[GoogleGeminiService] GOOGLE_GEN_AI_KEY not set.');
            this.genAI = null;
            this.textModel = null;
            this.visionModel = null;
            this.textModelName = null;
            this.visionModelName = null;
            this.model = null;
            this.modelName = null;
        }
    }

    isConfigured() {
        return !!this.textModel;
    }

    isVisionConfigured() {
        return !!this.visionModel;
    }

    /**
     * Execute an enrichment request using chat mode (if conversation history is available
     * and vision/text models match) or standalone generateContent as fallback.
     * @param {string} prompt - The enrichment prompt text
     * @param {Array|null} conversationHistory - Prior vision extraction conversation history
     * @param {string} label - Label for logging/timeout messages
     * @param {object} [options] - Optional settings
     * @param {Array} [options.tools] - Tools to pass to the chat session (e.g., googleSearch)
     * @returns {Promise<GenerateContentResult>}
     */
    async _executeEnrichmentRequest(prompt, conversationHistory, label, options = {}) {
        const { tools } = options;
        const canUseChatMode = Array.isArray(conversationHistory)
            && conversationHistory.length > 0
            && this.visionModelName === this.textModelName;

        if (canUseChatMode) {
            logger.info(`[GoogleGeminiService] Using chat mode for ${label} (vision context available)`);
            const chatParams = {
                history: conversationHistory,
                generationConfig: { maxOutputTokens: ENRICHMENT_MAX_OUTPUT_TOKENS }
            };
            if (tools) chatParams.tools = tools;
            const chat = this.textModel.startChat(chatParams);
            const result = await withTimeout(
                () => chat.sendMessage(prompt),
                this.requestTimeoutMs,
                `Gemini chat ${label}`,
            );
            return result;
        }

        if (conversationHistory?.length > 0) {
            logger.info(`[GoogleGeminiService] Skipping chat mode for ${label}: vision model (${this.visionModelName}) differs from text model (${this.textModelName})`);
        } else {
            logger.info(`[GoogleGeminiService] Using standalone mode for ${label} (no vision context)`);
        }

        const contentRequest = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: ENRICHMENT_MAX_OUTPUT_TOKENS }
        };
        if (tools) contentRequest.tools = tools;
        const result = await withTimeout(
            () => this.textModel.generateContent(contentRequest),
            this.requestTimeoutMs,
            `Gemini standalone ${label}`,
        );
        return result;
    }

    /**
     * Attempt to repair a truncated JSON array by extracting complete objects.
     * @param {string} jsonStr - Potentially truncated JSON array string
     * @returns {string|null} - Repaired JSON array or null if not recoverable
     */
    repairTruncatedJsonArray(jsonStr) {
        // Find the last complete object by looking for "}," or "}" followed by truncation
        const lastCompleteObj = jsonStr.lastIndexOf('},');
        if (lastCompleteObj > 0) {
            // Close the array after the last complete object
            const repaired = jsonStr.substring(0, lastCompleteObj + 1) + ']';
            try {
                JSON.parse(repaired);
                return repaired;
            } catch (e) {
                // Still invalid, try fallback
            }
        }

        // Fallback: look for second-to-last complete object
        const secondLast = jsonStr.lastIndexOf('},', lastCompleteObj - 1);
        if (secondLast > 0) {
            const repaired = jsonStr.substring(0, secondLast + 1) + ']';
            try {
                JSON.parse(repaired);
                return repaired;
            } catch (e) {
                // Can't repair
            }
        }

        return null;
    }

    buildVisionPrompt(shelfType, shelfDescription = null, shelfName = null) {
        const normalizedShelf = normalizeString(shelfType || 'collection');
        const normalizedDescription = normalizeString(shelfDescription);
        const normalizedName = normalizeString(shelfName);
        const settings = getVisionSettingsForType(normalizedShelf);
        const descriptionToken = '{shelfDescription}';
        const nameToken = '{shelfName}';

        // Use type-specific prompt from config if available
        if (settings.prompt) {
            let prompt = settings.prompt.replace(/{shelfType}/g, normalizedShelf);
            if (prompt.includes(descriptionToken)) {
                prompt = prompt.replace(
                    new RegExp(descriptionToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                    normalizedDescription || '',
                );
            }
            if (prompt.includes(nameToken)) {
                prompt = prompt.replace(
                    new RegExp(nameToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                    normalizedName || '',
                );
            }
            return prompt;
        }

        // Fallback to generic prompt
        return `You are assisting with cataloging physical collections. Identify the visible items on a ${normalizedShelf} shelf.
Return ONLY a valid JSON array of objects with:
- title (string)
- author (string or null)
- confidence (number from 0 to 1)
If no items are visible, return [].
Do not include explanations or markdown.`;
    }

    /**
     * Enrich a list of raw item names with structured metadata.
     * @param {Array<{name: string, type: string}>} itemsRaw - List of items with names from OCR.
     * @param {string} shelfType - The type of shelf (book, game, etc.)
     * @returns {Promise<Array<Object>>} - List of enriched items with full metadata.
     */
    async enrichShelfItems(itemsRaw, shelfType) {
        if (!itemsRaw || itemsRaw.length === 0) return [];

        // Map old input format to new expected format if needed, but enrichWithSchema handles basic objects
        // We will call the new schema-enforced method
        return this.enrichWithSchema(itemsRaw, shelfType);
    }

    /**
     * Enrich minimal items with full collectable metadata using strict schema.
     * @param {Array<{title, author}>} items - Minimal items from vision
     * @param {string} shelfType
     * @returns {Promise<Array<CollectableSchema>>}
     */
    async enrichWithSchema(items, shelfType, conversationHistory = null) {
        if (!this.textModel) {
            throw new Error('Google Gemini client not initialized.');
        }

        const normalizedKind = normalizeCollectableKind(shelfType, shelfType);
        const categoryKey = resolveVisionCategory(normalizedKind);

        // Check visionSettings.json for type-specific enrichment prompt first
        const visionTypeSettings = getVisionSettingsForType(shelfType);

        // Fallback category prompts if no config-driven enrichmentPrompt exists
        const categoryPrompts = {
            book: `For books, include: ISBN-10 and ISBN-13 in identifiers, page count, binding format (Hardcover/Paperback/Mass Market), series name and number if applicable, and estimated market value (include currency). Include market value source links (URL + label). Cover URL from Open Library (https://covers.openlibrary.org/b/isbn/{ISBN}-L.jpg) when ISBN is known.`,
            game: `For games, include: system/console (as systemName), platform(s), ESRB rating, developer, publisher, release date, cover art URL from IGDB or official sources if known, and estimated market value (include currency). Include market value source links (URL + label).`,
            movie: `For movies, include: runtime in minutes, MPAA rating, director, main cast (up to 5), studio, and estimated market value (include currency). Include market value source links (URL + label). For coverUrl, provide a direct image URL to the movie poster from Wikipedia, IMDb, or any reliable public source - NOT a TMDB URL (those require API access).`,
            music: `For music, include: record label, track count, format (CD/Vinyl/Digital), genre tags, album art URL if known, and estimated market value (include currency). Include market value source links (URL + label).`
        };

        // Use config enrichmentPrompt if available, otherwise fall back to category defaults
        const specificInstruction = visionTypeSettings.enrichmentPrompt || categoryPrompts[categoryKey] || categoryPrompts['book'];

        const itemText = items.map(i => {
            return `"${i.name || i.title}"${i.author ? ` by ${i.author}` : ''}`;
        }).join('\n');

        // Schema definition shared by both prompt variants
        const schemaBlock = `{
  "title": "string - corrected full title",
  "subtitle": "string or null",
  "primaryCreator": "string - author/developer/director/artist",
  "year": "string - publication/release year (4 digits)",
  "kind": "${normalizedKind}",
  "publishers": ["array of publisher names"],
  "tags": ["genres", "categories", "notable attributes"],
  "identifiers": { "isbn": "...", "isbn13": "...", "asin": "...", etc },
  "description": "string - brief synopsis (1-2 sentences)",
  "marketValue": "string or null - estimated current market value with currency (for example: USD $45)",
  "marketValueSources": [{"url":"string","label":"string or null"}],
  "format": "string - physical format (Hardcover, Paperback, DVD, PS5, etc)",
  "systemName": "string or null - console/system name (PlayStation 5, Nintendo Switch, Xbox Series X, etc)",
  "pageCount": number or null,
  "series": { "name": "string or null", "number": number or null },
  "coverUrl": "string - URL to cover image if you can construct one from ISBN, otherwise null",
  "confidence": number 0.0-1.0
}`;

        // Determine if chat mode is available for prompt selection
        const canUseChatMode = Array.isArray(conversationHistory)
            && conversationHistory.length > 0
            && this.visionModelName === this.textModelName;

        const prompt = canUseChatMode
            ? `From the items you extracted, the following could not be matched in our catalog and need your enrichment. Refer back to the shelf photo to correct any OCR misreadings.

Items to enrich:
${itemText}

${specificInstruction}

Output a JSON array with this schema for each item:
${schemaBlock}

Return ONLY valid JSON array. No markdown, no explanation.`
            : `You are an expert librarian and cataloguer. Validate and enrich the following items found on a ${shelfType} shelf with CATALOG-QUALITY metadata.

Input Items:
${itemText}

Task:
1. Correct any OCR errors in titles/names.
2. Identify the real-world collectable.
3. Provide comprehensive metadata equivalent to OpenLibrary, Hardcover, or similar databases.

${specificInstruction}

Output a JSON array with this schema for each item:
${schemaBlock}

Return ONLY valid JSON array. No markdown, no explanation.`;

        try {
            const result = await this._executeEnrichmentRequest(
                prompt, conversationHistory, 'schema enrichment'
            );
            const response = await withTimeout(
                () => result.response,
                this.requestTimeoutMs,
                'Gemini schema enrichment response',
            );
            const text = response.text();

            logPayload({
                source: 'google-gemini',
                operation: 'generateContent',
                payload: {
                    model: this.modelName,
                    promptPreview: prompt.substring(0, 200),
                    text
                }
            });

            // Clean markdown if present
            const jsonStr = cleanJsonResponse(text);

            // Check for truncation (incomplete JSON)
            if (!jsonStr.endsWith(']')) {
                logger.warn('[GoogleGeminiService] Response appears truncated, attempting repair...');
                const repaired = this.repairTruncatedJsonArray(jsonStr);
                if (repaired) {
                    const partialItems = JSON.parse(repaired);
                    logger.info('[GoogleGeminiService] Recovered', partialItems.length, 'items from truncated response');
                    const items = partialItems.map(item => ({
                        ...item,
                        kind: normalizedKind,
                        publishers: Array.isArray(item.publishers) ? item.publishers : (item.publishers ? [item.publishers] : []),
                        tags: Array.isArray(item.tags) ? item.tags : [],
                        identifiers: item.identifiers || {},
                        source: 'gemini-schema-enriched-partial'
                    }));
                    return {
                        items,
                        warning: 'Not all items could be processed. Try again or take multiple photos of smaller subsets.'
                    };
                }
            }

            const enrichedItems = JSON.parse(jsonStr);

            // Validation / Fallback for array
            if (!Array.isArray(enrichedItems)) {
                logger.warn('[GoogleGeminiService] Response was not an array:', enrichedItems);
                return [];
            }


            return enrichedItems.map(item => ({
                ...item,
                // Ensure kind is set correctly if AI hallucinated
                kind: normalizedKind,
                // Ensure array fields are arrays
                publishers: Array.isArray(item.publishers) ? item.publishers : (item.publishers ? [item.publishers] : []),
                tags: Array.isArray(item.tags) ? item.tags : [],
                identifiers: item.identifiers || {},
                source: 'gemini-schema-enriched'
            }));

        } catch (err) {
            logger.error('[GoogleGeminiService] Schema enrichment failed:', err);
            // Fallback: return extracting items as is
            return items.map(i => ({
                title: i.name || i.title,
                primaryCreator: i.author,
                kind: normalizedKind,
                confidence: 0.5,
                notes: "Enrichment failed"
            }));
        }
    }

    /**
     * Enrich UNCERTAIN items (medium-confidence OCR) with special handling.
     * Returns catalog-quality metadata matching what OpenLibrary/Hardcover would return.
     */
    async enrichWithSchemaUncertain(items, shelfType, conversationHistory = null) {
        if (!this.textModel) {
            throw new Error('Google Gemini client not initialized.');
        }

        const normalizedKind = normalizeCollectableKind(shelfType, shelfType);
        const categoryKey = resolveVisionCategory(normalizedKind);

        // Check visionSettings.json for type-specific enrichment prompt first
        const visionTypeSettings = getVisionSettingsForType(shelfType);

        // Fallback category prompts if no config-driven enrichmentPrompt exists
        const categoryPrompts = {
            book: `For books, include: ISBN-10 and ISBN-13 in identifiers, page count, binding format (Hardcover/Paperback/Mass Market), series name and number if applicable. Cover URLs from Open Library (https://covers.openlibrary.org/b/isbn/{ISBN}-L.jpg) or Google Books when ISBN is known. Include estimated market value with currency and source links (URL + label).`,
            game: `For games, include: system/console (as systemName), platform(s), ESRB rating, developer, publisher, release date, cover art URL from IGDB or official sources if known, and estimated market value with currency. Include source links (URL + label) for market value.`,
            movie: `For movies, include: runtime in minutes, MPAA rating, director, main cast (up to 5), studio. For coverUrl, provide a direct image URL to the movie poster from Wikipedia, IMDb, or any reliable public source - NOT a TMDB URL (those require API access). Include estimated market value with currency and source links (URL + label).`,
            music: `For music, include: record label, track count, format (CD/Vinyl/Digital), genre tags, album art URL if known, and estimated market value with currency. Include source links (URL + label) for market value.`
        };

        // Use config enrichmentPrompt if available, otherwise fall back to category defaults
        const specificInstruction = visionTypeSettings.enrichmentPrompt || categoryPrompts[categoryKey] || categoryPrompts['book'];
        const itemText = items.map(i => `"${i.name || i.title}"${i.author ? ` by ${i.author}` : ''}`).join('\n');

        // Schema definition shared by both prompt variants
        const schemaBlock = `{
  "title": "string - corrected full title",
  "subtitle": "string or null",
  "primaryCreator": "string - author/developer/director/artist",
  "year": "string - publication/release year (4 digits)",
  "kind": "${normalizedKind}",
  "publishers": ["array of publisher names"],
  "tags": ["genres", "categories", "notable attributes"],
  "identifiers": { "isbn": "...", "isbn13": "...", "asin": "...", etc },
  "description": "string - brief synopsis (1-2 sentences)",
  "marketValue": "string or null - estimated current market value with currency (for example: USD $45)",
  "marketValueSources": [{"url":"string","label":"string or null"}],
  "format": "string - physical format (Hardcover, Paperback, DVD, PS5, etc)",
  "systemName": "string or null - console/system name (PlayStation 5, Nintendo Switch, Xbox Series X, etc)",
  "pageCount": number or null,
  "series": { "name": "string or null", "number": number or null },
  "coverUrl": "string - URL to cover image if you can construct one from ISBN or known sources, otherwise null",
  "confidence": number 0.0-1.0 (be honest - 0.9+ only if certain, 0.6-0.8 for educated guesses),
  "_originalTitle": "string - keep the exact original OCR text for matching"
}`;

        // Determine if chat mode is available for prompt selection
        const canUseChatMode = Array.isArray(conversationHistory)
            && conversationHistory.length > 0
            && this.visionModelName === this.textModelName;

        const prompt = canUseChatMode
            ? `Some of the items you extracted from the shelf photo had uncertain or partial OCR readings. Look at the shelf photo again and use what you can see to correct garbled text, missing letters, and partial titles. Make your best guess at identifying these items.

Items with uncertain OCR:
${itemText}

${specificInstruction}

Output a JSON array with this schema for each item:
${schemaBlock}

Return ONLY valid JSON array. No markdown, no explanation.`
            : `You are an expert librarian and cataloguer with extensive knowledge of published works. The following items were extracted via OCR but recognition is UNCERTAIN or PARTIAL. Text may be incomplete or misspelled.

Input Items (uncertain OCR):
${itemText}

Your task is to identify these items and return CATALOG-QUALITY metadata equivalent to what OpenLibrary, Hardcover, or similar databases would provide.

Instructions:
1. Make your BEST GUESS at the real-world item. Use your knowledge of popular ${shelfType}s.
2. Correct OCR errors (missing letters, garbled text, partial titles).
3. If the input appears to be just an author/creator name without a title, try to identify their most popular or recent work, OR return title: null if you cannot determine the specific work.
4. Provide as much metadata as you can confidently identify.

${specificInstruction}

Output a JSON array with this schema for each item:
${schemaBlock}

Return ONLY valid JSON array. No markdown, no explanation.`;

        try {
            const result = await this._executeEnrichmentRequest(
                prompt, conversationHistory, 'uncertain enrichment'
            );
            const response = await withTimeout(
                () => result.response,
                this.requestTimeoutMs,
                'Gemini uncertain enrichment response',
            );
            const text = response.text();

            logPayload({
                source: 'google-gemini',
                operation: 'generateContentUncertain',
                payload: { model: this.modelName, promptPreview: prompt.substring(0, 300), text }
            });

            const jsonStr = cleanJsonResponse(text);

            // Check for truncation (incomplete JSON)
            if (!jsonStr.endsWith(']')) {
                logger.warn('[GoogleGeminiService] Response appears truncated, attempting repair...');
                // Try to extract complete items before the truncation point
                const repaired = this.repairTruncatedJsonArray(jsonStr);
                if (repaired) {
                    const partialItems = JSON.parse(repaired);
                    logger.info('[GoogleGeminiService] Recovered', partialItems.length, 'items from truncated response');
                    const items = partialItems.map(item => ({
                        ...item,
                        kind: normalizedKind,
                        publishers: Array.isArray(item.publishers) ? item.publishers : (item.publishers ? [item.publishers] : []),
                        tags: Array.isArray(item.tags) ? item.tags : [],
                        identifiers: item.identifiers || {},
                        source: 'gemini-uncertain-enriched-partial'
                    }));
                    return {
                        items,
                        warning: 'Not all items could be processed. Try again or take multiple photos of smaller subsets.'
                    };
                }
            }

            const enrichedItems = JSON.parse(jsonStr);

            if (!Array.isArray(enrichedItems)) {
                logger.warn('[GoogleGeminiService] Uncertain response was not an array:', enrichedItems);
                return [];
            }

            return enrichedItems.map(item => ({
                ...item,
                kind: normalizedKind,
                publishers: Array.isArray(item.publishers) ? item.publishers : (item.publishers ? [item.publishers] : []),
                tags: Array.isArray(item.tags) ? item.tags : [],
                identifiers: item.identifiers || {},
                source: 'gemini-uncertain-enriched'
            }));

        } catch (err) {
            logger.error('[GoogleGeminiService] Uncertain enrichment failed:', err);
            return items.map(i => ({
                title: i.name || i.title,
                _originalTitle: i.name || i.title,
                primaryCreator: i.author,
                kind: normalizedKind,
                confidence: 0.4,
                notes: "Uncertain enrichment failed"
            }));
        }
    }

    /**
     * Extract shelf items directly from an image using Gemini Vision.
     * @param {string} base64Image
     * @param {string} shelfType
     * @param {string|null} shelfDescription
     * @param {string|null} shelfName
     * @returns {Promise<{items: Array<{name: string, title: string, author: string|null, type: string, confidence: number}>, conversationHistory: Array|null, warning: string|null}>}
     */
    async detectShelfItemsFromImage(base64Image, shelfType, shelfDescription = null, shelfName = null) {
        if (!this.visionModel) {
            throw new Error('Google Gemini vision model not initialized.');
        }

        const normalizedKind = normalizeCollectableKind(shelfType, shelfType);
        const { data, mimeType } = parseInlineImage(base64Image);
        const isOther = shelfType === 'other';
        const visionPrompt = this.buildVisionPrompt(shelfType, shelfDescription, shelfName);

        try {
            // Vision extraction — "other" shelves include search grounding to get full metadata in one call
            // Thinking budget: 0 for standard shelves (pure OCR perception), 3000 for "other" (search + reasoning)
            const generateOptions = {
                contents: [
                    {
                        role: 'user', parts: [
                            { text: visionPrompt },
                            { inlineData: { data, mimeType } }
                        ]
                    }
                ],
                generationConfig: {
                    thinkingConfig: { thinkingBudget: isOther ? 3000 : 0 }
                }
            };
            if (isOther) {
                generateOptions.tools = [{ googleSearch: {} }];
            }

            let visionResult = null;
            const maxAttempts = 2;
            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                try {
                    visionResult = await withTimeout(
                        () => this.visionModel.generateContent(generateOptions),
                        this.requestTimeoutMs,
                        `Gemini vision extraction request (attempt ${attempt})`,
                    );
                    break;
                } catch (requestErr) {
                    const canRetry = attempt < maxAttempts && isTransientGeminiRequestError(requestErr);
                    if (!canRetry) throw requestErr;
                    logger.warn('[GoogleGeminiService] Vision extraction request failed, retrying once:', requestErr?.message || requestErr);
                }
            }
            const visionResponse = await withTimeout(
                () => visionResult.response,
                this.requestTimeoutMs,
                'Gemini vision extraction response',
            );
            const visionText = visionResponse.text();

            logPayload({
                source: 'google-gemini-vision',
                operation: 'detectShelfItems',
                payload: {
                    model: this.visionModelName,
                    promptPreview: visionPrompt.substring(0, 200),
                    text: visionText
                }
            });

            const jsonStr = cleanJsonResponse(visionText);
            let parsedItems = [];
            let warning = null;
            try {
                parsedItems = JSON.parse(jsonStr);
            } catch (e) {
                logger.warn('[GoogleGeminiService] Failed to parse vision JSON, attempting truncated repair:', e);
                const repaired = this.repairTruncatedJsonArray(jsonStr);
                if (repaired) {
                    try {
                        parsedItems = JSON.parse(repaired);
                        warning = 'Vision response was truncated; only complete detected items were processed.';
                        logger.info('[GoogleGeminiService] Recovered', parsedItems.length, 'items from truncated vision response');
                    } catch (repairErr) {
                        logger.warn('[GoogleGeminiService] Failed to parse repaired vision JSON:', repairErr);
                    }
                }
            }

            if (!Array.isArray(parsedItems)) {
                if (parsedItems && Array.isArray(parsedItems.items)) {
                    parsedItems = parsedItems.items;
                } else {
                    logger.warn('[GoogleGeminiService] Vision response was not an array:', parsedItems);
                    parsedItems = [];
                }
            }

            // Build conversation history from vision extraction for downstream enrichment
            const userContent = {
                role: 'user',
                parts: [
                    { text: visionPrompt },
                    { inlineData: { data, mimeType } }
                ]
            };
            const modelContent = visionResponse.candidates?.[0]?.content;
            const conversationHistory = modelContent ? [userContent, modelContent] : null;

            const items = parsedItems.map((item, index) => {
                const raw = item && typeof item === 'object' ? item : {};
                const title = normalizeString(raw.title || raw.name || raw.itemName);
                if (!title) return null;
                const author = normalizeString(
                    raw.author || raw.primaryCreator || raw.creator || raw.brand || raw.publisher || raw.manufacturer,
                );
                const primaryCreator = normalizeString(
                    raw.primaryCreator || raw.author || raw.creator || raw.brand || raw.publisher || raw.manufacturer,
                );
                const box2d = normalizeBox2d(raw.box_2d || raw.box2d);
                return {
                    ...raw,
                    name: title,
                    title,
                    author: author || null,
                    primaryCreator: primaryCreator || null,
                    type: normalizedKind,
                    kind: normalizedKind,
                    confidence: coerceConfidence(raw.confidence),
                    extractionIndex: Number.isInteger(raw.extractionIndex) ? raw.extractionIndex : index,
                    box2d,
                };
            }).filter(Boolean).slice(0, MAX_VISION_ITEMS);

            return { items, conversationHistory, warning };
        } catch (err) {
            logger.error('[GoogleGeminiService] Vision item detection failed:', err);
            throw buildVisionExtractionError(err);
        }
    }

}

module.exports = { GoogleGeminiService, getVisionSettingsForType };
