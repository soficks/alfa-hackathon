import type { ReactNode } from 'react';

interface Props {
  label: string;
  error?: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}

export default function Field({ label, error, hint, wide, children }: Props) {
  return (
    <label className={`field${error ? ' field--invalid' : ''}${wide ? ' field--wide' : ''}`}>
      <span className="field__label">{label}</span>
      {children}
      {error ? (
        <small className="field__error" role="alert">
          {error}
        </small>
      ) : hint ? (
        <small className="field__hint">{hint}</small>
      ) : null}
    </label>
  );
}
