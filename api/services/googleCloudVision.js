const vision = require('@google-cloud/vision');
const fs = require('fs');

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

    /**
     * Extract all text from an image.
     * @param {string} base64Image - The base64 encoded image string (with or without data URI prefix).
     * @returns {Promise<{text: string, confidence: number}>}
     */
    async extractText(base64Image) {
        if (!this.client) throw new Error('Google Cloud Vision client not initialized.');

        // Clean base64 string
        const cleaned = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
        const request = {
            image: {
                content: cleaned,
            },
        };

        const [result] = await this.client.textDetection(request);
        const fullTextAnnotation = result.fullTextAnnotation;

        return {
            text: fullTextAnnotation ? fullTextAnnotation.text : '',
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
        const [result] = await this.client.documentTextDetection({
            image: { content: cleaned },
        });

        const items = this.parseDocumentToItems(result, shelfType);
        return { items };
    }

    parseDocumentToItems(result, shelfType) {
        // This is a naive implementation that assumes lines of text map to items.
        // In reality, proper segmentation requires more complex geometry logic (bounding boxes).
        // For now, we take significant lines of text as potential item names.
        const text = result.fullTextAnnotation?.text || '';
        const lines = text.split('\n').filter(line => line && line.trim().length > 3);

        // De-duplicate and clean
        const uniqueLines = [...new Set(lines.map(l => l.trim()))];

        return uniqueLines.map(line => ({
            name: line,
            type: shelfType,
            confidence: 0.85 // Heuristic confidence
        }));
    }
}

module.exports = { GoogleCloudVisionService };
