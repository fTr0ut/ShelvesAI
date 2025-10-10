import { fetchJson } from './client'

const buildVersionHeaders = (version) => {
  if (version === null || version === undefined) {
    throw new Error('Canvas mutations require a version header. Load the latest state before mutating.')
  }
  return { 'If-Match': String(version) }
}

export const fetchCanvasScreens = async () => {
  return fetchJson('/api/ui-editor/canvas/screens', { method: 'GET' })
}

export const createCanvasScreen = async (screen, version) => {
  const headers = buildVersionHeaders(version)
  return fetchJson('/api/ui-editor/canvas/screens', {
    method: 'POST',
    headers,
    body: JSON.stringify({ screen }),
  })
}

export const updateCanvasScreen = async (screenId, patch, version) => {
  const headers = buildVersionHeaders(version)
  return fetchJson(`/api/ui-editor/canvas/screens/${encodeURIComponent(screenId)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ screen: patch }),
  })
}

export const updateCanvasScreenNodes = async (screenId, nodes, version) => {
  const headers = buildVersionHeaders(version)
  return fetchJson(`/api/ui-editor/canvas/screens/${encodeURIComponent(screenId)}/nodes`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ nodes }),
  })
}

export const deleteCanvasScreen = async (screenId, version) => {
  const headers = buildVersionHeaders(version)
  return fetchJson(`/api/ui-editor/canvas/screens/${encodeURIComponent(screenId)}`, {
    method: 'DELETE',
    headers,
  })
}

export const fetchCanvasSettings = async () => {
  return fetchJson('/api/ui-editor/canvas/settings', { method: 'GET' })
}

export const updateCanvasSettings = async (patch, version) => {
  const headers = buildVersionHeaders(version)
  return fetchJson('/api/ui-editor/canvas/settings', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ settings: patch }),
  })
}
