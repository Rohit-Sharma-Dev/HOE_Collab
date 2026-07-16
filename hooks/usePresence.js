"use client";
import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * usePresence — tracks who's currently viewing/editing a document.
 *
 * Uses Supabase Realtime presence channels to broadcast user info
 * and receive updates about other connected users.
 *
 * @param {string} docId
 * @param {{ id: string, email: string, name?: string }} currentUser
 * @returns {{ presentUsers: Array, myColor: string }}
 */
export function usePresence(docId, currentUser) {
  const [presentUsers, setPresentUsers] = useState([]);
  const channelRef = useRef(null);
  const supabase = createClient();

  // Assign a stable color per user (deterministic from user ID)
  const COLORS = [
    "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b",
    "#10b981", "#3b82f6", "#f97316", "#14b8a6",
  ];
  const myColor = currentUser?.id
    ? COLORS[parseInt(currentUser.id.slice(-1), 16) % COLORS.length]
    : COLORS[0];

  useEffect(() => {
    if (!docId || !currentUser?.id) return;

    const channel = supabase.channel(`presence:${docId}`, {
      config: { presence: { key: currentUser.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const allUsers = Object.values(state)
          .flat()
          .filter((u) => u.userId !== currentUser.id);

        // Deduplicate users by userId
        const uniqueUsers = [];
        const seen = new Set();
        for (const u of allUsers) {
          if (!seen.has(u.userId)) {
            seen.add(u.userId);
            uniqueUsers.push(u);
          }
        }
        setPresentUsers(uniqueUsers);
      })
      .on("presence", { event: "join" }, ({ newPresences }) => {
        // handled by sync
      })
      .on("presence", { event: "leave" }, ({ leftPresences }) => {
        // handled by sync
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            userId: currentUser.id,
            email: currentUser.email,
            name: currentUser.name || currentUser.email?.split("@")[0],
            color: myColor,
            joinedAt: new Date().toISOString(),
          });
        }
      });

    channelRef.current = channel;

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, [docId, currentUser?.id]);

  return { presentUsers, myColor };
}
