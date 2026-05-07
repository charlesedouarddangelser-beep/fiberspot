import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export type ToastKind = "success" | "error" | "info";

interface ToastEntry {
  id: number;
  message: string;
  kind: ToastKind;
}

type ToastFn = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<ToastFn | null>(null);

const DEFAULT_DURATION_MS = 4000;
const ERROR_DURATION_MS = 6000;

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastFn>(
    (message, kind = "info") => {
      const id = ++nextId;
      setToasts((prev) => [...prev, { id, message, kind }]);
      const duration = kind === "error" ? ERROR_DURATION_MS : DEFAULT_DURATION_MS;
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-container" role="status" aria-live="polite">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`toast toast-${t.kind}`}
            onClick={() => dismiss(t.id)}
          >
            {t.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const t = useContext(ToastContext);
  if (!t) throw new Error("useToast must be used inside <ToastProvider>");
  return t;
}
