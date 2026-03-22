require('dotenv').config();
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

logger.info('--- Environment Debug ---');
logger.info('CWD:', process.cwd());
logger.info('GOOGLE_GEN_AI_KEY set:', !!process.env.GOOGLE_GEN_AI_KEY);
if (process.env.GOOGLE_GEN_AI_KEY) {
    logger.info('GOOGLE_GEN_AI_KEY length:', process.env.GOOGLE_GEN_AI_KEY.length);
}
logger.info('GOOGLE_GEMINI_TEXT_MODEL:', process.env.GOOGLE_GEMINI_TEXT_MODEL);
logger.info('GOOGLE_GEMINI_VISION_MODEL:', process.env.GOOGLE_GEMINI_VISION_MODEL);

logger.info('GOOGLE_APPLICATION_CREDENTIALS set:', !!process.env.GOOGLE_APPLICATION_CREDENTIALS);
logger.info('GOOGLE_APPLICATION_CREDENTIALS value:', process.env.GOOGLE_APPLICATION_CREDENTIALS);

if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credPath = path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS);
    logger.info('Resolved Credentials Path:', credPath);
    logger.info('Credentials File Exists:', fs.existsSync(credPath));
}
