import { readStoredFile } from './storage.js';
import { getReadableSource } from './pdf-processing.js';
import { downloadDay, watermarkDocument } from './download-watermark.js';
import type { Actor } from './domain/shared.js';

type File = {
  fileId: string;
  generation: number;
  storageKey: string;
  sha256: string;
  mediaType: 'application/pdf' | 'text/plain';
};
const cache = new Map<string, Buffer>();
const inFlight = new Map<string, Promise<Buffer>>();
const waiting: Array<() => void> = [];
const deletedFiles = new Set<string>();
let cacheBytes = 0,
  active = 0;
const maxBytes = 32 * 1024 * 1024;

export function evictDeliveredFile(fileId: string) {
  deletedFiles.add(fileId);
  for (const [key, bytes] of cache)
    if (key.startsWith(fileId + ':')) {
      cache.delete(key);
      cacheBytes -= bytes.length;
    }
}

export async function getDeliveryBytes(
  file: File,
  actor: Actor,
  options: { preview?: boolean; day?: string; cache?: boolean } = {}
) {
  const source =
    file.mediaType === 'application/pdf'
      ? await getReadableSource(file.fileId, file.generation, file.storageKey, file.sha256)
      : { storageKey: file.storageKey, sha256: file.sha256 };
  if (options.preview && actor.isAdmin) return readStoredFile(source.storageKey);
  const identifier = actor.email.split('@')[0];
  const day = options.day ?? downloadDay();
  const key = `${file.fileId}:${source.sha256}:${identifier}:${day}`;
  if (options.cache !== false && cache.has(key)) {
    const bytes = cache.get(key)!;
    cache.delete(key);
    cache.set(key, bytes);
    return bytes;
  }
  if (inFlight.has(key)) return inFlight.get(key)!;
  const work = (async () => {
    if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      const bytes = await watermarkDocument(
        await readStoredFile(source.storageKey),
        file.mediaType,
        identifier,
        day
      );
      if (options.cache !== false && !deletedFiles.has(file.fileId) && bytes.length <= maxBytes) {
        while (cacheBytes + bytes.length > maxBytes) {
          const oldest = cache.keys().next().value!;
          cacheBytes -= cache.get(oldest)!.length;
          cache.delete(oldest);
        }
        cache.set(key, bytes);
        cacheBytes += bytes.length;
      }
      return bytes;
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  })();
  inFlight.set(key, work);
  try {
    return await work;
  } finally {
    inFlight.delete(key);
  }
}
