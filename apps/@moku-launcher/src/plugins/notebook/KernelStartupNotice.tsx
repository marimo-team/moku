import { useEffect, useState } from "react";

/** Startup feedback floats over the notebook without changing its layout. */
export function KernelStartupNotice({
  active,
  cancelling,
  message,
  cancel,
}: {
  active: boolean;
  cancelling: boolean;
  message?: string | null;
  cancel?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(timer);
  }, [active]);
  if (!active || !visible) return null;
  return (
    <div className="kernel-startup">
      <span className="kernel-spinner" aria-hidden="true" />
      <span role="status" title={message ?? undefined}>
        {cancelling ? "Cancelling startup…" : message || "Starting kernel…"}
      </span>
      {cancel && (
        <button
          onClick={cancel}
          disabled={cancelling}
          title="Cancel kernel startup for this notebook"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
