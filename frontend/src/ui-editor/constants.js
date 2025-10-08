export const UI_EDITOR_BASE_PATH = '/ui-editor'

export const uiEditorPath = (suffix = '') => {
  if (!suffix) {
    return UI_EDITOR_BASE_PATH
  }
  const normalized = suffix.startsWith('/') ? suffix : `/${suffix}`
  return `${UI_EDITOR_BASE_PATH}${normalized}`
}
