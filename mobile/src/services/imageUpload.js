import * as ImageManipulator from 'expo-image-manipulator';

const DEFAULT_MIME_TYPE = 'image/jpeg';
const JPEG_QUALITY = 0.85;
const MAX_PROFILE_DIMENSION = 1024;
const SUPPORTED_UPLOAD_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
]);

function normalizeMimeType(mimeType) {
    if (!mimeType) return null;
    const value = String(mimeType).toLowerCase();
    if (value === 'image') return null;
    if (value === 'image/jpg') return 'image/jpeg';
    if (value.startsWith('image/')) return value;
    return null;
}

function inferMimeTypeFromUri(uri) {
    if (!uri) return null;
    const clean = String(uri).split('?')[0];
    const parts = clean.split('.');
    if (parts.length < 2) return null;
    const ext = parts[parts.length - 1].toLowerCase();
    switch (ext) {
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg';
        case 'png':
            return 'image/png';
        case 'webp':
            return 'image/webp';
        case 'gif':
            return 'image/gif';
        case 'bmp':
            return 'image/bmp';
        case 'heic':
            return 'image/heic';
        case 'heif':
            return 'image/heif';
        case 'avif':
            return 'image/avif';
        default:
            return null;
    }
}

function inferNameFromUri(uri) {
    if (!uri) return '';
    const clean = String(uri).split('?')[0];
    const parts = clean.split('/');
    return parts[parts.length - 1] || '';
}

function getSquareCrop(width, height) {
    const size = Math.min(width, height);
    const originX = Math.floor((width - size) / 2);
    const originY = Math.floor((height - size) / 2);
    return { originX, originY, width: size, height: size };
}

export async function prepareImageUploadAsset(asset, {
    forceSquare = false,
    maxDimension = null,
    namePrefix = 'upload',
    compress = JPEG_QUALITY,
    alwaysTranscode = true,
} = {}) {
    if (!asset?.uri) return null;

    const width = Number.isFinite(asset.width) ? asset.width : null;
    const height = Number.isFinite(asset.height) ? asset.height : null;

    const actions = [];
    let targetWidth = width;
    let targetHeight = height;

    if (forceSquare && width && height) {
        const crop = getSquareCrop(width, height);
        actions.push({ crop });
        targetWidth = crop.width;
        targetHeight = crop.height;
    }

    const currentMaxDimension = Math.max(targetWidth || 0, targetHeight || 0);
    if (maxDimension && currentMaxDimension > maxDimension) {
        const scale = maxDimension / currentMaxDimension;
        actions.push({
            resize: {
                width: Math.round((targetWidth || currentMaxDimension) * scale),
                height: Math.round((targetHeight || currentMaxDimension) * scale),
            },
        });
    }

    let uri = asset.uri;
    let mimeType = normalizeMimeType(asset.mimeType)
        || normalizeMimeType(asset.type)
        || inferMimeTypeFromUri(asset.uri);
    let name = asset.fileName || inferNameFromUri(asset.uri);
    const shouldTranscodeToJpeg = alwaysTranscode || !SUPPORTED_UPLOAD_MIME_TYPES.has(mimeType);

    try {
        if (actions.length > 0 || shouldTranscodeToJpeg) {
            const processed = await ImageManipulator.manipulateAsync(
                asset.uri,
                actions,
                { compress, format: ImageManipulator.SaveFormat.JPEG }
            );
            if (processed?.uri) {
                uri = processed.uri;
                mimeType = DEFAULT_MIME_TYPE;
                name = `${namePrefix}-${Date.now()}.jpg`;
            }
        }
    } catch (err) {
        // fall back to original asset details
    }

    return {
        uri,
        type: mimeType || DEFAULT_MIME_TYPE,
        name: name || `${namePrefix}-${Date.now()}.jpg`,
    };
}

export async function prepareProfilePhotoAsset(asset, { forceSquare = false } = {}) {
    return prepareImageUploadAsset(asset, {
        forceSquare,
        maxDimension: MAX_PROFILE_DIMENSION,
        namePrefix: 'profile',
        alwaysTranscode: true,
    });
}
