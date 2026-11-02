// Where the media lives. server.js and library.js only talk to a storage provider,
// never to Google Drive or the disk directly. Pick one with STORAGE in .env:
//
//   STORAGE=drive   Google Drive folders read with a service account (lib/storage/drive.js)
//   STORAGE=local   a folder on this server's disk (lib/storage/local.js)
//
// A provider is an object with:
//
//   name                       'drive' | 'local'
//   label                      shown in logs, e.g. 'Google Drive'
//   supportsUploads            true when the admin "Add to Google Drive" uploader makes sense
//   resolveRef(ref)            category reference from CATEGORIES (link, id or sub-folder) → folder id
//   defaultCategories()        categories to use when CATEGORIES is empty (may return [])
//   listFolder(id)             → entries shaped like Drive file resources:
//                                { id, name, mimeType, size, createdTime, videoMediaMetadata? }
//                                folders have mimeType FOLDER
//   open(id, { range, signal }) → { status, headers, body } where body is a Node Readable;
//                                honours a single "bytes=a-b" Range like Drive does
//   readFile(id)               → Buffer (subtitles)
//   thumbnail(id, size)        → { contentType, body } or null when the provider has none
//
// Ids must match [\w-]+ (they appear in URLs and signed links).

export const FOLDER = 'application/vnd.google-apps.folder';

export async function createStorage(env, opts = {}) {
  const kind = (env.STORAGE || 'drive').trim().toLowerCase();
  if (kind === 'drive') return (await import('./drive.js')).createDriveStorage(env, opts);
  if (kind === 'local') return (await import('./local.js')).createLocalStorage(env, opts);
  throw new Error(`Unknown STORAGE "${env.STORAGE}" (use "drive" or "local")`);
}
