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
            book: "Include fields: title, primaryCreator (author), publishers (array), year (string), description, isbn (indetifiers object), pageCount (format).",
            game: "Include fields: title, primaryCreator (developer), publishers (array), year (string), platform (format), description, series.",
            movie: "Include fields: title, primaryCreator (director), publishers (studio), year (string), format (DVD/Bluray), description, cast (tags).",
            music: "Include fields: title, primaryCreator (artist), publishers (label), year (string), format, description."
        };

        const specificInstruction = categoryPrompts[shelfType] || categoryPrompts['book'];

        const itemText = items.map(i => {
            return `"${i.name || i.title}"${i.author ? ` by ${i.author}` : ''}`;
        }).join('\n');

        const prompt = `
        You are an expert cataloguer. Validate and enrich the following items found on a ${shelfType} shelf.
        
        Input Items:
        ${itemText}

        Task:
        1. Correct OCR errors in titles/names.
        2. Identify the real-world collectable.
        3. Output a valid JSON array of objects strictly matching this schema:
        
        interface CollectableSchema {
          title: string;
          primaryCreator: string | null; // Author, Developer, Director, or Artist
          year: string | null;
          kind: "${shelfType}";
          publishers: string[];
          tags: string[]; // Genres, notable attributes
          identifiers: object; // e.g. { isbn: "..." } or { upc: "..." }
          description: string | null;
          format: string | null; // e.g. Hardcover, PS5, DVD
          confidence: number; // 0.0 to 1.0 confidence in identification
        }
        
        ${specificInstruction}
        
        Return ONLY valid JSON. No markdown formatting.
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
