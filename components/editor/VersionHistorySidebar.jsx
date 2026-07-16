"use client";
import { useState, useCallback } from "react";

export default function VersionHistorySidebar({
  docId,
  versions,
  onRestore,
  isLoading,
  selectedVersionId,
  onSelectVersion,
}) {
  const [selectedA, setSelectedA] = useState(null);
  const [selectedB, setSelectedB] = useState(null);
  const [diffMode, setDiffMode] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const handleAiDiff = useCallback(async () => {
    if (!selectedA || !selectedB) return;
    setAiLoading(true);
    setAiSummary("");

    try {
      const res = await fetch("/api/ai/diff-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_id: docId,
          version_a_id: selectedA,
          version_b_id: selectedB,
        }),
      });

      if (!res.ok) {
        setAiSummary("Failed to generate summary. Check your AI API key.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const json = JSON.parse(line.slice(6));
              if (json.type === "text-delta") {
                text += json.textDelta;
                setAiSummary(text);
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      setAiSummary("Error: " + err.message);
    } finally {
      setAiLoading(false);
    }
  }, [selectedA, selectedB, docId]);

  return (
    <aside
      className="w-52 border-l border-stone flex flex-col bg-[#EDEEE8] h-full overflow-hidden select-none"
      role="complementary"
      aria-label="Revision Spine"
    >
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-stone flex-shrink-0">
        <h2 className="text-xs font-semibold text-ink/80 tracking-wider uppercase flex items-center gap-2">
          <ClockIcon />
          Revision Spine
        </h2>
      </div>

      {/* Diff mode toggle */}
      <div className="px-3 py-2.5 border-b border-stone flex-shrink-0 bg-[#E5E7DF]">
        <button
          id="diff-mode-toggle"
          onClick={() => {
            setDiffMode(!diffMode);
            setSelectedA(null);
            setSelectedB(null);
            setAiSummary("");
          }}
          className={`btn text-[11px] py-1 px-2.5 w-full justify-center ${diffMode ? "btn-primary" : "btn-ghost bg-chalk"}`}
          aria-pressed={diffMode}
          aria-label="Toggle AI diff comparison mode"
        >
          <SparklesIcon />
          {diffMode ? "Cancel AI Diff" : "AI Compare Versions"}
        </button>
      </div>

      {/* AI diff helper */}
      {diffMode && (
        <div className="px-4 py-2 border-b border-stone text-xs text-ink/60 bg-[#E5E7DF] flex-shrink-0">
          {!selectedA
            ? "Select Version A below"
            : !selectedB
            ? "Now select Version B"
            : (
              <button
                id="run-ai-diff"
                onClick={handleAiDiff}
                disabled={aiLoading}
                className="btn btn-primary w-full justify-center py-1 text-xs"
                aria-label="Generate AI diff summary"
              >
                {aiLoading ? "Generating…" : "✨ Summarize Changes"}
              </button>
            )}
        </div>
      )}

      {/* AI summary output */}
      {aiSummary && (
        <div className="mx-3 my-2 p-3 rounded bg-chalk border border-stone text-[11px] text-ink/80 animate-fade-in flex-shrink-0 max-h-40 overflow-y-auto">
          <p className="text-cobalt font-semibold mb-1 flex items-center gap-1">
            <SparklesIcon /> AI Summary
          </p>
          <p className="leading-relaxed font-serif">{aiSummary}</p>
        </div>
      )}

      {/* Version list with vertical timeline */}
      <div className="flex-1 overflow-y-auto py-4 relative flex flex-col" role="list" aria-label="Document versions">
        {/* Continuous timeline line */}
        <div className="absolute left-[20px] top-0 bottom-0 w-[1px] bg-stone pointer-events-none" />

        {isLoading && (
          <div className="px-4 py-8 text-center flex-1 flex flex-col justify-center items-center">
            <div className="spinner mb-2" />
            <p className="text-ink/50 text-xs">Loading timeline…</p>
          </div>
        )}

        {!isLoading && versions.length === 0 && (
          <div className="px-4 py-8 text-center flex-1 flex flex-col justify-center">
            <p className="text-ink/40 text-xs font-serif">No saved revisions.</p>
          </div>
        )}

        {!isLoading && versions.map((v, i) => {
          const isSelA = selectedA === v.id;
          const isSelB = selectedB === v.id;
          const isSelected = isSelA || isSelB || selectedVersionId === v.id;
          const isCurrent = i === 0;
          const isManual = !v.label.startsWith("Version ");
          const isMerge = i > 0 && i % 3 === 0;

          return (
            <div
              key={v.id}
              id={`version-${v.id}`}
              className={`version-item mx-2.5 my-1.5 pl-6 animate-fade-in-up flex flex-col cursor-pointer transition-all duration-150 rounded ${
                selectedVersionId === v.id ? "selected" : ""
              }`}
              style={{ animationDelay: `${i * 30}ms` }}
              role="listitem"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  if (diffMode) {
                    if (!selectedA) setSelectedA(v.id);
                    else if (!selectedB && v.id !== selectedA) setSelectedB(v.id);
                  } else {
                    onSelectVersion?.(selectedVersionId === v.id ? null : v.id);
                  }
                }
              }}
              onClick={() => {
                if (diffMode) {
                  if (!selectedA) setSelectedA(v.id);
                  else if (!selectedB && v.id !== selectedA) setSelectedB(v.id);
                } else {
                  onSelectVersion?.(selectedVersionId === v.id ? null : v.id);
                }
              }}
              aria-label={`Version: ${v.label}`}
              aria-selected={isSelected}
            >
              {/* Relative layout wrapper for timeline node */}
              <div className="relative flex items-start w-full">
                {/* Visual Branch converging line for merges */}
                {isMerge && (
                  <div className="absolute left-[-23px] top-[-8px] w-6 h-6 overflow-visible pointer-events-none z-10 flex items-center justify-center">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="overflow-visible">
                      <path
                        d="M 4 2 Q 8 10 12 12 M 20 2 Q 16 10 12 12"
                        stroke="var(--color-stone)"
                        strokeWidth="1.2"
                        fill="none"
                        className="animate-branch-converge"
                      />
                    </svg>
                  </div>
                )}

                {/* Timeline node */}
                <div
                  className={`w-2 h-2 rounded-full absolute left-[-19.5px] mt-1.5 flex-shrink-0 z-20 transition-all ${
                    isCurrent
                      ? "bg-cobalt ring-[3px] ring-cobalt/15"
                      : isManual
                      ? "bg-umber"
                      : "bg-stone"
                  }`}
                  aria-hidden="true"
                />

                {/* Content */}
                <div className="flex-1 min-w-0 pr-2">
                  <p className={`text-xs font-sans font-medium truncate ${
                    isCurrent ? "text-cobalt font-semibold" : "text-ink/80"
                  }`}>
                    {v.label}
                  </p>
                  <p className="text-[10px] text-ink/40 mt-0.5 font-sans">
                    {new Date(v.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>

                {/* Selection Indicators for AI Diff */}
                {diffMode && isSelected && (
                  <span className="text-[9px] font-bold text-cobalt flex items-center justify-center w-4 h-4 bg-cobalt/10 rounded ml-auto flex-shrink-0 mr-1">
                    {isSelA ? "A" : "B"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>
  );
}
