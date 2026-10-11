import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  message: string;
  onRetry: () => void;
}

/** Consistent loading-failure state: explanation plus a retry action. */
export default function LoadError({ message, onRetry }: Props) {
  return (
    <div
      className="card"
      role="alert"
      style={{
        padding: 28,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        textAlign: 'center',
      }}
    >
      <AlertTriangle size={24} color="var(--warning)" />
      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{message}</div>
      <button className="btn btn-ghost btn-sm" onClick={onRetry}>
        <RefreshCw size={13} /> Try again
      </button>
    </div>
  );
}
