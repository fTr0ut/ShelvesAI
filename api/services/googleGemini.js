const { GoogleGenerativeAI } = require("@google/generative-ai");
const { logPayload } = require('../utils/payloadLogger');

class GoogleGeminiService {
    constructor() {
        const apiKey = process.env.GOOGLE_GEN_AI_KEY;
        if (apiKey) {
            this.genAI = new GoogleGenerativeAI(apiKey);
            const configuredModel =
                process.env.GOOGLE_GEMINI_MODEL ||
                process.env.GOOGLE_GEN_AI_MODEL ||
                "gemini-1.0-pro";
            this.modelName = configuredModel;
            this.model = this.genAI.getGenerativeModel({ model: configuredModel });
        } else {
            console.warn('[GoogleGeminiService] GOOGLE_GEN_AI_KEY not set.');
            this.genAI = null;
            this.model = null;
            this.modelName = null;
        }
    }

    isConfigured() {
        return !!this.model;
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
        if (!this.model) {
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
            const result = await this.model.generateContent(prompt);
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
            const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
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

}

module.exports = { GoogleGeminiService };
