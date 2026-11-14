"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export function Modal({ title, onClose, children, foot, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal" + (wide ? " wide" : "")} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={16} stroke={2.5} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

/** Drag a file in, or click to choose. Handles several files one after another. */
export function DropZone({ icon, title, sub, accept, multiple, onFile }: {
  icon: string; title: string; sub: string; accept?: string; multiple?: boolean;
  onFile: (file: File) => Promise<void>;
}) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const handle = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const list = multiple ? [...files] : [files[0]];
    for (let i = 0; i < list.length; i++) {
      setBusy(list.length > 1 ? `Reading ${i + 1} of ${list.length}: ${list[i].name}` : `Reading ${list[i].name}…`);
      await onFile(list[i]);
    }
    setBusy(null);
    if (input.current) input.current.value = "";
  }, [multiple, onFile]);
  return (
    <div
      className={"drop" + (over ? " over" : "") + (busy ? " busy" : "")}
      onClick={() => !busy && input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) void handle(e.dataTransfer.files); }}
      role="button" tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && input.current?.click()}
    >
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => void handle(e.target.files)} />
      {busy ? (
        <div><span className="spinner" /> <b style={{ marginLeft: 8 }}>{busy}</b></div>
      ) : (
        <>
          <div className="drop-ico"><Icon name={icon} size={24} /></div>
          <div className="drop-title">{title}</div>
          <div className="small muted">{sub}</div>
        </>
      )}
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<{ text: string; kind: "good" | "bad" | "" } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, kind: "good" | "bad" | "" = "") => {
    setToast({ text, kind });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), kind === "bad" ? 7000 : 4000);
  }, []);
  const node = toast ? <div className={"toast " + toast.kind} role="status">{toast.text}</div> : null;
  return { show, node };
}
