const fs = require('fs');
const path = require('path');

const logDir = path.resolve(__dirname, '..', '..', 'payload-logs');

function ensureLogDir() {
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
}

function safeStringify(value) {
    const seen = new WeakSet();
    return JSON.stringify(
        value,
        (key, val) => {
            if (typeof val === 'object' && val !== null) {
                if (seen.has(val)) return '[Circular]';
                seen.add(val);
            }
            if (typeof val === 'bigint') return val.toString();
            if (typeof val === 'function') {
                return `[Function ${val.name || 'anonymous'}]`;
            }
            return val;
        },
        2
    );
}

function sanitizeSegment(segment) {
    return String(segment || 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function timestampForFilename() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function logPayload({ source, operation, payload }) {
    try {
        ensureLogDir();
        const timestamp = timestampForFilename();
        const rand = Math.random().toString(36).slice(2, 8);
        const safeSource = sanitizeSegment(source);
        const safeOperation = sanitizeSegment(operation);
        const filename = `${timestamp}-${safeSource}-${safeOperation}-${rand}.json`;
        const filePath = path.join(logDir, filename);
        const content = {
            timestamp: new Date().toISOString(),
            source,
            operation,
            payload
        };
        fs.writeFileSync(filePath, safeStringify(content), 'utf8');
    } catch (err) {
        console.warn('[PayloadLogger] Failed to write payload:', err.message);
    }
}

module.exports = { logPayload };
