import { Component } from 'react'

const arrayShallowEqual = (a, b) => {
  if (a === b) {
    return true
  }

  const left = Array.isArray(a) ? a : []
  const right = Array.isArray(b) ? b : []

  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    if (!Object.is(left[index], right[index])) {
      return false
    }
  }

  return true
}

class LiveCanvasBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
    this.resetErrorBoundary = this.resetErrorBoundary.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    const { onError } = this.props
    if (typeof onError === 'function') {
      onError(error, info)
    }
  }

  componentDidUpdate(prevProps) {
    const { hasError } = this.state
    const { resetKeys = [] } = this.props

    if (hasError && !arrayShallowEqual(resetKeys, prevProps.resetKeys)) {
      this.resetErrorBoundary()
    }
  }

  resetErrorBoundary() {
    this.setState({ hasError: false, error: null })

    const { onReset } = this.props
    if (typeof onReset === 'function') {
      onReset()
    }
  }

  render() {
    const { hasError, error } = this.state
    const { children, fallback = null } = this.props

    if (hasError) {
      if (typeof fallback === 'function') {
        return fallback({ error, resetErrorBoundary: this.resetErrorBoundary })
      }
      return fallback || null
    }

    return children
  }
}

export default LiveCanvasBoundary
