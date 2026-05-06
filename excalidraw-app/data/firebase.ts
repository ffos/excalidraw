/**
 * Self-hosted backend client.
 *
 * The original implementation talked to Firebase Firestore (collab scene
 * persistence) and Firebase Storage (image files). This module preserves the
 * same exported API but routes everything through the Cloudflare Worker:
 *
 *   - Scene persistence  → /api/room/{roomId}/scene  (Durable Object)
 *   - File storage       → /api/files/{prefix}/{id}  (R2)
 *
 * Filename + symbol names are kept so callers don't have to change.
 */
import { reconcileElements } from "@excalidraw/excalidraw";
import { MIME_TYPES, toBrandedType } from "@excalidraw/common";
import { decompressData } from "@excalidraw/excalidraw/data/encode";
import {
  encryptData,
  decryptData,
} from "@excalidraw/excalidraw/data/encryption";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { getSceneVersion } from "@excalidraw/element";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  ExcalidrawElement,
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFileMetadata,
  DataURL,
} from "@excalidraw/excalidraw/types";

import { FILE_CACHE_MAX_AGE_SEC } from "../app_constants";

import { getSyncableElements } from ".";

import type { SyncableExcalidrawElement } from ".";
import type Portal from "../collab/Portal";
import type { Socket } from "../collab/socket";

const FILES_API =
  import.meta.env.VITE_APP_FILES_API_URL || "/api/files";
const ROOMS_API =
  import.meta.env.VITE_APP_ROOMS_API_URL || "/api/room";

const toBase64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const fromBase64 = (b64: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
};

const stripLeadingSlash = (s: string): string =>
  s.startsWith("/") ? s.slice(1) : s;

// ---------------------------------------------------------------------------
// Scene persistence (replaces Firestore /scenes/{roomId})
// ---------------------------------------------------------------------------

interface StoredScene {
  sceneVersion: number;
  iv: string; // base64
  ciphertext: string; // base64
}

const encryptElements = async (
  key: string,
  elements: readonly ExcalidrawElement[],
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> => {
  const json = JSON.stringify(elements);
  const encoded = new TextEncoder().encode(json);
  const { encryptedBuffer, iv } = await encryptData(key, encoded);
  return { ciphertext: encryptedBuffer, iv };
};

const decryptStoredScene = async (
  scene: StoredScene,
  roomKey: string,
): Promise<readonly ExcalidrawElement[]> => {
  const ciphertext = fromBase64(scene.ciphertext);
  const iv = fromBase64(scene.iv);
  const decrypted = await decryptData(iv, ciphertext, roomKey);
  return JSON.parse(new TextDecoder("utf-8").decode(new Uint8Array(decrypted)));
};

const buildScene = async (
  elements: readonly SyncableExcalidrawElement[],
  roomKey: string,
): Promise<StoredScene> => {
  const sceneVersion = getSceneVersion(elements);
  const { ciphertext, iv } = await encryptElements(roomKey, elements);
  return {
    sceneVersion,
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
  };
};

class SceneVersionCache {
  private static cache = new WeakMap<Socket, number>();
  static get = (socket: Socket) => SceneVersionCache.cache.get(socket);
  static set = (socket: Socket, els: readonly SyncableExcalidrawElement[]) =>
    SceneVersionCache.cache.set(socket, getSceneVersion(els));
}

export const isSavedToFirebase = (
  portal: Portal,
  elements: readonly ExcalidrawElement[],
): boolean => {
  if (portal.socket && portal.roomId && portal.roomKey) {
    return SceneVersionCache.get(portal.socket) === getSceneVersion(elements);
  }
  return true;
};

const fetchScene = async (
  roomId: string,
): Promise<{ scene: StoredScene; etag: string } | null> => {
  const res = await fetch(`${ROOMS_API}/${roomId}/scene`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchScene: ${res.status}`);
  return {
    scene: (await res.json()) as StoredScene,
    etag: res.headers.get("ETag") || "",
  };
};

const putScene = async (
  roomId: string,
  scene: StoredScene,
  ifMatch: string | null,
): Promise<{ status: number; scene: StoredScene; etag: string }> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (ifMatch) headers["If-Match"] = ifMatch;
  const res = await fetch(`${ROOMS_API}/${roomId}/scene`, {
    method: "PUT",
    headers,
    body: JSON.stringify(scene),
  });
  // 200 → success, 412 → precondition failed (stale)
  return {
    status: res.status,
    scene: res.status === 200 || res.status === 412
      ? ((await res.json()) as StoredScene)
      : scene,
    etag: res.headers.get("ETag") || "",
  };
};

export const saveToFirebase = async (
  portal: Portal,
  elements: readonly SyncableExcalidrawElement[],
  appState: AppState,
) => {
  const { roomId, roomKey, socket } = portal;
  if (
    !roomId ||
    !roomKey ||
    !socket ||
    isSavedToFirebase(portal, elements)
  ) {
    return null;
  }

  // Optimistic-concurrency loop replacing Firestore's runTransaction.
  // Single-flight per DO so this normally completes in one round-trip; the
  // retry path covers the rare interleave with another writer.
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await fetchScene(roomId);
    let merged: readonly SyncableExcalidrawElement[];
    let etag: string | null;

    if (existing) {
      const prevElements = getSyncableElements(
        restoreElements(
          await decryptStoredScene(existing.scene, roomKey),
          null,
        ),
      );
      merged = getSyncableElements(
        reconcileElements(
          elements,
          prevElements as OrderedExcalidrawElement[] as RemoteExcalidrawElement[],
          appState,
        ),
      );
      etag = existing.etag;
    } else {
      merged = elements;
      etag = null;
    }

    const newDoc = await buildScene(merged, roomKey);
    const put = await putScene(roomId, newDoc, etag);
    if (put.status === 200) {
      const stored = getSyncableElements(
        restoreElements(await decryptStoredScene(newDoc, roomKey), null, {
          deleteInvisibleElements: true,
        }),
      );
      SceneVersionCache.set(socket, stored);
      return toBrandedType<RemoteExcalidrawElement[]>(stored);
    }
    if (put.status !== 412) {
      throw new Error(`saveScene failed: ${put.status}`);
    }
    // 412 — try again with the latest version.
  }

  throw new Error("saveScene: too many version conflicts");
};

export const loadFromFirebase = async (
  roomId: string,
  roomKey: string,
  socket: Socket | null,
): Promise<readonly SyncableExcalidrawElement[] | null> => {
  const existing = await fetchScene(roomId);
  if (!existing) return null;
  const elements = getSyncableElements(
    restoreElements(await decryptStoredScene(existing.scene, roomKey), null, {
      deleteInvisibleElements: true,
    }),
  );
  if (socket) {
    SceneVersionCache.set(socket, elements);
  }
  return elements;
};

// ---------------------------------------------------------------------------
// File storage (replaces Firebase Storage)
// ---------------------------------------------------------------------------

export const saveFilesToFirebase = async ({
  prefix,
  files,
}: {
  prefix: string;
  files: { id: FileId; buffer: Uint8Array }[];
}) => {
  const erroredFiles: FileId[] = [];
  const savedFiles: FileId[] = [];
  const cleanPrefix = stripLeadingSlash(prefix);

  await Promise.all(
    files.map(async ({ id, buffer }) => {
      try {
        const res = await fetch(`${FILES_API}/${cleanPrefix}/${id}`, {
          method: "PUT",
          headers: {
            "Content-Type": MIME_TYPES.binary,
            "Cache-Control": `public, max-age=${FILE_CACHE_MAX_AGE_SEC}`,
          },
          body: buffer as BodyInit,
        });
        if (res.ok) {
          savedFiles.push(id);
        } else {
          erroredFiles.push(id);
        }
      } catch {
        erroredFiles.push(id);
      }
    }),
  );

  return { savedFiles, erroredFiles };
};

export const loadFilesFromFirebase = async (
  prefix: string,
  decryptionKey: string,
  filesIds: readonly FileId[],
) => {
  const loadedFiles: BinaryFileData[] = [];
  const erroredFiles = new Map<FileId, true>();
  const cleanPrefix = stripLeadingSlash(prefix);

  await Promise.all(
    [...new Set(filesIds)].map(async (id) => {
      try {
        const response = await fetch(`${FILES_API}/${cleanPrefix}/${id}`);
        if (response.status < 400) {
          const arrayBuffer = await response.arrayBuffer();
          const { data, metadata } = await decompressData<BinaryFileMetadata>(
            new Uint8Array(arrayBuffer),
            { decryptionKey },
          );
          const dataURL = new TextDecoder().decode(data) as DataURL;
          loadedFiles.push({
            mimeType: metadata.mimeType || MIME_TYPES.binary,
            id,
            dataURL,
            created: metadata?.created || Date.now(),
            lastRetrieved: metadata?.created || Date.now(),
          });
        } else {
          erroredFiles.set(id, true);
        }
      } catch (error: any) {
        erroredFiles.set(id, true);
        console.error(error);
      }
    }),
  );

  return { loadedFiles, erroredFiles };
};
