/**
 * OS file-manager drops into the Tauri/WebKit composer.
 *
 * Linux WebKitGTK (and some other webviews) often omit `dataTransfer.files`
 * and instead deliver `text/uri-list` / `text/plain` carrying `file://` URIs
 * or absolute paths. ProseMirror then inserts that path as chat text unless
 * `editorProps.handleDrop` claims the event.
 */

export type DroppedFilePayload = {
  files: File[];
  /** Absolute filesystem paths when the webview did not populate `File` objects. */
  paths: string[];
};

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Convert a `file://` URI or OS absolute path into a local path, or null. */
export function fileUriOrAbsolutePath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) return null;

  if (/^file:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "file:") return null;
      let path = decodeURIComponent(url.pathname);
      // `file:///C:/Users/...` → `C:/Users/...`
      if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
      return path;
    } catch {
      return null;
    }
  }

  // Unix absolute, Windows drive, Windows UNC.
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return trimmed;
  if (trimmed.startsWith("\\\\")) return trimmed;
  return null;
}

/** Parse `text/uri-list` or newline-separated plain text into local paths. */
export function extractPathsFromText(text: string): string[] {
  if (!text) return [];
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const paths: string[] = [];
  for (const line of lines) {
    const path = fileUriOrAbsolutePath(line);
    if (path) paths.push(path);
  }
  return unique(paths);
}

/**
 * True when the drag payload is an OS file drop (not in-app text/mention
 * drag). Used for overlay + preventDefault on dragover, where `getData` is
 * often empty until drop.
 */
export function isOsFileDrag(data: DataTransfer | null | undefined): boolean {
  if (!data) return false;
  const types = Array.from(data.types ?? []);
  return types.includes("Files") || types.includes("text/uri-list");
}

/**
 * Prefer real `File` objects when the webview populated them. Otherwise
 * recover absolute paths from URI-list / plain text so Linux drops still
 * attach instead of inserting a path string into the composer.
 */
export function extractDroppedFilePayload(
  data: DataTransfer | null | undefined,
): DroppedFilePayload {
  if (!data) return { files: [], paths: [] };
  const files = Array.from(data.files ?? []);
  if (files.length > 0) return { files, paths: [] };

  const uriList = safeGetData(data, "text/uri-list");
  const plain = safeGetData(data, "text/plain");
  return {
    files: [],
    paths: unique([
      ...extractPathsFromText(uriList),
      ...extractPathsFromText(plain),
    ]).filter(looksLikeFileName),
  };
}

export function basenameFromPath(path: string): string {
  const parts = path.split(/[/\\]/);
  const last = parts.at(-1)?.trim();
  return last && last.length > 0 ? last : "file";
}

/** Skip path-like chat text (`/usr/bin/env python`) that is not a dropped file. */
export function looksLikeFileName(path: string): boolean {
  const base = basenameFromPath(path);
  const dot = base.lastIndexOf(".");
  return dot > 0 && dot < base.length - 1;
}

function safeGetData(data: DataTransfer, type: string): string {
  try {
    return data.getData(type) ?? "";
  } catch {
    return "";
  }
}
