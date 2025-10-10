import { describe, it, expect } from '@jest/globals'

import {
  createCanvasStateFromNodes,
  createEmptyCanvasState,
  getCanvasNodeChildren,
  getCanvasNodeDisplayName,
  getCanvasNodeMeta,
  insertCanvasNode,
  reparentCanvasNode,
  selectCanvasNode,
  serialiseCanvasStateToNodes,
  updateCanvasNode,
} from '../canvasState.js'

describe('canvasState graph', () => {
  it('normalises nested nodes into a traversable state graph', () => {
    const state = createCanvasStateFromNodes([
      {
        id: 'root',
        type: 'frame',
        children: [
          {
            id: 'stack-1',
            type: 'stack',
            props: { title: 'Hero' },
          },
        ],
        slots: {
          main: [
            {
              id: 'cta-button',
              type: 'component',
              componentId: 'primary-button',
              props: { label: 'Start' },
            },
          ],
        },
      },
    ])

    expect(state.rootIds).toEqual(['root'])
    expect(state.nodes.root.childIds).toEqual(['stack-1'])
    expect(state.nodes.root.slotChildIds.main).toEqual(['cta-button'])
    expect(state.nodes['stack-1'].parentId).toBe('root')
    expect(state.nodes['cta-button'].parentSlot).toBe('main')
    expect(state.selectionId).toBe('cta-button')
  })

  it('updates node metadata immutably', () => {
    const state = createCanvasStateFromNodes([
      {
        id: 'root',
        type: 'frame',
        children: [
          {
            id: 'hero',
            type: 'component',
            componentId: 'hero-block',
            style: { color: '#fff' },
          },
        ],
      },
    ])

    const updated = updateCanvasNode(state, {
      id: 'hero',
      label: 'Hero block',
      styles: { color: '#60a5fa' },
    })

    expect(updated).not.toBe(state)
    expect(updated.nodes.hero.label).toBe('Hero block')
    expect(updated.nodes.hero.styles).toEqual({ color: '#60a5fa' })
    expect(updated.nodes.hero.style).toEqual({ color: '#60a5fa' })
    expect(updated.nodes.root.childIds).toEqual(['hero'])
  })

  it('inserts new nodes and focuses the selection when requested', () => {
    let state = createEmptyCanvasState()

    state = insertCanvasNode(state, { id: 'root', type: 'frame' }, { select: true })
    expect(state.rootIds).toEqual(['root'])
    expect(state.selectionId).toBe('root')

    state = insertCanvasNode(
      state,
      { id: 'child', type: 'component', componentId: 'card' },
      { parentId: 'root', select: true },
    )

    expect(state.nodes.root.childIds).toEqual(['child'])
    expect(state.nodes.child.parentId).toBe('root')
    expect(state.selectionId).toBe('child')
  })

  it('reparents nodes across the tree', () => {
    let state = createCanvasStateFromNodes([
      {
        id: 'root',
        type: 'frame',
        children: [
          { id: 'child', type: 'component', componentId: 'hero-block' },
        ],
      },
      { id: 'secondary', type: 'frame' },
    ])

    state = reparentCanvasNode(state, 'child', { parentId: 'secondary', select: false })
    expect(state.nodes.root.childIds).toEqual([])
    expect(state.nodes.secondary.childIds).toEqual(['child'])
    expect(state.nodes.child.parentId).toBe('secondary')

    state = reparentCanvasNode(state, 'child', { parentId: null })
    expect(state.nodes.child.parentId).toBeNull()
    expect(state.rootIds).toContain('child')
  })

  it('supports selecting and clearing the active node', () => {
    const state = createCanvasStateFromNodes([{ id: 'root', type: 'frame' }])
    const selected = selectCanvasNode(state, 'root')
    expect(selected.selectionId).toBe('root')

    const cleared = selectCanvasNode(selected, 'unknown')
    expect(cleared.selectionId).toBeNull()
  })

  it('derives display helpers from node data', () => {
    const state = createCanvasStateFromNodes([
      {
        id: 'root',
        type: 'frame',
        children: [
          {
            id: 'hero',
            type: 'component',
            componentId: 'hero-block',
            props: { title: 'Welcome' },
          },
        ],
      },
    ])

    const child = state.nodes.hero
    expect(getCanvasNodeDisplayName(child)).toBe('Welcome')
    expect(getCanvasNodeMeta(child)).toContain('hero-block')
    expect(getCanvasNodeChildren(state, 'root')).toHaveLength(1)
  })

  it('serialises state back into a node tree preserving structure', () => {
    const state = createCanvasStateFromNodes([
      {
        id: 'root',
        type: 'frame',
        label: 'Root frame',
        children: [
          {
            id: 'hero',
            type: 'component',
            componentId: 'hero-block',
            props: { title: 'Welcome' },
            styles: { fontSize: '48px' },
          },
        ],
        slots: {
          sidebar: [
            {
              id: 'rail',
              type: 'component',
              componentId: 'rail-block',
              bindings: { mode: 'live' },
            },
          ],
        },
      },
    ])

    const serialised = serialiseCanvasStateToNodes(state)
    expect(serialised).toHaveLength(1)
    expect(serialised[0].id).toBe('root')
    expect(serialised[0].children).toHaveLength(1)
    expect(serialised[0].children[0]).toMatchObject({ id: 'hero', componentId: 'hero-block' })
    expect(serialised[0].slots.sidebar).toHaveLength(1)
    expect(serialised[0].slots.sidebar[0]).toMatchObject({ id: 'rail', bindings: { mode: 'live' } })
  })
})
