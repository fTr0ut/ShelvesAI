export function hasMissingRequiredOnboardingFields(user) {
  if (!user) return true

  return !user.email || !user.firstName || !user.city || !user.state
}

export function isOnboardingRequiredForUser(user) {
  if (!user) return false

  return !user.onboardingCompleted || hasMissingRequiredOnboardingFields(user)
}
