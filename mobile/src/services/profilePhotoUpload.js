import * as ImagePicker from 'expo-image-picker'
import { getValidToken } from './api'
import { prepareProfilePhotoAsset } from './imageUpload'
const { getProfilePhotoPickerOptions, uploadProfilePhotoWithDeps } = require('./profilePhotoUpload.shared')

export async function pickProfilePhotoAsset({
  requestPermission = ImagePicker.requestMediaLibraryPermissionsAsync,
  launchPicker = ImagePicker.launchImageLibraryAsync,
} = {}) {
  const permission = await requestPermission()
  if (permission?.status !== 'granted') {
    return { status: 'permission_denied' }
  }

  const result = await launchPicker(getProfilePhotoPickerOptions())
  if (result?.canceled || !result?.assets?.[0]) {
    return { status: 'cancelled' }
  }

  return {
    status: 'selected',
    asset: result.assets[0],
  }
}

export async function uploadProfilePhoto({
  apiBase,
  token,
  asset,
  fetchImpl = fetch,
  getValidTokenImpl = getValidToken,
  prepareProfilePhotoAssetImpl = prepareProfilePhotoAsset,
} = {}) {
  return uploadProfilePhotoWithDeps({
    apiBase,
    token,
    asset,
    fetchImpl,
    getValidTokenImpl,
    prepareProfilePhotoAssetImpl,
  })
}
