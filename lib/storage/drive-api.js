import { GoogleAuth } from 'google-auth-library';

const API = 'https://www.googleapis.com/drive/v3';
export const FOLDER = 'application/vnd.google-apps.folder';
export const FILE_FIELDS =
  'id,name,mimeType,size,modifiedTime,createdTime,parents,thumbnailLink,' +
  'videoMediaMetadata(durationMillis,width,height)';

let auth;

export function initDrive(keyFile) {
  auth = new GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
}

export const token = () => auth.getAccessToken(); // cached and refreshed by the library

export const mediaUrl = (id) => `${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;

export async function drive(pathAndQuery, init = {}) {
  return fetch(pathAndQuery.startsWith('http') ? pathAndQuery : `${API}${pathAndQuery}`, {
    ...init,
    headers: { Authorization: `Bearer ${await token()}`, ...init.headers },
  });
}

export async function driveJson(pathAndQuery) {
  const res = await drive(pathAndQuery);
  if (!res.ok) {
    const err = new Error(`Drive API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function listFolder(folderId) {
  const files = [];
  let pageToken;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      orderBy: 'folder,name_natural',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await driveJson(`/files?${params}`);
    files.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

export async function getFile(id) {
  const params = new URLSearchParams({ fields: FILE_FIELDS, supportsAllDrives: 'true' });
  return driveJson(`/files/${encodeURIComponent(id)}?${params}`);
}
