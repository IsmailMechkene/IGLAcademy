import type { LocateFileResult } from '../types';

/**
 * Turns a failed "locate file" outcome into something the user can act on.
 * The main process refuses files it could never serve (outside the course
 * folder, wrong kind) rather than storing an unusable path.
 */
export function locateFileMessage(result: LocateFileResult): string {
  switch (result.status) {
    case 'outside-course':
      return (
        `That file is outside the folder registered for "${result.courseTitle}", so IGLAcademy ` +
        'cannot play it.\n\nPick a file inside the course folder, or use "Relocate folder" if the ' +
        'whole course has moved.'
      );
    case 'wrong-type':
      return `That file type is not supported for this lesson. Expected one of: ${result.expected}.`;
    case 'error':
      return result.message;
    default:
      return 'The file could not be used.';
  }
}
