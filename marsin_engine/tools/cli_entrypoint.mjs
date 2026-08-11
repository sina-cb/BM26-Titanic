import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Return true when an ES module is the process entrypoint.
 *
 * Comparing a file URL to `file://${process.argv[1]}` is invalid on Windows:
 * drive letters, backslashes, spaces, and URL escaping make the strings
 * different. Resolve both sides as native filesystem paths instead.
 */
export function isMainModule(moduleUrl, argv1 = process.argv[1]) {
  if (typeof moduleUrl !== 'string' || moduleUrl.length === 0) {
    throw new TypeError('isMainModule: moduleUrl must be a non-empty string');
  }
  if (typeof argv1 !== 'string' || argv1.length === 0) {
    throw new TypeError('isMainModule: argv1 must be a non-empty string');
  }
  return path.resolve(fileURLToPath(moduleUrl)) === path.resolve(argv1);
}
