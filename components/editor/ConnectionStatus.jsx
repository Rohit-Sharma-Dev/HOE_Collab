"use client";

import { SYNC_STATUS } from "@/hooks/useSyncStatus";

const STATUS_CONFIG = {
  [SYNC_STATUS.SYNCED]: {
    label: "Synced",
    className: "status-synced",
    dot: "bg-emerald-400",
    pulse: false,
  },
  [SYNC_STATUS.SYNCING]: {
    label: "Syncing…",
    className: "status-syncing",
    dot: "bg-amber-400",
    pulse: true,
  },
  [SYNC_STATUS.OFFLINE]: {
    label: "Offline",
    className: "status-offline",
    dot: "bg-red-400",
    pulse: false,
  },
  [SYNC_STATUS.ONLINE]: {
    label: "Online",
    className: "status-online",
    dot: "bg-indigo-400",
    pulse: false,
  },
};

export default function ConnectionStatus({ status, pendingCount }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG[SYNC_STATUS.OFFLINE];

  return (
    <div
      className={`status-pill ${config.className}`}
      aria-label={`Sync status: ${config.label}${pendingCount > 0 ? `, ${pendingCount} pending` : ""}`}
      role="status"
      aria-live="polite"
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${config.dot} ${config.pulse ? "animate-pulse" : ""}`}
        aria-hidden="true"
      />
      {config.label}
      {pendingCount > 0 && (
        <span className="ml-1 opacity-70">({pendingCount})</span>
      )}
    </div>
  );
}
