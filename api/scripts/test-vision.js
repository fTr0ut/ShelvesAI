require('dotenv').config();
const fs = require('fs');
const { GoogleCloudVisionService } = require('../services/googleCloudVision');
const { GoogleGeminiService } = require('../services/googleGemini');

async function test() {
    const visionService = new GoogleCloudVisionService();
    const geminiService = new GoogleGeminiService();

    console.log('--- Configuration Check ---');
    console.log('Vision Service Configured:', visionService.isConfigured());
    console.log('Gemini Service Configured:', geminiService.isConfigured());

    // Test with a sample image (create or download a shelf image)
    const imagePath = process.argv[2];
    if (!imagePath) {
        console.log('\nUsage: node scripts/test-vision.js <image-path>');
        console.log('No image provided, skipping functional test.');
        return;
    }

    if (!fs.existsSync(imagePath)) {
        console.error('Image file not found:', imagePath);
        return;
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');

    // 1. Vision OCR
    if (visionService.isConfigured()) {
        console.log('\n--- Testing Vision OCR ---');
        try {
            const textResult = await visionService.extractText(base64);
            console.log('Extracted Text Preview:', textResult.text.substring(0, 100).replace(/\n/g, ' '));

            console.log('Detecting Shelf Items (Raw)...');
            const itemResult = await visionService.detectShelfItems(base64, 'book');
            console.log('Raw Items Found:', itemResult.items.length);
            console.log('Sample Raw Item:', itemResult.items[0]);

            // 2. Gemini Enrichment
            if (geminiService.isConfigured()) {
                console.log('\n--- Testing Gemini Enrichment ---');
                const enriched = await geminiService.enrichShelfItems(itemResult.items.slice(0, 5), 'book'); // Limit to 5 for test
                console.log('Enriched Items:', JSON.stringify(enriched, null, 2));
            } else {
                console.log('\n--- Gemini Not Configured (Skipping Enrichment) ---');
            }

        } catch (err) {
            console.error('Vision Test Failed:', err);
        }
    } else {
        console.log('\n--- Vision Not Configured (Skipping OCR) ---');
    }
}

test().catch(console.error);
