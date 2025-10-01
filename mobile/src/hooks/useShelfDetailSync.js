import React, { createContext, useContext, useMemo } from 'react'

const asyncNoop = async () => {}

const ShelfDetailSyncContext = createContext({
  shelfId: null,
  refreshItems: asyncNoop,
  onItemAdded: asyncNoop,
})

export function ShelfDetailSyncProvider({ value, children }) {
  const { shelfId = null, refreshItems = asyncNoop, onItemAdded = asyncNoop } = value || {}
  const contextValue = useMemo(
    () => ({ shelfId, refreshItems, onItemAdded }),
    [shelfId, refreshItems, onItemAdded],
  )

  return <ShelfDetailSyncContext.Provider value={contextValue}>{children}</ShelfDetailSyncContext.Provider>
}

export function useShelfDetailSync() {
  return useContext(ShelfDetailSyncContext)
}

