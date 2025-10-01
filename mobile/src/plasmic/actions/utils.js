import React from 'react'

export function renderActionChildren(children, state) {
  if (typeof children === 'function') {
    return children(state)
  }

  if (React.isValidElement(children)) {
    const originalOnPress = children.props?.onPress
    const handlePress = async (...args) => {
      if (typeof originalOnPress === 'function') {
        const maybe = originalOnPress(...args)
        if (maybe && typeof maybe.then === 'function') {
          await maybe
        }
      }
      return state.run()
    }

    const mergedProps = {
      ...children.props,
      onPress: handlePress,
    }

    if ('disabled' in children.props) {
      mergedProps.disabled = Boolean(children.props.disabled) || state.status === 'loading'
    }

    return React.cloneElement(children, mergedProps)
  }

  return children ?? null
}

