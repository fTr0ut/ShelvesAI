const getNative = (name) => {
  if (typeof globalThis !== 'undefined' && typeof globalThis[name] === 'function') {
    return globalThis[name];
  }
  if (typeof window !== 'undefined' && typeof window[name] === 'function') {
    return window[name];
  }
  return null;
};

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

const NativeTextEncoder = getNative('TextEncoder');
const NativeTextDecoder = getNative('TextDecoder');

const TextEncoderImpl = NativeTextEncoder || SimpleTextEncoder;
const TextDecoderImpl = NativeTextDecoder || SimpleTextDecoder;

export { TextEncoderImpl as TextEncoder, TextDecoderImpl as TextDecoder };

export default {
  TextEncoder: TextEncoderImpl,
  TextDecoder: TextDecoderImpl,
};

