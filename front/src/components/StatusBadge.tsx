import type { Application } from '../domain/types';
import { CLIENT_STATUS_LABEL, STATUS_TONE, employeeStatusLabel, type Tone } from '../domain/statusText';
import { useUserName } from '../store/data';

/** Пастельная плашка с точкой-индикатором. */
export function Badge({ tone, label, size = 'md' }: { tone: Tone | 'warn' | 'ok' | 'fail'; label: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`badge badge--${tone}${size !== 'md' ? ` badge--${size}` : ''}`}>
      <span className="badge__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function ClientStatusBadge({ app, size }: { app: Application; size?: 'sm' | 'md' | 'lg' }) {
  return <Badge tone={STATUS_TONE[app.status]} label={CLIENT_STATUS_LABEL[app.status]} size={size} />;
}

export function EmployeeStatusBadge({ app, size }: { app: Application; size?: 'sm' | 'md' | 'lg' }) {
  const nameOf = useUserName();
  return <Badge tone={STATUS_TONE[app.status]} label={employeeStatusLabel(app, nameOf)} size={size} />;
}

export default ClientStatusBadge;
