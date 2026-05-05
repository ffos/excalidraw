export interface Env {
  SCENES: KVNamespace;
  FILES: R2Bucket;
  ROOMS: DurableObjectNamespace;
  ENVIRONMENT?: string;
}

export const SCENE_ID_BYTES = 10;
export const SCENE_MAX_BYTES = 4 * 1024 * 1024;
export const FILE_MAX_BYTES = 3 * 1024 * 1024;
export const FILE_CACHE_MAX_AGE_SEC = 31536000;
