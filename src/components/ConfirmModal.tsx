import { useState } from 'react';

interface ConfirmModalProps {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  showDontAsk?: boolean;
  onConfirm: (dontAskAgain: boolean) => void;
  onCancel: () => void;
}

export function ConfirmModal({
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  showDontAsk = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [dontAsk, setDontAsk] = useState(false);

  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-modal-message">{message}</p>
        {showDontAsk && (
          <label className="confirm-modal-checkbox">
            <input
              type="checkbox"
              checked={dontAsk}
              onChange={(e) => setDontAsk(e.target.checked)}
            />
            Don't ask again
          </label>
        )}
        <div className="confirm-modal-actions">
          <button className="btn-modal btn-modal--cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className="btn-modal btn-modal--confirm"
            onClick={() => onConfirm(dontAsk)}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
