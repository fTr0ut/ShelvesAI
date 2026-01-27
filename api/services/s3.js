/**
 * AWS S3 Service Module
 * Handles file uploads, deletions, and URL generation for S3 storage
 */

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Lazy-initialize client to allow graceful fallback when credentials missing
let client = null;

function getClient() {
  if (client) return client;

  const region = process.env.AWS_REGION || 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  client = new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return client;
}

/**
 * Check if S3 is configured and available
 */
function isEnabled() {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.S3_BUCKET_NAME
  );
}

/**
 * Upload a buffer to S3
 * @param {Buffer} buffer - The file buffer to upload
 * @param {string} key - The S3 object key (path within bucket)
 * @param {string} contentType - MIME type of the file
 * @returns {Promise<string>} The S3 key of the uploaded object
 */
async function uploadBuffer(buffer, key, contentType) {
  const s3Client = getClient();
  if (!s3Client) {
    throw new Error('S3 is not configured. Missing AWS credentials.');
  }

  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    throw new Error('S3_BUCKET_NAME environment variable is not set.');
  }

  // Normalize key to use forward slashes (S3 standard)
  const normalizedKey = key.replace(/\\/g, '/');

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: normalizedKey,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );

  return normalizedKey;
}

/**
 * Get the public URL for an S3 object
 * @param {string} key - The S3 object key
 * @returns {string} The public URL
 */
function getPublicUrl(key) {
  const publicUrl = process.env.S3_PUBLIC_URL;
  const bucket = process.env.S3_BUCKET_NAME;
  const region = process.env.AWS_REGION || 'us-east-1';

  // Normalize key to use forward slashes
  const normalizedKey = (key || '').replace(/\\/g, '/');

  if (publicUrl) {
    // Use configured public URL (could be CloudFront CDN or custom domain)
    const baseUrl = publicUrl.endsWith('/') ? publicUrl.slice(0, -1) : publicUrl;
    return `${baseUrl}/${normalizedKey}`;
  }

  if (bucket) {
    // Fall back to standard S3 URL
    return `https://${bucket}.s3.${region}.amazonaws.com/${normalizedKey}`;
  }

  // No S3 configured, return key as-is (for local fallback)
  return normalizedKey;
}

/**
 * Delete an object from S3
 * @param {string} key - The S3 object key to delete
 */
async function deleteObject(key) {
  const s3Client = getClient();
  if (!s3Client) {
    console.warn('[s3] Cannot delete object - S3 not configured');
    return;
  }

  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    console.warn('[s3] Cannot delete object - S3_BUCKET_NAME not set');
    return;
  }

  // Normalize key to use forward slashes
  const normalizedKey = key.replace(/\\/g, '/');

  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: normalizedKey,
      })
    );
  } catch (err) {
    console.warn('[s3] Failed to delete object:', normalizedKey, err.message);
  }
}

/**
 * Get the S3 bucket name from environment
 */
function getBucket() {
  return process.env.S3_BUCKET_NAME || null;
}

module.exports = {
  isEnabled,
  uploadBuffer,
  getPublicUrl,
  deleteObject,
  getBucket,
};
