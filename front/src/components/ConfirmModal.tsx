import type { ReactNode } from 'react';
import Modal from './Modal';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  pending?: boolean;
  danger?: boolean;
  disabled?: boolean;
  error?: string | null;
}

export default function ConfirmModal({ title, children, confirmLabel, onConfirm, onClose, pending, danger, disabled, error }: Props) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="confirm">{children}</div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal__actions">
        <button type="button" className="btn btn--outline" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm} disabled={pending || disabled}>
          {pending ? 'Сохраняем…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
