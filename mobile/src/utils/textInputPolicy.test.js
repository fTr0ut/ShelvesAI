const test = require('node:test');
const assert = require('node:assert/strict');
const { getAuthInputProps, getNonAuthInputProps } = require('./textInputPolicy');

test('getNonAuthInputProps disables iOS autofill and prediction', () => {
  const props = getNonAuthInputProps('ios');
  assert.equal(props.autoCorrect, false);
  assert.equal(props.spellCheck, false);
  assert.equal(props.autoComplete, 'off');
  assert.equal(props.textContentType, 'none');
  assert.equal(props.importantForAutofill, 'no');
});

test('getNonAuthInputProps is empty for non-iOS', () => {
  const props = getNonAuthInputProps('android');
  assert.deepEqual(props, {});
});

test('getAuthInputProps keeps iOS credential semantics for login', () => {
  const usernameProps = getAuthInputProps('username', 'ios');
  const passwordProps = getAuthInputProps('password', 'ios');
  assert.equal(usernameProps.textContentType, 'username');
  assert.equal(usernameProps.autoComplete, 'username');
  assert.equal(passwordProps.textContentType, 'password');
  assert.equal(passwordProps.autoComplete, 'password');
});

test('getAuthInputProps supports newPassword semantics', () => {
  const props = getAuthInputProps('newPassword', 'ios');
  assert.equal(props.textContentType, 'newPassword');
  assert.equal(props.autoComplete, 'new-password');
  assert.equal(props.autoCapitalize, 'none');
});
