import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  onFiles: (files: File[]) => void;
  children: React.ReactNode;
};

const MEDIA = /^(image|video|audio|font)\//;

/**
 * Whole-window drop target. Uses a counter rather than a boolean because dragenter and
 * dragleave both fire as the pointer crosses child elements.
 */
export function DropZone({ onFiles, children }: Props) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const reset = useCallback(() => {
    depth.current = 0;
    setOver(false);
  }, []);

  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      if (--depth.current <= 0) reset();
    };
    const over_ = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      reset();
      // Extension is not the test — a captured response is as likely to be `.txt`, a
      // log, or a file with no extension at all, and the parse is what decides whether
      // there is JSON in it. Media is the one thing filtered out, because reading a
      // video into a string to find out it is not JSON helps nobody.
      const files = [...e.dataTransfer.files].filter((f) => !MEDIA.test(f.type));
      if (files.length) onFiles(files);
    };

    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over_);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over_);
      window.removeEventListener("drop", drop);
    };
  }, [onFiles, reset]);

  return (
    <>
      {children}
      {over && (
        <div className="dropzone">
          <div className="dropzone-box">
            <div className="dropzone-title">Drop payloads</div>
            <div className="dropzone-sub">
              Any extension — the JSON is found inside. Same name replaces the payload
              and keeps its annotations.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
