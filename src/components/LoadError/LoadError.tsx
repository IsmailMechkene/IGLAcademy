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
        padding: 32,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        textAlign: 'center',
      }}
    >
      <AlertTriangle size={28} color="var(--warning)" />
      <div style={{ fontWeight: 650, fontSize: 14.5 }}>{message}</div>
      <button className="btn btn-ghost" onClick={onRetry}>
        <RefreshCw size={14} /> Try again
      </button>
    </div>
  );
}
