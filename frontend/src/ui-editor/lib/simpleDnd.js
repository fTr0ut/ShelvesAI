import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

const DragDropContext = createContext(null)

export const HTML5Backend = Symbol('html5-backend')

const ensureContext = () => {
  const context = useContext(DragDropContext)
  if (!context) {
    throw new Error('useDrag and useDrop must be used within a DndProvider')
  }
  return context
}

export function DndProvider({ children }) {
  const [dragState, setDragState] = useState({ item: null, type: null })

  const beginDrag = useCallback((item, type) => {
    setDragState({ item, type })
  }, [])

  const endDrag = useCallback(() => {
    setDragState({ item: null, type: null })
  }, [])

  const value = useMemo(() => ({ dragState, beginDrag, endDrag }), [dragState, beginDrag, endDrag])

  return <DragDropContext.Provider value={value}>{children}</DragDropContext.Provider>
}

const normaliseSpec = (specOrFactory) => {
  if (typeof specOrFactory === 'function') {
    return specOrFactory()
  }
  return specOrFactory || {}
}

export function useDrag(specOrFactory) {
  const { beginDrag, endDrag } = ensureContext()
  const specRef = useRef(normaliseSpec(specOrFactory))
  specRef.current = normaliseSpec(specOrFactory)
  const [isDragging, setIsDragging] = useState(false)
  const itemRef = useRef(null)

  const monitor = useMemo(
    () => ({
      isDragging: () => isDragging,
      getItem: () => itemRef.current,
      getItemType: () => specRef.current.type,
    }),
    [isDragging],
  )

  const computeCollected = useCallback(() => {
    const spec = specRef.current
    if (typeof spec.collect === 'function') {
      return spec.collect(monitor)
    }
    return { isDragging }
  }, [monitor, isDragging])

  const [collected, setCollected] = useState(() => computeCollected())

  useEffect(() => {
    setCollected(computeCollected())
  }, [computeCollected])

  const handleDragStart = useCallback(
    (event) => {
      const spec = specRef.current
      if (typeof spec.canDrag === 'function' && spec.canDrag() === false) {
        event.preventDefault()
        return
      }

      const item = typeof spec.item === 'function' ? spec.item() : spec.item
      itemRef.current = item
      beginDrag(item, spec.type)
      setIsDragging(true)

      if (event.dataTransfer) {
        try {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('application/json', JSON.stringify({}))
        } catch (error) {
          // Ignore data transfer errors in non-browser environments
        }
      }

      setCollected(computeCollected())
    },
    [beginDrag, computeCollected],
  )

  const handleDragEnd = useCallback(() => {
    const spec = specRef.current
    const item = itemRef.current
    itemRef.current = null
    endDrag()
    setIsDragging(false)
    if (typeof spec.end === 'function') {
      spec.end(item, monitor)
    }
    setCollected(computeCollected())
  }, [endDrag, computeCollected, monitor])

  const ref = useRef(null)

  useEffect(() => {
    const node = ref.current
    if (!node) {
      return undefined
    }

    node.setAttribute('draggable', 'true')
    node.addEventListener('dragstart', handleDragStart)
    node.addEventListener('dragend', handleDragEnd)

    return () => {
      node.removeEventListener('dragstart', handleDragStart)
      node.removeEventListener('dragend', handleDragEnd)
    }
  }, [handleDragEnd, handleDragStart])

  const assignRef = useCallback((node) => {
    if (ref.current === node) {
      return
    }
    if (ref.current) {
      ref.current.removeEventListener('dragstart', handleDragStart)
      ref.current.removeEventListener('dragend', handleDragEnd)
    }
    ref.current = node
    if (node) {
      node.setAttribute('draggable', 'true')
      node.addEventListener('dragstart', handleDragStart)
      node.addEventListener('dragend', handleDragEnd)
    }
  }, [handleDragEnd, handleDragStart])

  return [collected, assignRef]
}

export function useDrop(specOrFactory) {
  const { dragState, endDrag } = ensureContext()
  const specRef = useRef(normaliseSpec(specOrFactory))
  specRef.current = normaliseSpec(specOrFactory)
  const [isOver, setIsOver] = useState(false)

  const getCanDrop = useCallback(() => {
    const spec = specRef.current
    if (!dragState.item) {
      return false
    }
    const accept = spec.accept
    if (accept && dragState.type) {
      const acceptList = Array.isArray(accept) ? accept : [accept]
      if (!acceptList.includes(dragState.type)) {
        return false
      }
    }
    if (typeof spec.canDrop === 'function') {
      return Boolean(spec.canDrop(dragState.item, dragState.type))
    }
    return true
  }, [dragState])

  useEffect(() => {
    if (!dragState.item) {
      setIsOver(false)
    }
  }, [dragState.item])

  const monitor = useMemo(
    () => ({
      isOver: () => isOver,
      canDrop: () => getCanDrop(),
      getItem: () => dragState.item,
      getItemType: () => dragState.type,
    }),
    [dragState.item, dragState.type, getCanDrop, isOver],
  )

  const computeCollected = useCallback(() => {
    const spec = specRef.current
    if (typeof spec.collect === 'function') {
      return spec.collect(monitor)
    }
    return { isOver, canDrop: getCanDrop(), item: dragState.item }
  }, [monitor, isOver, getCanDrop, dragState.item])

  const [collected, setCollected] = useState(() => computeCollected())

  useEffect(() => {
    setCollected(computeCollected())
  }, [computeCollected])

  const handleDragEnter = useCallback(
    (event) => {
      if (!getCanDrop()) {
        return
      }
      event.preventDefault()
      setIsOver(true)
    },
    [getCanDrop],
  )

  const handleDragOver = useCallback(
    (event) => {
      if (!getCanDrop()) {
        return
      }
      event.preventDefault()
      setIsOver(true)
      const spec = specRef.current
      if (typeof spec.hover === 'function') {
        spec.hover(dragState.item, monitor)
      }
    },
    [dragState.item, getCanDrop, monitor],
  )

  const handleDragLeave = useCallback(
    (event) => {
      if (!getCanDrop()) {
        return
      }
      if (event.currentTarget.contains(event.relatedTarget)) {
        return
      }
      setIsOver(false)
    },
    [getCanDrop],
  )

  const handleDrop = useCallback(
    (event) => {
      if (!getCanDrop()) {
        return
      }
      event.preventDefault()
      setIsOver(false)
      const spec = specRef.current
      if (typeof spec.drop === 'function') {
        spec.drop(dragState.item, monitor)
      }
      endDrag()
    },
    [dragState.item, endDrag, getCanDrop, monitor],
  )

  const ref = useRef(null)

  useEffect(() => {
    const node = ref.current
    if (!node) {
      return undefined
    }

    node.addEventListener('dragenter', handleDragEnter)
    node.addEventListener('dragover', handleDragOver)
    node.addEventListener('dragleave', handleDragLeave)
    node.addEventListener('drop', handleDrop)

    return () => {
      node.removeEventListener('dragenter', handleDragEnter)
      node.removeEventListener('dragover', handleDragOver)
      node.removeEventListener('dragleave', handleDragLeave)
      node.removeEventListener('drop', handleDrop)
    }
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop])

  const assignRef = useCallback((node) => {
    if (ref.current === node) {
      return
    }
    if (ref.current) {
      ref.current.removeEventListener('dragenter', handleDragEnter)
      ref.current.removeEventListener('dragover', handleDragOver)
      ref.current.removeEventListener('dragleave', handleDragLeave)
      ref.current.removeEventListener('drop', handleDrop)
    }
    ref.current = node
    if (node) {
      node.addEventListener('dragenter', handleDragEnter)
      node.addEventListener('dragover', handleDragOver)
      node.addEventListener('dragleave', handleDragLeave)
      node.addEventListener('drop', handleDrop)
    }
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop])

  return [collected, assignRef]
}

