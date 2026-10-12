import { describe, expect, it } from 'vitest';
import { describeUpdateError } from '../electron/services/updateErrors';

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('describeUpdateError', () => {
  it('reports a missing release', () => {
    expect(describeUpdateError(coded('ERR_UPDATER_LATEST_VERSION_NOT_FOUND', 'Unable to find latest version on GitHub')))
      .toBe('No release has been published yet.');
    expect(describeUpdateError(coded('ERR_UPDATER_CHANNEL_FILE_NOT_FOUND', 'Cannot find channel "latest.yml" update info: HttpError: 404')))
      .toBe('No release has been published yet.');
    // what the packaged app gets from this repository while it has no releases
    expect(describeUpdateError(coded('ERR_XML_MISSED_ELEMENT', 'No published versions on GitHub')))
      .toBe('No release has been published yet.');
    // a release feed that fails to parse is a real failure
    expect(describeUpdateError(coded('ERR_UPDATER_INVALID_RELEASE_FEED', 'Cannot parse releases feed')))
      .toBe('The update check failed. Details are in the logs.');
  });

  it('reports being offline even when wrapped in a not-found error', () => {
    expect(describeUpdateError(coded('ERR_UPDATER_LATEST_VERSION_NOT_FOUND', 'Unable to find latest version: net::ERR_INTERNET_DISCONNECTED')))
      .toMatch(/internet connection/);
    expect(describeUpdateError(new Error('getaddrinfo ENOTFOUND github.com'))).toMatch(/internet connection/);
  });

  it('reports a damaged download and a wrong signature', () => {
    expect(describeUpdateError(new Error('sha512 checksum mismatch, expected abc, got def'))).toMatch(/damaged/);
    expect(describeUpdateError(new Error('New version 1.2.0 is not signed by the application owner: publisherNames: X'))).toMatch(/not signed/);
  });

  it('falls back to a generic message', () => {
    expect(describeUpdateError('boom')).toBe('The update check failed. Details are in the logs.');
  });
});
