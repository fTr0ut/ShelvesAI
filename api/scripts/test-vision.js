require('dotenv').config();
const fs = require('fs');
// const { GoogleCloudVisionService } = require('../services/googleCloudVision'); // Temporarily disabled; keep for easy re-enable.
const { GoogleGeminiService } = require('../services/googleGemini');
const logger = require('../logger');

async function test() {
    const geminiService = new GoogleGeminiService();

    logger.info('--- Configuration Check ---');
    logger.info('Gemini Vision Configured:', geminiService.isVisionConfigured());
    logger.info('Gemini Text Configured:', geminiService.isConfigured());

    // Test with a sample image (create or download a shelf image)
    const imagePath = process.argv[2];
    if (!imagePath) {
        logger.info('\nUsage: node scripts/test-vision.js <image-path>');
        logger.info('No image provided, skipping functional test.');
        return;
    }

    if (!fs.existsSync(imagePath)) {
        logger.error('Image file not found:', imagePath);
        return;
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');

    // 1. Gemini Vision
    if (geminiService.isVisionConfigured()) {
        logger.info('\n--- Testing Gemini Vision ---');
        try {
            logger.info('Detecting Shelf Items (Raw)...');
            const itemResult = await geminiService.detectShelfItemsFromImage(base64, 'book');
            logger.info('Raw Items Found:', itemResult.items.length);
            logger.info('Sample Raw Item:', itemResult.items[0]);

            // 2. Gemini Enrichment
            if (geminiService.isConfigured()) {
                logger.info('\n--- Testing Gemini Enrichment ---');
                const enriched = await geminiService.enrichShelfItems(itemResult.items.slice(0, 5), 'book'); // Limit to 5 for test
                logger.info('Enriched Items:', JSON.stringify(enriched, null, 2));
            } else {
                logger.info('\n--- Gemini Not Configured (Skipping Enrichment) ---');
            }

        } catch (err) {
            logger.error('Vision Test Failed:', err);
        }
    } else {
        logger.info('\n--- Gemini Vision Not Configured (Skipping Vision) ---');
    }
}

test().catch(console.error);
