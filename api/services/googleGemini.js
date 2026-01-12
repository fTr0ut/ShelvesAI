const { GoogleGenerativeAI } = require("@google/generative-ai");
const { logPayload } = require('../utils/payloadLogger');

const DEFAULT_VISION_CONFIDENCE = 0.7;
const MAX_VISION_ITEMS = 50;

function cleanJsonResponse(text) {
    return String(text || '').replace(/```json/g, '').replace(/```/g, '').trim();
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

class GoogleGeminiService {
    constructor() {
        const apiKey = process.env.GOOGLE_GEN_AI_KEY;
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
            this.textModel = this.genAI.getGenerativeModel({ model: textModelName });
            this.visionModel = this.genAI.getGenerativeModel({ model: visionModelName });
            this.modelName = textModelName;
            this.model = this.textModel;
        } else {
            console.warn('[GoogleGeminiService] GOOGLE_GEN_AI_KEY not set.');
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

    buildVisionPrompt(shelfType) {
        const normalizedShelf = normalizeString(shelfType || 'collection');
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
    async enrichWithSchema(items, shelfType) {
        if (!this.textModel) {
            throw new Error('Google Gemini client not initialized.');
        }

        const categoryPrompts = {
            book: `For books, include: ISBN-10 and ISBN-13 in identifiers, page count, binding format (Hardcover/Paperback/Mass Market), series name and number if applicable. Cover URL from Open Library (https://covers.openlibrary.org/b/isbn/{ISBN}-L.jpg) when ISBN is known.`,
            game: `For games, include: platform(s), ESRB rating, developer, publisher, release date, cover art URL from IGDB or official sources if known.`,
            movie: `For movies, include: runtime in minutes, MPAA rating, director, main cast (up to 5), studio, poster URL from TMDB if known.`,
            music: `For music, include: record label, track count, format (CD/Vinyl/Digital), genre tags, album art URL if known.`
        };

        const specificInstruction = categoryPrompts[shelfType] || categoryPrompts['book'];

        const itemText = items.map(i => {
            return `"${i.name || i.title}"${i.author ? ` by ${i.author}` : ''}`;
        }).join('\n');

        const prompt = `You are an expert librarian and cataloguer. Validate and enrich the following items found on a ${shelfType} shelf with CATALOG-QUALITY metadata.

Input Items:
${itemText}

Task:
1. Correct any OCR errors in titles/names.
2. Identify the real-world collectable.
3. Provide comprehensive metadata equivalent to OpenLibrary, Hardcover, or similar databases.

${specificInstruction}

Output a JSON array with this schema for each item:
{
  "title": "string - corrected full title",
  "subtitle": "string or null",
  "primaryCreator": "string - author/developer/director/artist",
  "year": "string - publication/release year (4 digits)",
  "kind": "${shelfType}",
  "publishers": ["array of publisher names"],
  "tags": ["genres", "categories", "notable attributes"],
  "identifiers": { "isbn": "...", "isbn13": "...", "asin": "...", etc },
  "description": "string - brief synopsis (1-2 sentences)",
  "format": "string - physical format (Hardcover, Paperback, DVD, PS5, etc)",
  "pageCount": number or null,
  "series": { "name": "string or null", "number": number or null },
  "coverUrl": "string - URL to cover image if you can construct one from ISBN, otherwise null",
  "confidence": number 0.0-1.0
}

Return ONLY valid JSON array. No markdown, no explanation.
        `;

        try {
            const result = await this.textModel.generateContent(prompt);
            const response = await result.response;
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
            const enrichedItems = JSON.parse(jsonStr);

            // Validation / Fallback for array
            if (!Array.isArray(enrichedItems)) {
                console.warn('[GoogleGeminiService] Response was not an array:', enrichedItems);
                return [];
            }

            return enrichedItems.map(item => ({
                ...item,
                // Ensure kind is set correctly if AI hallucinated
                kind: shelfType,
                // Ensure array fields are arrays
                publishers: Array.isArray(item.publishers) ? item.publishers : (item.publishers ? [item.publishers] : []),
                tags: Array.isArray(item.tags) ? item.tags : [],
                identifiers: item.identifiers || {},
                source: 'gemini-schema-enriched'
            }));

        } catch (err) {
            console.error('[GoogleGeminiService] Schema enrichment failed:', err);
            // Fallback: return extracting items as is
            return items.map(i => ({
                title: i.name || i.title,
                primaryCreator: i.author,
                kind: shelfType,
                confidence: 0.5,
                notes: "Enrichment failed"
            }));
        }
    }

    /**
     * Enrich UNCERTAIN items (medium-confidence OCR) with special handling.
     * Returns catalog-quality metadata matching what OpenLibrary/Hardcover would return.
     */
    async enrichWithSchemaUncertain(items, shelfType) {
        if (!this.textModel) {
            throw new Error('Google Gemini client not initialized.');
        }

        const categoryPrompts = {
            book: `For books, include: ISBN-10 and ISBN-13 in identifiers, page count, binding format (Hardcover/Paperback/Mass Market), series name and number if applicable. Cover URLs from Open Library (https://covers.openlibrary.org/b/isbn/{ISBN}-L.jpg) or Google Books when ISBN is known.`,
            game: `For games, include: platform(s), ESRB rating, developer, publisher, release date, cover art URL from IGDB or official sources if known.`,
            movie: `For movies, include: runtime in minutes, MPAA rating, director, main cast (up to 5), studio, poster URL from TMDB if known.`,
            music: `For music, include: record label, track count, format (CD/Vinyl/Digital), genre tags, album art URL if known.`
        };

        const specificInstruction = categoryPrompts[shelfType] || categoryPrompts['book'];
        const itemText = items.map(i => `"${i.name || i.title}"${i.author ? ` by ${i.author}` : ''}`).join('\n');

        const prompt = `You are an expert librarian and cataloguer with extensive knowledge of published works. The following items were extracted via OCR but recognition is UNCERTAIN or PARTIAL. Text may be incomplete or misspelled.

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
{
  "title": "string - corrected full title",
  "subtitle": "string or null",
  "primaryCreator": "string - author/developer/director/artist",
  "year": "string - publication/release year (4 digits)",
  "kind": "${shelfType}",
  "publishers": ["array of publisher names"],
  "tags": ["genres", "categories", "notable attributes"],
  "identifiers": { "isbn": "...", "isbn13": "...", "asin": "...", etc },
  "description": "string - brief synopsis (1-2 sentences)",
  "format": "string - physical format (Hardcover, Paperback, DVD, PS5, etc)",
  "pageCount": number or null,
  "series": { "name": "string or null", "number": number or null },
  "coverUrl": "string - URL to cover image if you can construct one from ISBN or known sources, otherwise null",
  "confidence": number 0.0-1.0 (be honest - 0.9+ only if certain, 0.6-0.8 for educated guesses),
  "_originalTitle": "string - keep the exact original OCR text for matching"
}

Return ONLY valid JSON array. No markdown, no explanation.`;

        try {
            const result = await this.textModel.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            logPayload({
                source: 'google-gemini',
                operation: 'generateContentUncertain',
                payload: { model: this.modelName, promptPreview: prompt.substring(0, 300), text }
            });

            const jsonStr = cleanJsonResponse(text);
            const enrichedItems = JSON.parse(jsonStr);

            if (!Array.isArray(enrichedItems)) {
                console.warn('[GoogleGeminiService] Uncertain response was not an array:', enrichedItems);
                return [];
            }

            return enrichedItems.map(item => ({
                ...item,
                kind: shelfType,
                publishers: Array.isArray(item.publishers) ? item.publishers : (item.publishers ? [item.publishers] : []),
                tags: Array.isArray(item.tags) ? item.tags : [],
                identifiers: item.identifiers || {},
                source: 'gemini-uncertain-enriched'
            }));

        } catch (err) {
            console.error('[GoogleGeminiService] Uncertain enrichment failed:', err);
            return items.map(i => ({
                title: i.name || i.title,
                _originalTitle: i.name || i.title,
                primaryCreator: i.author,
                kind: shelfType,
                confidence: 0.4,
                notes: "Uncertain enrichment failed"
            }));
        }
    }

    /**
     * Extract shelf items directly from an image using Gemini Vision.
     * @param {string} base64Image
     * @param {string} shelfType
     * @returns {Promise<{items: Array<{name: string, title: string, author: string|null, type: string, confidence: number}>}>}
     */
    async detectShelfItemsFromImage(base64Image, shelfType) {
        if (!this.visionModel) {
            throw new Error('Google Gemini vision model not initialized.');
        }

        const { data, mimeType } = parseInlineImage(base64Image);
        const prompt = this.buildVisionPrompt(shelfType);

        try {
            const result = await this.visionModel.generateContent([
                prompt,
                {
                    inlineData: {
                        data,
                        mimeType,
                    },
                },
            ]);
            const response = await result.response;
            const text = response.text();

            logPayload({
                source: 'google-gemini-vision',
                operation: 'detectShelfItems',
                payload: {
                    model: this.visionModelName,
                    promptPreview: prompt.substring(0, 200),
                    text
                }
            });

            const jsonStr = cleanJsonResponse(text);
            const parsed = JSON.parse(jsonStr);
            if (!Array.isArray(parsed)) {
                console.warn('[GoogleGeminiService] Vision response was not an array:', parsed);
                return { items: [] };
            }

            const items = parsed.map(item => {
                const title = normalizeString(item?.title || item?.name);
                if (!title) return null;
                const author = normalizeString(item?.author || item?.primaryCreator);
                return {
                    name: title,
                    title,
                    author: author || null,
                    type: shelfType,
                    confidence: coerceConfidence(item?.confidence),
                };
            }).filter(Boolean).slice(0, MAX_VISION_ITEMS);

            return { items };
        } catch (err) {
            console.error('[GoogleGeminiService] Vision item detection failed:', err);
            return { items: [] };
        }
    }

}

module.exports = { GoogleGeminiService };
