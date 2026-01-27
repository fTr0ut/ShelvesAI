#!/usr/bin/env node
/**
 * Test script for S3 connection and read/write capabilities
 *
 * Usage:
 *   node test-s3.js
 *
 * Tests:
 *   1. Configuration validation
 *   2. Upload a test file
 *   3. Verify file exists (HeadObject)
 *   4. Download and verify content
 *   5. Delete test file
 *   6. Verify deletion
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

// Test configuration
const TEST_KEY = `_test/s3-connection-test-${Date.now()}.txt`;
const TEST_CONTENT = `ShelvesAI S3 Test - ${new Date().toISOString()}\nRandom: ${crypto.randomBytes(16).toString('hex')}`;
const TEST_CONTENT_TYPE = 'text/plain';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  console.log(`\n${colors.cyan}[Step ${step}]${colors.reset} ${message}`);
}

function logSuccess(message) {
  console.log(`  ${colors.green}✓${colors.reset} ${message}`);
}

function logError(message) {
  console.log(`  ${colors.red}✗${colors.reset} ${message}`);
}

function logInfo(message) {
  console.log(`  ${colors.dim}${message}${colors.reset}`);
}

/**
 * Stream to string helper for GetObjectCommand
 */
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function main() {
  console.log('='.repeat(60));
  log('S3 Connection Test', 'cyan');
  console.log('='.repeat(60));

  const results = {
    config: false,
    upload: false,
    exists: false,
    download: false,
    delete: false,
    verifyDelete: false,
  };

  // Step 1: Configuration validation
  logStep(1, 'Validating S3 configuration...');

  const region = process.env.AWS_REGION || 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const bucket = process.env.S3_BUCKET_NAME;
  const publicUrl = process.env.S3_PUBLIC_URL;

  if (!accessKeyId) {
    logError('AWS_ACCESS_KEY_ID is not set');
    return printSummary(results);
  }
  logSuccess('AWS_ACCESS_KEY_ID is set');

  if (!secretAccessKey) {
    logError('AWS_SECRET_ACCESS_KEY is not set');
    return printSummary(results);
  }
  logSuccess('AWS_SECRET_ACCESS_KEY is set');

  if (!bucket) {
    logError('S3_BUCKET_NAME is not set');
    return printSummary(results);
  }
  logSuccess(`S3_BUCKET_NAME: ${bucket}`);

  logInfo(`AWS_REGION: ${region}`);
  logInfo(`S3_PUBLIC_URL: ${publicUrl || '(not set - will use default S3 URL)'}`);

  results.config = true;

  // Initialize S3 client
  const client = new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  // Step 2: Upload test file
  logStep(2, 'Uploading test file...');
  logInfo(`Key: ${TEST_KEY}`);
  logInfo(`Content length: ${TEST_CONTENT.length} bytes`);

  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: TEST_KEY,
      Body: TEST_CONTENT,
      ContentType: TEST_CONTENT_TYPE,
      CacheControl: 'no-cache',
    }));
    logSuccess('Upload successful');
    results.upload = true;
  } catch (err) {
    logError(`Upload failed: ${err.message}`);
    if (err.Code === 'AccessDenied' || err.name === 'AccessDenied') {
      logInfo('Check IAM permissions: s3:PutObject is required');
    }
    return printSummary(results);
  }

  // Step 3: Verify file exists (HeadObject)
  logStep(3, 'Verifying file exists (HeadObject)...');

  try {
    const headResponse = await client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: TEST_KEY,
    }));
    logSuccess('File exists in S3');
    logInfo(`Content-Type: ${headResponse.ContentType}`);
    logInfo(`Content-Length: ${headResponse.ContentLength} bytes`);
    logInfo(`ETag: ${headResponse.ETag}`);
    results.exists = true;
  } catch (err) {
    logError(`HeadObject failed: ${err.message}`);
    return printSummary(results);
  }

  // Step 4: Download and verify content
  logStep(4, 'Downloading and verifying content...');

  try {
    const getResponse = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: TEST_KEY,
    }));
    const downloadedContent = await streamToString(getResponse.Body);

    if (downloadedContent === TEST_CONTENT) {
      logSuccess('Content matches original');
      results.download = true;
    } else {
      logError('Content mismatch!');
      logInfo(`Expected: ${TEST_CONTENT.substring(0, 50)}...`);
      logInfo(`Got: ${downloadedContent.substring(0, 50)}...`);
    }
  } catch (err) {
    logError(`Download failed: ${err.message}`);
    if (err.Code === 'AccessDenied' || err.name === 'AccessDenied') {
      logInfo('Check IAM permissions: s3:GetObject is required');
    }
  }

  // Step 5: Delete test file
  logStep(5, 'Deleting test file...');

  try {
    await client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: TEST_KEY,
    }));
    logSuccess('Delete command successful');
    results.delete = true;
  } catch (err) {
    logError(`Delete failed: ${err.message}`);
    if (err.Code === 'AccessDenied' || err.name === 'AccessDenied') {
      logInfo('Check IAM permissions: s3:DeleteObject is required');
    }
  }

  // Step 6: Verify deletion
  logStep(6, 'Verifying deletion...');

  try {
    await client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: TEST_KEY,
    }));
    logError('File still exists after deletion!');
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      logSuccess('File successfully deleted (404 Not Found)');
      results.verifyDelete = true;
    } else {
      logError(`Unexpected error: ${err.message}`);
    }
  }

  // Print public URL info
  if (publicUrl) {
    logStep('Info', 'Public URL format');
    const exampleUrl = `${publicUrl.replace(/\/$/, '')}/${TEST_KEY}`;
    logInfo(`Files will be accessible at: ${exampleUrl.replace(TEST_KEY, '<key>')}`);
  }

  printSummary(results);
}

function printSummary(results) {
  console.log('\n' + '='.repeat(60));
  log('Test Summary', 'cyan');
  console.log('='.repeat(60));

  const tests = [
    ['Configuration', results.config],
    ['Upload (PutObject)', results.upload],
    ['Exists (HeadObject)', results.exists],
    ['Download (GetObject)', results.download],
    ['Delete (DeleteObject)', results.delete],
    ['Verify Deletion', results.verifyDelete],
  ];

  let passed = 0;
  let failed = 0;

  for (const [name, result] of tests) {
    if (result) {
      console.log(`  ${colors.green}✓${colors.reset} ${name}`);
      passed++;
    } else {
      console.log(`  ${colors.red}✗${colors.reset} ${name}`);
      failed++;
    }
  }

  console.log('');
  if (failed === 0) {
    log(`All ${passed} tests passed! S3 is ready for use.`, 'green');
  } else {
    log(`${passed} passed, ${failed} failed`, failed > 0 ? 'red' : 'green');
  }

  console.log('');

  // IAM policy reminder
  if (failed > 0) {
    console.log('Required IAM permissions:');
    console.log(colors.dim + `{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
      "s3:HeadObject"
    ],
    "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
  }]
}` + colors.reset);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
