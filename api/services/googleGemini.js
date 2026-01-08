const { GoogleGenerativeAI } = require("@google/generative-ai");

class GoogleGeminiService {
    constructor() {
        const apiKey = process.env.GOOGLE_GEN_AI_KEY;
        if (apiKey) {
            this.genAI = new GoogleGenerativeAI(apiKey);
            // Using gemini-1.5-flash for cost efficiency and speed
            this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        } else {
            console.warn('[GoogleGeminiService] GOOGLE_GEN_AI_KEY not set.');
            this.genAI = null;
            this.model = null;
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
        if (!this.model) {
            throw new Error('Google Gemini client not initialized.');
        }

        if (!itemsRaw || itemsRaw.length === 0) return [];

        const itemNames = itemsRaw.map(i => i.name).join('\n');
        const prompt = `
      You are an expert librarian and collector helper. I have a list of text strings extracted from a photo of a ${shelfType} shelf via OCR. 
      Some text might be fragments, authors, or titles. 
      
      Please analyze the following list of strings, correct any obvious OCR errors, and identify the distinct real-world items (books, games, movies, etc.). 
      For each identified item, provide the following details in JSON format:
      - title: The canonical title.
      - author: Primary author, director, or creator.
      - publisher: Publisher or studio.
      - year: Release year (string).
      - format: Physical format if inferable (e.g., Hardcover, Blu-ray), otherwise "Physical".
      - description: A very brief 1-sentence description.
      - genre: Primary genre.
      
      Return ONLY a valid JSON array of objects. Do not wrap in markdown code blocks.

      Input Strings:
      ${itemNames}
    `;

        try {
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            // Clean markdown if present
            const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const enrichedItems = JSON.parse(jsonStr);

            // Merge/Validation (ensure we return what's expected)
            return enrichedItems.map(item => ({
                ...item,
                type: shelfType, // Ensure type matches shelf
                confidence: 0.95,
                source: 'gemini-enrichment'
            }));

        } catch (err) {
            console.error('[GoogleGeminiService] Enrichment failed:', err);
            // Fallback: return extracting items as is with basics
            return itemsRaw.map(i => ({
                title: i.name,
                type: shelfType,
                confidence: 0.5,
                notes: "Enrichment failed, raw OCR result."
            }));
        }
    }
}

module.exports = { GoogleGeminiService };
