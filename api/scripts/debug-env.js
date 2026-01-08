require('dotenv').config();
const fs = require('fs');
const path = require('path');

console.log('--- Environment Debug ---');
console.log('CWD:', process.cwd());
console.log('GOOGLE_GEN_AI_KEY set:', !!process.env.GOOGLE_GEN_AI_KEY);
if (process.env.GOOGLE_GEN_AI_KEY) {
    console.log('GOOGLE_GEN_AI_KEY length:', process.env.GOOGLE_GEN_AI_KEY.length);
}

console.log('GOOGLE_APPLICATION_CREDENTIALS set:', !!process.env.GOOGLE_APPLICATION_CREDENTIALS);
console.log('GOOGLE_APPLICATION_CREDENTIALS value:', process.env.GOOGLE_APPLICATION_CREDENTIALS);

if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credPath = path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS);
    console.log('Resolved Credentials Path:', credPath);
    console.log('Credentials File Exists:', fs.existsSync(credPath));
}
