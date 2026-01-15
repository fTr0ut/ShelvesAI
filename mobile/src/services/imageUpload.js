import * as ImageManipulator from 'expo-image-manipulator';

const DEFAULT_MIME_TYPE = 'image/jpeg';
const JPEG_QUALITY = 0.85;
const MAX_PROFILE_DIMENSION = 1024;

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

export async function prepareProfilePhotoAsset(asset, { forceSquare = false } = {}) {
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

    const maxDimension = Math.max(targetWidth || 0, targetHeight || 0);
    if (maxDimension > MAX_PROFILE_DIMENSION) {
        const scale = MAX_PROFILE_DIMENSION / maxDimension;
        actions.push({
            resize: {
                width: Math.round((targetWidth || maxDimension) * scale),
                height: Math.round((targetHeight || maxDimension) * scale),
            },
        });
    }

    let uri = asset.uri;
    let mimeType = normalizeMimeType(asset.mimeType)
        || normalizeMimeType(asset.type)
        || inferMimeTypeFromUri(asset.uri);
    let name = asset.fileName || inferNameFromUri(asset.uri);

    try {
        const processed = await ImageManipulator.manipulateAsync(
            asset.uri,
            actions,
            { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG }
        );
        if (processed?.uri) {
            uri = processed.uri;
            mimeType = DEFAULT_MIME_TYPE;
            name = `profile-${Date.now()}.jpg`;
        }
    } catch (err) {
        // fall back to original asset details
    }

    return {
        uri,
        type: mimeType || DEFAULT_MIME_TYPE,
        name: name || `profile-${Date.now()}.jpg`,
    };
}
