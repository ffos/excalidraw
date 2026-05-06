/**
 * Replaces the Firestore document at /scenes/{roomId}.
 *
 * Stored shape mirrors FirebaseStoredScene from the client:
 *   {
 *     sceneVersion: number,
 *     iv: string,            // base64 of Uint8Array
 *     ciphertext: string,    // base64 of Uint8Array
 *   }
 *
 * The DO is single-threaded per room, so plain get/put on storage gives us
 * the linearisability the original code relied on Firestore transactions for.
 *
 * Optimistic concurrency uses ETag = String(sceneVersion). Clients fetch the
 * scene, reconcile, and PUT with `If-Match`; on mismatch we return 412 with
 * the current document so they can retry.
 */

const SCENE_KEY = "scene";

export interface StoredScene {
  sceneVersion: number;
  iv: string;
  ciphertext: string;
}

export interface SceneStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
}

export const readScene = async (
  storage: SceneStorage,
): Promise<StoredScene | null> => {
  const v = await storage.get<StoredScene>(SCENE_KEY);
  return v ?? null;
};

export interface WriteResult {
  ok: boolean;
  status: number;
  scene?: StoredScene;
  etag?: string;
}

const etagOf = (scene: StoredScene): string => `"${scene.sceneVersion}"`;

const isValid = (v: unknown): v is StoredScene =>
  !!v &&
  typeof v === "object" &&
  typeof (v as StoredScene).sceneVersion === "number" &&
  typeof (v as StoredScene).iv === "string" &&
  typeof (v as StoredScene).ciphertext === "string";

export const writeScene = async (
  storage: SceneStorage,
  body: unknown,
  ifMatch: string | null,
): Promise<WriteResult> => {
  if (!isValid(body)) {
    return { ok: false, status: 400 };
  }

  const current = await storage.get<StoredScene>(SCENE_KEY);

  if (current) {
    if (ifMatch === null) {
      // No precondition supplied, but document exists — refuse blind overwrite.
      return { ok: false, status: 412, scene: current, etag: etagOf(current) };
    }
    if (ifMatch !== etagOf(current)) {
      return { ok: false, status: 412, scene: current, etag: etagOf(current) };
    }
  } else if (ifMatch !== null) {
    // Caller expected a previous version, but there's nothing here.
    return { ok: false, status: 412 };
  }

  await storage.put<StoredScene>(SCENE_KEY, body);
  return { ok: true, status: 200, scene: body, etag: etagOf(body) };
};
