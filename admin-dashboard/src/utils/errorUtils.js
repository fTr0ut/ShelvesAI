export function getErrorMessage(err, fallback = 'An unexpected error occurred') {
  return err.response?.data?.error || err.message || fallback;
}
