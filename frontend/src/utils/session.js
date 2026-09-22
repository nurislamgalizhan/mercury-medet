// The trusted-device token lets a staff member skip the WhatsApp code on this
// browser for 30 days. It is not a credential on its own — the password is still
// required, and the server drops the device whenever the password changes.
const TRUSTED_DEVICE_KEY = 'trustedDeviceToken';

export function getTrustedDeviceToken() {
  try {
    return localStorage.getItem(TRUSTED_DEVICE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function saveTrustedDeviceToken(token) {
  if (!token) return;
  try {
    localStorage.setItem(TRUSTED_DEVICE_KEY, token);
  } catch {
    /* private mode — the next login just asks for the code again */
  }
}

export function clearTrustedDeviceToken() {
  try {
    localStorage.removeItem(TRUSTED_DEVICE_KEY);
  } catch {
    /* nothing to do */
  }
}
