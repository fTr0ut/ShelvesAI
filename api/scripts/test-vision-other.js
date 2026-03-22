require('dotenv').config({ path: '../.env' }); // Adjust path to .env if needed
const fs = require('fs');
const path = require('path');
const { GoogleGeminiService } = require('../services/googleGemini');
const logger = require('../logger');

async function testOtherShelfVision() {
    const imagePath = process.argv[2];
    if (!imagePath) {
        logger.info('Usage: node test-vision-other.js <path-to-image>');
        logger.info('Example: node test-vision-other.js ./sample-vintage-camera.jpg');
        process.exit(1);
    }

    if (!fs.existsSync(imagePath)) {
        logger.error(`Error: Image file not found at ${imagePath}`);
        process.exit(1);
    }

    logger.info(`\n--- Testing "Other" Shelf Vision on: ${imagePath} ---\n`);

    try {
        const service = new GoogleGeminiService();
        if (!service.isVisionConfigured()) {
            logger.error('Error: Google Gemini Vision is not configured. Check GOOGLE_GEN_AI_KEY.');
            process.exit(1);
        }

        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString('base64');
        const shelfType = 'other';

        logger.info('Sending request to Gemini with Google Search tool enabled...');
        const startTime = Date.now();

        const result = await service.detectShelfItemsFromImage(base64Image, shelfType);

        const duration = (Date.now() - startTime) / 1000;
        logger.info(`\nCompleted in ${duration.toFixed(2)} seconds.`);

        if (result.items && result.items.length > 0) {
            logger.info(`\nFound ${result.items.length} items:`);
            logger.info(JSON.stringify(result.items, null, 2));
        } else {
            logger.info('\nNo items found.');
        }

    } catch (error) {
        logger.error('Test Failed:', error);
    }
}

testOtherShelfVision();
