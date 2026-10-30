"use client";
import { useRef, useState } from "react";
import { FileUp, X } from "lucide-react";

export function FilePicker({
  label,
  file,
  onChange,
  accept,
  disabled,
  hint,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
  disabled: boolean;
  hint: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  return (
    <div className="space-y-2">
      <label
        className="block rounded-xl border border-dashed border-white/25 p-4 cursor-pointer hover:border-acid/60"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? "none" : "copy";
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (disabled) return;
          const files = event.dataTransfer.files;
          if (files.length !== 1) {
            setError("Перетащите один файл целиком");
            return;
          }
          onChange(files[0]);
          setError("");
        }}
      >
        <span className="flex items-center gap-2 mb-3">
          <FileUp size={18} />
          {label}
        </span>
        <input
          ref={input}
          type="file"
          accept={accept}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => {
            onChange(event.target.files?.[0] || null);
            setError("");
          }}
        />
        <span className="block text-xs text-muted mt-3">{hint}</span>
      </label>
      {file && (
        <div className="flex items-center gap-2 text-sm text-acid">
          <span className="min-w-0 break-all flex-1">
            {file.name} · {(file.size / 1048576).toFixed(2)} MB
          </span>
          <button
            type="button"
            className="button-secondary !p-2"
            disabled={disabled}
            aria-label={`Убрать ${file.name}`}
            onClick={() => {
              onChange(null);
              if (input.current) input.current.value = "";
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
