const vision = require('@google-cloud/vision');
const fs = require('fs');
const { logPayload } = require('../utils/payloadLogger');

class GoogleCloudVisionService {
    constructor() {
        // Client will automatically use GOOGLE_APPLICATION_CREDENTIALS env var
        // process.env.GOOGLE_APPLICATION_CREDENTIALS must be set to the path of the JSON key file
        try {
            if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
                this.client = new vision.ImageAnnotatorClient();
            } else {
                console.warn('[GoogleCloudVisionService] GOOGLE_APPLICATION_CREDENTIALS not set or file missing. Service will fail if called.');
                this.client = null;
            }
        } catch (err) {
            console.error('[GoogleCloudVisionService] Failed to initialize client:', err.message);
            this.client = null;
        }
    }

    isConfigured() {
        return !!this.client;
    }

    buildTextDetectionRequest(cleanedBase64) {
        return {
            image: { content: cleanedBase64 },
            features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
        };
    }

    extractTextFromResult(result) {
        if (!result) return '';
        if (result.fullTextAnnotation?.text) return result.fullTextAnnotation.text;
        return result.textAnnotations?.[0]?.description || '';
    }

    buildLogPayload(result) {
        const text = this.extractTextFromResult(result);
        return {
            textPreview: text.slice(0, 4000),
            textLength: text.length,
            annotationCount: Array.isArray(result?.textAnnotations) ? result.textAnnotations.length : 0,
            locale: result?.textAnnotations?.[0]?.locale || null,
        };
    }

    /**
     * Extract all text from an image.
     * @param {string} base64Image - The base64 encoded image string (with or without data URI prefix).
     * @returns {Promise<{text: string, confidence: number}>}
     */
    async extractText(base64Image) {
        if (!this.client) throw new Error('Google Cloud Vision client not initialized.');

        // Clean base64 string
        const cleaned = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
        const [result] = await this.client.annotateImage(this.buildTextDetectionRequest(cleaned));
        const logRaw = process.env.VISION_LOG_RAW_RESPONSE === 'true';
        logPayload({
            source: 'google-cloud-vision',
            operation: 'textDetection',
            payload: logRaw ? result : this.buildLogPayload(result)
        });

        return {
            text: this.extractTextFromResult(result),
            confidence: 0.9 // GCV doesn't provide a single global confidence for full text, assuming high if successful
        };
    }

    /**
     * Detect shelves items by identifying blocks of text which might represent titles.
     * Note: GCV is purely OCR. It doesn't know what a "book" is. We just get text.
     * The logic here attempts to group text lines directly from the OCR response.
     * 
     * @param {string} base64Image 
     * @param {string} shelfType 
     * @returns {Promise<{items: Array<{name: string, type: string, confidence: number}>}>}
     */
    async detectShelfItems(base64Image, shelfType) {
        if (!this.client) throw new Error('Google Cloud Vision client not initialized.');

        const cleaned = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
        const [result] = await this.client.annotateImage(this.buildTextDetectionRequest(cleaned));
        const logRaw = process.env.VISION_LOG_RAW_RESPONSE === 'true';
        logPayload({
            source: 'google-cloud-vision',
            operation: 'textDetection',
            payload: logRaw ? result : this.buildLogPayload(result)
        });

        const items = this.parseDocumentToItems(result, shelfType);
        return { items };
    }

    parseDocumentToItems(result, shelfType) {
        // This is a naive implementation that assumes lines of text map to items.
        // In reality, proper segmentation requires more complex geometry logic (bounding boxes).
        // For now, we take significant lines of text as potential item names.
        const text = this.extractTextFromResult(result);
        return this.parseToItems(text, shelfType);
    }

    /**
     * Parse raw OCR text into minimal item objects.
     * @param {string} ocrText - Full text from OCR
     * @param {string} shelfType - Type of shelf (book, game, movie, etc.)
     * @returns {Array<{title: string, author: string|null}>}
     */
    parseToItems(ocrText, shelfType) {
        if (!ocrText) return [];

        const lines = ocrText.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 2); // Filter very short noise

        const items = [];
        let currentItem = null;

        // Basic heuristics based on shelf type
        lines.forEach(line => {
            // Heuristic: If line implies a "creator" line (by, director, etc), attach to previous title if possible
            // blocked by specific patterns
            const isCreatorLine = /^(by|dir\.|dev\.)\s+/i.test(line);

            if (isCreatorLine && currentItem && !currentItem.author) {
                currentItem.author = line.replace(/^(by|dir\.|dev\.)\s+/i, '').trim();
            } else {
                // Heuristic: Treat as new title
                // Filtering out likely non-title lines could be improved here (e.g. "DVD", "PS5", year only)
                const isNoise = /^(dvd|bluray|ps[45]|xbox|nintendo|switch|isbn|vol\.|volume)\b/i.test(line);
                if (!isNoise) {
                    if (currentItem) items.push(currentItem);
                    currentItem = {
                        title: line,
                        author: null
                    };
                }
            }
        });

        if (currentItem) items.push(currentItem);

        // Deduplicate
        const uniqueItems = [];
        const seen = new Set();
        items.forEach(item => {
            const key = `${item.title}-${item.author}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueItems.push(item);
            }
        });

        // Limit to reasonable number to prevent massive junk payloads
        return uniqueItems.slice(0, 50).map(item => ({
            name: item.title, // map title to name for backward compatibility/enrichment input
            ...item,
            type: shelfType,
            confidence: 0.85
        }));
    }

}

module.exports = { GoogleCloudVisionService };
