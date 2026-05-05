// Minimal in-memory stand-ins for the bindings we use.
// Just enough surface area for our handlers; no need to pull in miniflare.

export class MemoryKV {
  private store = new Map<string, ArrayBuffer>();

  async get(
    key: string,
    type?: "arrayBuffer" | "text" | "json",
  ): Promise<ArrayBuffer | string | null> {
    const value = this.store.get(key);
    if (value === undefined) {
      return null;
    }
    if (type === "text") {
      return new TextDecoder().decode(value);
    }
    if (type === "json") {
      return JSON.parse(new TextDecoder().decode(value));
    }
    return value;
  }

  async put(key: string, value: ArrayBuffer | string): Promise<void> {
    if (typeof value === "string") {
      this.store.set(key, new TextEncoder().encode(value).buffer as ArrayBuffer);
    } else {
      this.store.set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  has(key: string) {
    return this.store.has(key);
  }
}

interface StoredR2Object {
  body: ArrayBuffer;
  httpMetadata?: { contentType?: string; cacheControl?: string };
}

export class MemoryR2 {
  private store = new Map<string, StoredR2Object>();

  async get(key: string): Promise<{
    body: ReadableStream<Uint8Array>;
    arrayBuffer: () => Promise<ArrayBuffer>;
    httpMetadata?: StoredR2Object["httpMetadata"];
  } | null> {
    const obj = this.store.get(key);
    if (!obj) {
      return null;
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(obj.body));
        controller.close();
      },
    });
    return {
      body,
      arrayBuffer: async () => obj.body,
      httpMetadata: obj.httpMetadata,
    };
  }

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: StoredR2Object["httpMetadata"] },
  ): Promise<void> {
    const buf =
      value instanceof Uint8Array
        ? (value.buffer.slice(
            value.byteOffset,
            value.byteOffset + value.byteLength,
          ) as ArrayBuffer)
        : value;
    this.store.set(key, { body: buf, httpMetadata: options?.httpMetadata });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  has(key: string) {
    return this.store.has(key);
  }
}
