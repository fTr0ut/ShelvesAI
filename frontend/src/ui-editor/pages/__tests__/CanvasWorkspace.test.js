/** @jest-environment jsdom */

const path = require('path')
const { Module } = require('module')
const esbuild = require('esbuild')
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = require('react-dom/test-utils')
const { beforeEach, afterEach, describe, expect, it, jest } = require('@jest/globals')

const bundleCache = new Map()

const resolvePath = (...segments) => path.resolve(__dirname, '..', ...segments)

jest.mock('../api/canvas', () => {
  return {
    fetchCanvasScreens: jest.fn(),
    fetchCanvasSettings: jest.fn(),
    createCanvasScreen: jest.fn(),
    deleteCanvasScreen: jest.fn(),
    updateCanvasSettings: jest.fn(),
    updateCanvasScreenNodes: jest.fn(),
  }
})

jest.mock('../api/routes', () => ({ publishUiBundle: jest.fn(async () => ({})) }))
jest.mock('../api/client', () => ({
  fetchJson: jest.fn(async () => ({})),
  getApiOrigin: () => 'http://localhost:5001',
  getDefaultApiOrigin: () => 'http://localhost:5001',
  resolveApiUrl: (value) => value,
}))

jest.mock('../components/ComponentLibraryPanel', () => () => null)
jest.mock('../components/CanvasScreenSelector', () => () => null)
const mockPropertiesPanel = jest.fn((props) => {
  mockPropertiesPanel.latestProps = props
  return null
})
jest.mock('../components/PropertiesPanel', () => mockPropertiesPanel)
jest.mock('../lib/useProjectSettings', () => ({
  useProjectSettings: () => ({ version: 1, apiBase: '' }),
}))

const canvasApi = require('../api/canvas')

const loadCanvasWorkspace = async () => {
  if (!bundleCache.has('CanvasWorkspace')) {
    const result = await esbuild.build({
      entryPoints: [resolvePath('CanvasWorkspace.jsx')],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      write: false,
      external: [
        '../api/canvas',
        '../api/routes',
        '../api/client',
        '../components/ComponentLibraryPanel',
        '../components/CanvasScreenSelector',
        '../components/PropertiesPanel',
        '../lib/useProjectSettings',
      ],
      loader: {
        '.css': 'text',
      },
    })
    bundleCache.set('CanvasWorkspace', result.outputFiles[0].text)
  }

  const code = bundleCache.get('CanvasWorkspace')
  const filename = resolvePath('__compiled__/CanvasWorkspace.test.js')
  const moduleInstance = new Module(filename, module.parent)
  moduleInstance.filename = filename
  moduleInstance.paths = Module._nodeModulePaths(path.dirname(filename))
  moduleInstance._compile(code, filename)
  return moduleInstance.exports.default || moduleInstance.exports
}

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

const mountedRoots = new Set()

const renderCanvasWorkspace = async () => {
  const CanvasWorkspace = await loadCanvasWorkspace()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.add({ root, container })
  await act(async () => {
    root.render(React.createElement(CanvasWorkspace))
    await flushPromises()
  })
  return { container, root }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPropertiesPanel.latestProps = null
  document.body.innerHTML = ''
})

afterEach(() => {
  for (const entry of mountedRoots) {
    act(() => {
      entry.root.unmount()
    })
    if (entry.container.parentNode) {
      entry.container.parentNode.removeChild(entry.container)
    }
    mountedRoots.delete(entry)
  }
})

describe('CanvasWorkspace React flows', () => {
  it('loads initial screens and settings from the API', async () => {
    canvasApi.fetchCanvasScreens.mockResolvedValue({
      screens: [
        { id: 'home-desktop', name: 'Homepage', device: 'Desktop', description: 'Hero', createdAt: '', updatedAt: '' },
      ],
      version: 1,
      updatedAt: '2024-01-01T00:00:00.000Z',
    })
    canvasApi.fetchCanvasSettings.mockResolvedValue({
      settings: {
        themeTokens: { colorScheme: 'light', accentColor: '#60a5fa', background: 'soft-gradient' },
        workspace: { headerStyle: 'centered-logo', footerStyle: 'minimal', showAnnouncement: true },
        pageStyles: { fontSize: 16 },
      },
      version: 2,
      updatedAt: '2024-01-01T00:00:00.000Z',
    })
    canvasApi.createCanvasScreen.mockResolvedValue({
      screen: { id: 'home-desktop', name: 'Homepage', device: 'Desktop' },
      screens: [{ id: 'home-desktop', name: 'Homepage', device: 'Desktop' }],
      version: 1,
    })
    canvasApi.updateCanvasSettings.mockResolvedValue({
      settings: {
        themeTokens: { colorScheme: 'light', accentColor: '#60a5fa', background: 'soft-gradient' },
        workspace: { headerStyle: 'centered-logo', footerStyle: 'minimal', showAnnouncement: true },
        pageStyles: { fontSize: 16 },
      },
      version: 3,
    })

    await renderCanvasWorkspace()
    await act(async () => {
      await flushPromises()
    })

    const header = document.querySelector('.canvas-workspace__header-title strong')
    expect(header).toBeTruthy()
    expect(header.textContent).toBe('Homepage')
    expect(canvasApi.fetchCanvasScreens).toHaveBeenCalledTimes(1)
    expect(canvasApi.fetchCanvasSettings).toHaveBeenCalledTimes(1)
  })

  it('creates a screen via the API and updates the selection', async () => {
    canvasApi.fetchCanvasScreens.mockResolvedValue({
      screens: [{ id: 'initial', name: 'Initial', device: 'Desktop', description: 'Initial', createdAt: '', updatedAt: '' }],
      version: 1,
    })
    canvasApi.fetchCanvasSettings.mockResolvedValue({ settings: {}, version: 1 })
    canvasApi.updateCanvasSettings.mockResolvedValue({ settings: {}, version: 2 })
    canvasApi.createCanvasScreen.mockResolvedValue({
      screen: { id: 'checkout-desktop', name: 'Checkout', device: 'Desktop' },
      screens: [
        { id: 'initial', name: 'Initial', device: 'Desktop', description: 'Initial' },
        { id: 'checkout-desktop', name: 'Checkout', device: 'Desktop', description: 'Desktop layout' },
      ],
      version: 2,
    })

    await renderCanvasWorkspace()
    await act(async () => {
      await flushPromises()
    })

    const toggle = document.querySelector('.canvas-workspace__header-button')
    expect(toggle).toBeTruthy()
    toggle.click()

    const nameInput = document.querySelector('#new-screen-name')
    const deviceSelect = document.querySelector('#new-screen-device')
    const descriptionInput = document.querySelector('#new-screen-description')

    expect(nameInput).toBeTruthy()
    expect(deviceSelect).toBeTruthy()

    nameInput.value = 'Checkout'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    deviceSelect.value = 'Desktop'
    deviceSelect.dispatchEvent(new Event('change', { bubbles: true }))
    descriptionInput.value = 'Desktop layout'
    descriptionInput.dispatchEvent(new Event('input', { bubbles: true }))

    const form = document.querySelector('.canvas-workspace__create-screen')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await flushPromises()
    })

    expect(canvasApi.createCanvasScreen).toHaveBeenCalledTimes(1)
    const args = canvasApi.createCanvasScreen.mock.calls[0]
    expect(args[0]).toMatchObject({ name: 'Checkout', device: 'Desktop', description: 'Desktop layout' })
    expect(args[1]).toBe(1)

    const header = document.querySelector('.canvas-workspace__header-title strong')
    expect(header.textContent).toBe('Checkout')
  })

  it('surfaces concurrency conflicts when creating screens', async () => {
    canvasApi.fetchCanvasScreens.mockResolvedValue({
      screens: [{ id: 'initial', name: 'Initial', device: 'Desktop', description: 'Initial', createdAt: '', updatedAt: '' }],
      version: 1,
    })
    canvasApi.fetchCanvasSettings.mockResolvedValue({ settings: {}, version: 1 })
    canvasApi.updateCanvasSettings.mockResolvedValue({ settings: {}, version: 2 })
    canvasApi.createCanvasScreen.mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409 }))

    await renderCanvasWorkspace()
    await act(async () => {
      await flushPromises()
    })

    document.querySelector('.canvas-workspace__header-button').click()
    const nameInput = document.querySelector('#new-screen-name')
    nameInput.value = 'Dashboard'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))

    const form = document.querySelector('.canvas-workspace__create-screen')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await flushPromises()
    })

    const error = document.querySelector('.canvas-workspace__form-error')
    expect(error).toBeTruthy()
    expect(error.textContent).toMatch(/Reloading the latest data/i)
  })

  it('updates workspace settings through the API', async () => {
    canvasApi.fetchCanvasScreens.mockResolvedValue({
      screens: [{ id: 'initial', name: 'Initial', device: 'Desktop', description: 'Initial', createdAt: '', updatedAt: '' }],
      version: 4,
    })
    canvasApi.fetchCanvasSettings.mockResolvedValue({
      settings: {
        themeTokens: { colorScheme: 'light', accentColor: '#60a5fa', background: 'soft-gradient' },
        workspace: { headerStyle: 'centered-logo', footerStyle: 'minimal', showAnnouncement: true },
        pageStyles: { fontSize: 16 },
      },
      version: 7,
    })
    canvasApi.updateCanvasSettings.mockResolvedValue({
      settings: {
        themeTokens: { colorScheme: 'dark', accentColor: '#60a5fa', background: 'soft-gradient' },
        workspace: { headerStyle: 'centered-logo', footerStyle: 'minimal', showAnnouncement: true },
        pageStyles: { fontSize: 16 },
      },
      version: 8,
    })

    await renderCanvasWorkspace()
    await act(async () => {
      await flushPromises()
    })

    const select = document.querySelector('#canvas-theme-color-scheme')
    expect(select.value).toBe('light')
    select.value = 'dark'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    await act(async () => {
      await flushPromises()
    })

    expect(canvasApi.updateCanvasSettings).toHaveBeenCalledTimes(1)
    expect(canvasApi.updateCanvasSettings.mock.calls[0][0]).toEqual({ themeTokens: { colorScheme: 'dark' } })
    expect(canvasApi.updateCanvasSettings.mock.calls[0][1]).toBe(7)
  })

  it('autosaves canvas node changes with optimistic concurrency', async () => {
    jest.useFakeTimers()
    try {
      canvasApi.fetchCanvasScreens.mockResolvedValue({
        screens: [
          {
            id: 'home-desktop',
            name: 'Homepage',
            device: 'Desktop',
            description: 'Hero',
            nodes: [
              {
                id: 'root',
                type: 'frame',
                children: [
                  {
                    id: 'hero',
                    type: 'component',
                    componentId: 'hero-block',
                    label: 'Hero headline',
                  },
                ],
              },
            ],
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        version: 7,
        updatedAt: '2024-01-01T00:00:00.000Z',
      })
      canvasApi.fetchCanvasSettings.mockResolvedValue({ settings: {}, version: 3 })
      canvasApi.updateCanvasSettings.mockResolvedValue({ settings: {}, version: 4 })
      canvasApi.updateCanvasScreenNodes.mockResolvedValue({
        screen: {
          id: 'home-desktop',
          nodes: [
            {
              id: 'root',
              type: 'frame',
              children: [
                {
                  id: 'hero',
                  type: 'component',
                  componentId: 'hero-block',
                  label: 'Updated headline',
                },
              ],
            },
          ],
        },
        screens: [
          {
            id: 'home-desktop',
            name: 'Homepage',
            device: 'Desktop',
            description: 'Hero',
            nodes: [
              {
                id: 'root',
                type: 'frame',
                children: [
                  {
                    id: 'hero',
                    type: 'component',
                    componentId: 'hero-block',
                    label: 'Updated headline',
                  },
                ],
              },
            ],
          },
        ],
        version: 8,
        updatedAt: '2024-01-01T00:01:00.000Z',
      })

      await renderCanvasWorkspace()
      await act(async () => {
        jest.advanceTimersByTime(0)
        await flushPromises()
      })

      const props = mockPropertiesPanel.latestProps
      expect(props).toBeTruthy()

      act(() => {
        props.onComponentChange({
          id: 'hero',
          label: 'Updated headline',
          styles: { fontSize: '40px' },
        })
      })

      await act(async () => {
        jest.advanceTimersByTime(600)
        await flushPromises()
      })

      expect(canvasApi.updateCanvasScreenNodes).toHaveBeenCalledTimes(1)
      const [screenId, nodesPayload, version] = canvasApi.updateCanvasScreenNodes.mock.calls[0]
      expect(screenId).toBe('home-desktop')
      expect(version).toBe(7)
      expect(Array.isArray(nodesPayload)).toBe(true)
      expect(nodesPayload[0]).toMatchObject({
        id: 'root',
        children: [expect.objectContaining({ id: 'hero', label: 'Updated headline' })],
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('queues autosave requests until the previous save completes', async () => {
    jest.useFakeTimers()
    try {
      canvasApi.fetchCanvasScreens.mockResolvedValue({
        screens: [
          {
            id: 'home-desktop',
            name: 'Homepage',
            device: 'Desktop',
            description: 'Hero',
            nodes: [
              {
                id: 'root',
                type: 'frame',
                children: [
                  {
                    id: 'hero',
                    type: 'component',
                    componentId: 'hero-block',
                    label: 'Hero headline',
                  },
                ],
              },
            ],
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        version: 7,
        updatedAt: '2024-01-01T00:00:00.000Z',
      })
      canvasApi.fetchCanvasSettings.mockResolvedValue({ settings: {}, version: 3 })
      canvasApi.updateCanvasSettings.mockResolvedValue({ settings: {}, version: 4 })

      let resolveFirstSave
      const firstSaveResponse = {
        screen: {
          id: 'home-desktop',
          nodes: [
            {
              id: 'root',
              type: 'frame',
              children: [
                {
                  id: 'hero',
                  type: 'component',
                  componentId: 'hero-block',
                  label: 'Updated headline',
                },
              ],
            },
          ],
        },
        screens: [
          {
            id: 'home-desktop',
            name: 'Homepage',
            device: 'Desktop',
            description: 'Hero',
            nodes: [
              {
                id: 'root',
                type: 'frame',
                children: [
                  {
                    id: 'hero',
                    type: 'component',
                    componentId: 'hero-block',
                    label: 'Updated headline',
                  },
                ],
              },
            ],
          },
        ],
        version: 8,
        updatedAt: '2024-01-01T00:01:00.000Z',
      }
      const secondSaveResponse = {
        screen: {
          id: 'home-desktop',
          nodes: [
            {
              id: 'root',
              type: 'frame',
              children: [
                {
                  id: 'hero',
                  type: 'component',
                  componentId: 'hero-block',
                  label: 'Updated headline again',
                },
              ],
            },
          ],
        },
        screens: [
          {
            id: 'home-desktop',
            name: 'Homepage',
            device: 'Desktop',
            description: 'Hero',
            nodes: [
              {
                id: 'root',
                type: 'frame',
                children: [
                  {
                    id: 'hero',
                    type: 'component',
                    componentId: 'hero-block',
                    label: 'Updated headline again',
                  },
                ],
              },
            ],
          },
        ],
        version: 9,
        updatedAt: '2024-01-01T00:02:00.000Z',
      }

      canvasApi.updateCanvasScreenNodes.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstSave = resolve
          }),
      )
      canvasApi.updateCanvasScreenNodes.mockResolvedValueOnce(secondSaveResponse)

      await renderCanvasWorkspace()
      await act(async () => {
        jest.advanceTimersByTime(0)
        await flushPromises()
      })

      const props = mockPropertiesPanel.latestProps
      expect(props).toBeTruthy()

      act(() => {
        props.onComponentChange({
          id: 'hero',
          label: 'Updated headline',
          styles: { fontSize: '40px' },
        })
      })

      await act(async () => {
        jest.advanceTimersByTime(600)
        await flushPromises()
      })

      expect(typeof resolveFirstSave).toBe('function')
      expect(canvasApi.updateCanvasScreenNodes).toHaveBeenCalledTimes(1)

      act(() => {
        props.onComponentChange({
          id: 'hero',
          label: 'Updated headline again',
          styles: { fontSize: '42px' },
        })
      })

      await act(async () => {
        jest.advanceTimersByTime(600)
        await flushPromises()
      })

      expect(canvasApi.updateCanvasScreenNodes).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolveFirstSave(firstSaveResponse)
        await flushPromises()
      })

      await act(async () => {
        jest.advanceTimersByTime(200)
        await flushPromises()
      })

      expect(canvasApi.updateCanvasScreenNodes).toHaveBeenCalledTimes(2)
      const [, , nextVersion] = canvasApi.updateCanvasScreenNodes.mock.calls[1]
      expect(nextVersion).toBe(8)
    } finally {
      jest.useRealTimers()
    }
  })
})
