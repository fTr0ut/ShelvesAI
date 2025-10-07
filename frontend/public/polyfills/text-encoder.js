const globalRef = typeof globalThis !== 'undefined'
  ? globalThis
  : typeof window !== 'undefined'
    ? window
    : typeof self !== 'undefined'
      ? self
      : {};

const ensureGlobals = () => {
  const hasTextEncoder = typeof globalRef.TextEncoder === 'function';
  const hasTextDecoder = typeof globalRef.TextDecoder === 'function';

  if (!hasTextEncoder) {
    class SimpleTextEncoder {
      encode(input = '') {
        const normalized = String(input);
        const utf8 = unescape(encodeURIComponent(normalized));
        const result = new Uint8Array(utf8.length);
        for (let i = 0; i < utf8.length; i += 1) {
          result[i] = utf8.charCodeAt(i);
        }
        return result;
      }
    }
    globalRef.TextEncoder = SimpleTextEncoder;
  }

  if (!hasTextDecoder) {
    class SimpleTextDecoder {
      decode(input = new Uint8Array()) {
        const view = input instanceof Uint8Array ? input : new Uint8Array(input);
        let binary = '';
        for (let i = 0; i < view.length; i += 1) {
          binary += String.fromCharCode(view[i]);
        }
        return decodeURIComponent(escape(binary));
      }
    }
    globalRef.TextDecoder = SimpleTextDecoder;
  }
};

ensureGlobals();

if (typeof globalRef.util !== 'object' || !globalRef.util) {
  globalRef.util = {};
}

if (typeof globalRef.util.TextEncoder !== 'function') {
  globalRef.util.TextEncoder = globalRef.TextEncoder;
}

if (typeof globalRef.util.TextDecoder !== 'function') {
  globalRef.util.TextDecoder = globalRef.TextDecoder;
}
