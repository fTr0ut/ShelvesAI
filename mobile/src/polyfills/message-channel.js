if (typeof global !== 'undefined' && typeof global.MessageChannel === 'undefined') {
  const queue = global.queueMicrotask || ((cb) => Promise.resolve().then(cb).catch((err) => setTimeout(() => { throw err }, 0)))

  class RNMessagePort {
    constructor(getPeer) {
      this._handler = null
      this._getPeer = getPeer
    }

    set onmessage(handler) {
      this._handler = typeof handler === 'function' ? handler : null
    }

    get onmessage() {
      return this._handler
    }

    postMessage(message) {
      const peer = this._getPeer()
      if (!peer) {
        return
      }
      const deliver = () => {
        if (peer._handler) {
          try {
            peer._handler({ data: message })
          } catch (err) {
            console.error('Unhandled error in MessageChannel handler', err)
          }
        }
      }
      queue(deliver)
    }
  }

  class RNMessageChannel {
    constructor() {
      let port1Reference
      let port2Reference
      this.port1 = new RNMessagePort(() => port2Reference)
      this.port2 = new RNMessagePort(() => port1Reference)
      port1Reference = this.port1
      port2Reference = this.port2
    }
  }

  global.MessageChannel = RNMessageChannel
}
