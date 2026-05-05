import React from "react";
import { nanoid } from "nanoid";

import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { Card } from "@excalidraw/excalidraw/components/Card";
import { ExcalidrawLogo } from "@excalidraw/excalidraw/components/ExcalidrawLogo";
import { ToolButton } from "@excalidraw/excalidraw/components/ToolButton";
import { MIME_TYPES, getFrame } from "@excalidraw/common";
import {
  encryptData,
  generateEncryptionKey,
} from "@excalidraw/excalidraw/data/encryption";
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";
import { isInitializedImageElement } from "@excalidraw/element";
import { useI18n } from "@excalidraw/excalidraw/i18n";

import type {
  FileId,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";

import { FILE_UPLOAD_MAX_BYTES } from "../app_constants";
import { encodeFilesForUpload } from "../data/FileManager";

const EXCALIDRAW_PLUS_BUCKET =
  import.meta.env.VITE_APP_PLUS_EXPORT_BUCKET ||
  "excalidraw-room-persistence.appspot.com";

// Direct REST upload to Firebase Storage so we don't pull in the firebase SDK.
// See https://firebase.google.com/docs/reference/rest/storage
const uploadToPlusStorage = async (
  path: string,
  blob: Blob,
  customMetadata?: Record<string, string>,
) => {
  const url = `https://firebasestorage.googleapis.com/v0/b/${EXCALIDRAW_PLUS_BUCKET}/o?uploadType=media&name=${encodeURIComponent(
    path.replace(/^\//, ""),
  )}`;
  const headers: Record<string, string> = {
    "Content-Type": blob.type || "application/octet-stream",
  };
  if (customMetadata) {
    // Firebase encodes custom metadata as `x-goog-meta-*` request headers.
    for (const [k, v] of Object.entries(customMetadata)) {
      headers[`x-goog-meta-${k}`] = v;
    }
  }
  const res = await fetch(url, { method: "POST", headers, body: blob });
  if (!res.ok) {
    throw new Error(`Excalidraw+ upload failed: ${res.status}`);
  }
};

export const exportToExcalidrawPlus = async (
  elements: readonly NonDeletedExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
  name: string,
) => {
  const id = `${nanoid(12)}`;

  const encryptionKey = (await generateEncryptionKey())!;
  const encryptedData = await encryptData(
    encryptionKey,
    serializeAsJSON(elements, appState, files, "database"),
  );

  const blob = new Blob(
    [encryptedData.iv, new Uint8Array(encryptedData.encryptedBuffer)],
    {
      type: MIME_TYPES.binary,
    },
  );

  await uploadToPlusStorage(`/migrations/scenes/${id}`, blob, {
    data: JSON.stringify({ version: 2, name }),
    created: Date.now().toString(),
  });

  const filesMap = new Map<FileId, BinaryFileData>();
  for (const element of elements) {
    if (isInitializedImageElement(element) && files[element.fileId]) {
      filesMap.set(element.fileId, files[element.fileId]);
    }
  }

  if (filesMap.size) {
    const filesToUpload = await encodeFilesForUpload({
      files: filesMap,
      encryptionKey,
      maxBytes: FILE_UPLOAD_MAX_BYTES,
    });

    await Promise.all(
      filesToUpload.map(({ id: fileId, buffer }) =>
        uploadToPlusStorage(
          `/migrations/files/scenes/${id}/${fileId}`,
          new Blob([buffer.buffer as ArrayBuffer], { type: MIME_TYPES.binary }),
        ),
      ),
    );
  }

  window.open(
    `${
      import.meta.env.VITE_APP_PLUS_APP
    }/import?excalidraw=${id},${encryptionKey}`,
  );
};

export const ExportToExcalidrawPlus: React.FC<{
  elements: readonly NonDeletedExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
  name: string;
  onError: (error: Error) => void;
  onSuccess: () => void;
}> = ({ elements, appState, files, name, onError, onSuccess }) => {
  const { t } = useI18n();
  return (
    <Card color="primary">
      <div className="Card-icon">
        <ExcalidrawLogo
          style={{
            [`--color-logo-icon` as any]: "#fff",
            width: "2.8rem",
            height: "2.8rem",
          }}
        />
      </div>
      <h2>Excalidraw+</h2>
      <div className="Card-details">
        {t("exportDialog.excalidrawplus_description")}
      </div>
      <ToolButton
        className="Card-button"
        type="button"
        title={t("exportDialog.excalidrawplus_button")}
        aria-label={t("exportDialog.excalidrawplus_button")}
        showAriaLabel={true}
        onClick={async () => {
          try {
            trackEvent("export", "eplus", `ui (${getFrame()})`);
            await exportToExcalidrawPlus(elements, appState, files, name);
            onSuccess();
          } catch (error: any) {
            console.error(error);
            if (error.name !== "AbortError") {
              onError(new Error(t("exportDialog.excalidrawplus_exportError")));
            }
          }
        }}
      />
    </Card>
  );
};
