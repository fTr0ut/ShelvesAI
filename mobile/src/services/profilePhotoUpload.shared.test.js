const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getProfilePhotoPickerOptions,
  uploadProfilePhotoWithDeps,
} = require('./profilePhotoUpload.shared');

test('getProfilePhotoPickerOptions disables native editing for consistent square prep', () => {
  const options = getProfilePhotoPickerOptions();

  assert.deepEqual(options, {
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
  });
});

test('uploadProfilePhotoWithDeps forces square profile photo prep on both platforms', async () => {
  let receivedPrepareOptions = null;

  await uploadProfilePhotoWithDeps({
    apiBase: 'https://example.test',
    token: 'token-1',
    asset: { uri: 'file:///avatar.heic' },
    prepareProfilePhotoAssetImpl: async (_asset, options) => {
      receivedPrepareOptions = options;
      return { uri: 'file:///prepared.jpg', type: 'image/jpeg', name: 'profile.jpg' };
    },
    getValidTokenImpl: async () => 'resolved-token',
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({ success: true }),
    }),
  });

  assert.deepEqual(receivedPrepareOptions, { forceSquare: true });
});

test('uploadProfilePhotoWithDeps posts multipart data with bearer auth', async () => {
  const calls = [];
  const result = await uploadProfilePhotoWithDeps({
    apiBase: 'https://example.test',
    token: 'token-1',
    asset: { uri: 'file:///avatar.jpg' },
    prepareProfilePhotoAssetImpl: async () => ({ uri: 'file:///prepared.jpg', type: 'image/jpeg', name: 'profile.jpg' }),
    getValidTokenImpl: async () => 'resolved-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        text: async () => JSON.stringify({ success: true, media: { id: 42 } }),
      };
    },
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.test/api/profile/photo');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer resolved-token');
  assert.ok(calls[0].options.body instanceof FormData);
});
