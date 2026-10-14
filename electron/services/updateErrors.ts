// Kept apart from updateService so it can be tested without Electron.

/** Turns an updater failure into a sentence for the Settings page. */
export function describeUpdateError(err: unknown): string {
  const text = err instanceof Error ? `${(err as { code?: string }).code ?? ''} ${err.message}` : String(err);
  // Network first: "release not found" errors wrap the underlying network
  // failure when the machine is offline.
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION|ERR_ADDRESS_UNREACHABLE/i.test(text)) {
    return 'Could not reach the update server. Check your internet connection.';
  }
  // GitHub with no releases at all: "No published versions on GitHub"
  // (ERR_XML_MISSED_ELEMENT, from the empty release feed).
  if (/ERR_UPDATER_LATEST_VERSION_NOT_FOUND|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|ERR_UPDATER_NO_PUBLISHED_VERSIONS|No published versions/.test(text)) {
    return 'No release has been published yet.';
  }
  if (/sha512 checksum mismatch|ERR_CHECKSUM/i.test(text)) {
    return 'The downloaded update was damaged. It will be downloaded again on the next check.';
  }
  if (/not signed by the application owner/i.test(text)) {
    return 'The downloaded update is not signed by IGLAcademy, so it was not installed.';
  }
  return 'The update check failed. Details are in the logs.';
}
