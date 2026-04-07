function getProfilePhotoPickerOptions() {
  return {
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
  }
}

async function parseUploadResponse(response) {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch (_err) {
    return { raw: text }
  }
}

async function uploadProfilePhotoWithDeps({
  apiBase,
  token,
  asset,
  fetchImpl,
  getValidTokenImpl,
  prepareProfilePhotoAssetImpl,
} = {}) {
  if (!apiBase) {
    throw new Error('Missing apiBase')
  }
  if (!asset) {
    throw new Error('Invalid photo selection')
  }

  const prepared = await prepareProfilePhotoAssetImpl(asset, { forceSquare: true })
  if (!prepared) {
    throw new Error('Invalid photo selection')
  }

  const authToken = await getValidTokenImpl(token)
  if (!authToken) {
    throw new Error('Session expired. Please sign in again.')
  }

  const formData = new FormData()
  formData.append('photo', prepared)

  const response = await fetchImpl(`${apiBase}/api/profile/photo`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'ngrok-skip-browser-warning': 'true',
    },
    body: formData,
  })

  const data = await parseUploadResponse(response)
  if (!response.ok) {
    throw new Error(data?.error || 'Upload failed')
  }

  return data
}

module.exports = {
  getProfilePhotoPickerOptions,
  uploadProfilePhotoWithDeps,
}
