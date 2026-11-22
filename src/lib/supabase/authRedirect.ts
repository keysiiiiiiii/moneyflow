export function getAuthRedirectOptions(location: Pick<Location, 'origin'> = window.location) {
  return {
    signup: { emailRedirectTo: location.origin },
    passwordReset: { redirectTo: location.origin },
  }
}
