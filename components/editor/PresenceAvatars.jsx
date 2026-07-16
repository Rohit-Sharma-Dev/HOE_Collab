"use client";

export default function PresenceAvatars({ presentUsers, myColor }) {
  if (!presentUsers?.length) return null;

  const MAX_VISIBLE = 4;
  const visible = presentUsers.slice(0, MAX_VISIBLE);
  const overflow = presentUsers.length - MAX_VISIBLE;

  return (
    <div
      className="flex items-center"
      role="list"
      aria-label={`${presentUsers.length} user${presentUsers.length !== 1 ? "s" : ""} currently viewing`}
    >
      <span className="text-slate-500 text-xs mr-2 hidden sm:block">
        {presentUsers.length + 1} here
      </span>
      <div className="flex items-center">
        {visible.map((u, i) => (
          <div
            key={`${u.userId || ""}-${i}`}
            className="avatar"
            style={{ backgroundColor: u.color }}
            title={u.name || u.email}
            role="listitem"
            aria-label={`${u.name || u.email} is viewing`}
          >
            {(u.name || u.email || "?")[0].toUpperCase()}
          </div>
        ))}
        {overflow > 0 && (
          <div
            className="avatar bg-slate-700"
            style={{ backgroundColor: "#374151" }}
            aria-label={`${overflow} more users`}
          >
            +{overflow}
          </div>
        )}
        {/* Me indicator */}
        <div
          className="avatar ml-1"
          style={{ backgroundColor: myColor, border: "2px solid #6366f1" }}
          title="You"
          aria-label="You"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="white" aria-hidden="true">
            <circle cx="12" cy="8" r="4"/>
            <path d="M20 21a8 8 0 1 0-16 0"/>
          </svg>
        </div>
      </div>
    </div>
  );
}
