import { statusLabel } from '../store/data';
import type { Application } from '../store/types';

/** Пастельная плашка статуса с точкой-индикатором. */
export default function StatusBadge({ app, size = 'md' }: { app: Pick<Application, 'status' | 'accepted'>; size?: 'md' | 'lg' }) {
  const tone = app.status === 'APPROVED' && app.accepted ? 'ISSUED' : app.status;
  return (
    <span className={`badge badge--${tone}${size === 'lg' ? ' badge--lg' : ''}`}>
      <span className="badge__dot" aria-hidden="true" />
      {statusLabel(app)}
    </span>
  );
}
