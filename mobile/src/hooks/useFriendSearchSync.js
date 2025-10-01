import React, { createContext, useContext, useMemo } from 'react'

const noop = () => {}

const FriendSearchSyncContext = createContext({
  setBusyForUser: noop,
  handleRequestSuccess: noop,
  handleRespondSuccess: noop,
  handleMutationError: noop,
})

export function FriendSearchSyncProvider({ value, children }) {
  const {
    setBusyForUser = noop,
    handleRequestSuccess = noop,
    handleRespondSuccess = noop,
    handleMutationError = noop,
  } = value || {}

  const contextValue = useMemo(
    () => ({ setBusyForUser, handleRequestSuccess, handleRespondSuccess, handleMutationError }),
    [setBusyForUser, handleRequestSuccess, handleRespondSuccess, handleMutationError],
  )

  return <FriendSearchSyncContext.Provider value={contextValue}>{children}</FriendSearchSyncContext.Provider>
}

export function useFriendSearchSync() {
  return useContext(FriendSearchSyncContext)
}

