"use client";
import { useState, useCallback } from "react";

export const SYNC_STATUS = {
  OFFLINE: "offline",
  SYNCING: "syncing",
  SYNCED: "synced",
  ONLINE: "online",
};

/**
 * useSyncStatus — tracks sync provider status and pending update count.
 *
 * Returns:
 *  status      — current sync state string
 *  pendingCount — number of queued offline updates
 *  setStatus   — callback to update from the sync provider
 */
export function useSyncStatus() {
  const [status, setStatusState] = useState(SYNC_STATUS.OFFLINE);
  const [pendingCount, setPendingCount] = useState(0);

  const setStatus = useCallback((newStatus, pending = 0) => {
    setStatusState(newStatus);
    setPendingCount(pending);
  }, []);

  return { status, pendingCount, setStatus };
}
