let MlkitOcr;
try {
    MlkitOcr = require('react-native-mlkit-ocr').default;
} catch (e) {
    console.warn('react-native-mlkit-ocr not available (running in Expo Go?)', e);
}

/**
 * Extract text from image using on-device ML Kit
 * @param {string} imageUri - Local file URI
 * @returns {Promise<{text: string, lines: string[]}>}
 */
export async function extractTextFromImage(imageUri) {
    try {
        if (!MlkitOcr) {
            throw new Error("OCR not available in this environment");
        }
        const result = await MlkitOcr.detectFromUri(imageUri);
        // result is array of blocks: [{ text, lines, confidence, cornerPoints, boundingBox }]
        // Construct full text

        // Sort blocks by y position if needed, but usually they are returned in reading order.
        // We'll trust the order for now or just join them.

        // Each block has lines array as well.
        const text = result.map(block => block.text).join('\n');
        const lines = result.flatMap(block => block.lines ? block.lines.map(l => l.text) : block.text.split('\n'));

        return { text, lines };
    } catch (e) {
        console.error('OCR Extraction failed', e);
        return { text: '', lines: [] };
    }
}

/**
 * Parse OCR text into structured items
 * @param {string} text - Raw OCR text
 * @param {string} shelfType - Type of shelf (book, movie, etc.)
 * @returns {Array<{name: string, type: string}>}
 */
export function parseTextToItems(text, shelfType) {
    const lines = text.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 3);

    // Group lines that might be title + author
    const items = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Skip obviously non-title lines (prices, numbers)
        if (line.match(/^\d+$/) || line.match(/^[\$£€]/)) {
            i++;
            continue;
        }

        // Check if next line might be author
        const nextLine = lines[i + 1];
        // Heuristic: author is often shorter than title, or follows title.
        const mightBeAuthor = nextLine &&
            !nextLine.match(/^\d+$/) &&
            nextLine.length < line.length;

        if (mightBeAuthor && shelfType === 'book') {
            items.push({
                name: line,
                author: nextLine,
                type: shelfType,
            });
            i += 2;
        } else {
            items.push({
                name: line,
                type: shelfType,
            });
            i++;
            // If we see a very short line next, it might be noise, skip it?
        }
    }

    return items;
}
