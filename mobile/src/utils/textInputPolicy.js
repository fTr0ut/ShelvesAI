const IOS_NON_AUTH_INPUT_PROPS = Object.freeze({
  autoCorrect: false,
  spellCheck: false,
  autoComplete: 'off',
  textContentType: 'none',
  importantForAutofill: 'no',
});

const AUTH_INPUT_BASE_PROPS = Object.freeze({
  autoCorrect: false,
  spellCheck: false,
  autoCapitalize: 'none',
});

const IOS_AUTH_TYPE_PROPS = Object.freeze({
  username: Object.freeze({
    textContentType: 'username',
    autoComplete: 'username',
  }),
  email: Object.freeze({
    textContentType: 'emailAddress',
    autoComplete: 'email',
  }),
  password: Object.freeze({
    textContentType: 'password',
    autoComplete: 'password',
  }),
  newPassword: Object.freeze({
    textContentType: 'newPassword',
    autoComplete: 'new-password',
  }),
});

function normalizePlatformOS(platformOS) {
  return String(platformOS || '').trim().toLowerCase();
}

function normalizeAuthInputType(inputType) {
  const normalized = String(inputType || '').trim();
  return normalized || 'username';
}

function cloneProps(props) {
  return { ...props };
}

function getNonAuthInputProps(platformOS) {
  if (normalizePlatformOS(platformOS) !== 'ios') {
    return {};
  }
  return cloneProps(IOS_NON_AUTH_INPUT_PROPS);
}

function getAuthInputProps(inputType, platformOS) {
  const normalizedType = normalizeAuthInputType(inputType);
  const iosTypeProps = IOS_AUTH_TYPE_PROPS[normalizedType] || IOS_AUTH_TYPE_PROPS.username;

  if (normalizePlatformOS(platformOS) === 'ios') {
    return {
      ...cloneProps(AUTH_INPUT_BASE_PROPS),
      ...cloneProps(iosTypeProps),
    };
  }

  return cloneProps(AUTH_INPUT_BASE_PROPS);
}

module.exports = {
  getNonAuthInputProps,
  getAuthInputProps,
};
