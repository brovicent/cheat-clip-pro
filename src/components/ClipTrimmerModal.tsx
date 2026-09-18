import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLanguage } from '../locales';
import type { ViralClip, TranscriptLine } from '../types';

interface ClipTrimmerModalProps {
  isOpen: boolean;
  clip: ViralClip | null;
  videoId: string;
  videoTitle?: string;
  videoDuration: number;
  transcript?: TranscriptLine[];
  isDownloading?: boolean;
  onClose: () => void;
  onDownload: (adjustedClip: ViralClip) => void;
  onApplyToStudio?: (adjustedClip: ViralClip) => void;
}

const formatSeconds = (sec: number): string => {
  if (isNaN(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const remM = m % 60;
  const remS = s % 60;
  if (h > 0) {
    return `${h}:${remM.toString().padStart(2, '0')}:${remS.toString().padStart(2, '0')}`;
  }
  return `${remM}:${remS.toString().padStart(2, '0')}`;
};

const parseFormattedTime = (val: string): number | null => {
  const clean = val.trim();
  if (!clean) return null;
  if (/^\d+(\.\d+)?$/.test(clean)) return parseFloat(clean);
  const parts = clean.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
};

export const ClipTrimmerModal: React.FC<ClipTrimmerModalProps> = ({
  isOpen,
  clip,
  videoId,
  videoDuration,
  transcript = [],
  isDownloading = false,
  onClose,
  onDownload,
  onApplyToStudio,
}) => {
  const { t } = useLanguage();

  if (!isOpen || !clip) return null;

  const origStart = clip.start_time;
  const origEnd = clip.end_time;
  const effectiveTotalDur = videoDuration > 0 ? videoDuration : origEnd + 300;

  // Maximum ±5 minutes (300 seconds) context window
  const minTimelineStart = Math.max(0, Math.floor(origStart - 300));
  const maxTimelineEnd = Math.min(effectiveTotalDur, Math.ceil(origEnd + 300));
  const timelineSpan = Math.max(1, maxTimelineEnd - minTimelineStart);

  const [adjustedStart, setAdjustedStart] = useState<number>(origStart);
  const [adjustedEnd, setAdjustedEnd] = useState<number>(origEnd);
  const [clipTitle, setClipTitle] = useState<string>(clip.title_suggestion || clip.title || 'Clip');
  const [startInputVal, setStartInputVal] = useState<string>(formatSeconds(origStart));
  const [endInputVal, setEndInputVal] = useState<string>(formatSeconds(origEnd));
  const [currentTime, setCurrentTime] = useState<number>(origStart);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [showTranscript, setShowTranscript] = useState<boolean>(true);

  const timelineBarRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<'start' | 'end' | 'playhead' | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const timePollRef = useRef<number | null>(null);

  // Initialize or reset when clip changes
  useEffect(() => {
    if (clip) {
      setAdjustedStart(clip.start_time);
      setAdjustedEnd(clip.end_time);
      setClipTitle(clip.title_suggestion || clip.title || 'Clip');
      setStartInputVal(formatSeconds(clip.start_time));
      setEndInputVal(formatSeconds(clip.end_time));
      setCurrentTime(clip.start_time);
    }
  }, [clip]);

  // Keep manual text inputs synced with numeric state
  useEffect(() => {
    setStartInputVal(formatSeconds(adjustedStart));
  }, [adjustedStart]);

  useEffect(() => {
    setEndInputVal(formatSeconds(adjustedEnd));
  }, [adjustedEnd]);

  // Setup YouTube Iframe API player for the modal preview
  useEffect(() => {
    let isMounted = true;

    const setupPlayer = () => {
      if (!window.YT || !window.YT.Player) {
        return false;
      }
      try {
        const container = document.getElementById('trimmer-yt-player-container');
        if (!container) return false;

        // Destroy previous instance if any
        if (ytPlayerRef.current && typeof ytPlayerRef.current.destroy === 'function') {
          ytPlayerRef.current.destroy();
          ytPlayerRef.current = null;
        }

        ytPlayerRef.current = new window.YT.Player('trimmer-yt-player-container', {
          videoId: videoId,
          playerVars: {
            autoplay: 1,
            start: Math.floor(adjustedStart),
            controls: 1,
            modestbranding: 1,
            rel: 0,
          },
          events: {
            onReady: (e: any) => {
              if (!isMounted) return;
              try {
                e.target.seekTo(adjustedStart, true);
                e.target.pauseVideo();
              } catch {}
            },
            onStateChange: (e: any) => {
              if (!isMounted) return;
              // 1 = playing, 2 = paused, 0 = ended
              setIsPlaying(e.data === 1);
            }
          }
        });
        return true;
      } catch (err) {
        console.warn('Could not initialize YT Player for trimmer:', err);
        return false;
      }
    };

    const timer = setTimeout(() => {
      setupPlayer();
    }, 150);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (ytPlayerRef.current && typeof ytPlayerRef.current.destroy === 'function') {
        try {
          ytPlayerRef.current.destroy();
        } catch {}
        ytPlayerRef.current = null;
      }
    };
  }, [videoId]);

  // Monitor playhead and enforce looping/pause at adjustedEnd
  useEffect(() => {
    timePollRef.current = window.setInterval(() => {
      if (ytPlayerRef.current && typeof ytPlayerRef.current.getCurrentTime === 'function') {
        try {
          const curr = ytPlayerRef.current.getCurrentTime();
          setCurrentTime(curr);
          if (curr >= adjustedEnd) {
            ytPlayerRef.current.seekTo(adjustedStart, true);
            ytPlayerRef.current.pauseVideo();
            setIsPlaying(false);
          }
        } catch {}
      }
    }, 250);

    return () => {
      if (timePollRef.current) {
        clearInterval(timePollRef.current);
        timePollRef.current = null;
      }
    };
  }, [adjustedStart, adjustedEnd]);

  // Player seeking helper
  const seekToTime = useCallback((targetSec: number, play: boolean = false) => {
    const clamped = Math.max(minTimelineStart, Math.min(maxTimelineEnd, targetSec));
    setCurrentTime(clamped);
    if (ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === 'function') {
      try {
        ytPlayerRef.current.seekTo(clamped, true);
        if (play) {
          ytPlayerRef.current.playVideo();
          setIsPlaying(true);
        }
      } catch {}
    }
  }, [minTimelineStart, maxTimelineEnd]);

  const togglePlay = useCallback(() => {
    if (ytPlayerRef.current) {
      try {
        if (isPlaying && typeof ytPlayerRef.current.pauseVideo === 'function') {
          ytPlayerRef.current.pauseVideo();
          setIsPlaying(false);
        } else if (typeof ytPlayerRef.current.playVideo === 'function') {
          // If current time is outside bounds, restart from adjustedStart
          if (currentTime >= adjustedEnd || currentTime < adjustedStart) {
            seekToTime(adjustedStart, true);
          } else {
            ytPlayerRef.current.playVideo();
            setIsPlaying(true);
          }
        }
      } catch {}
    }
  }, [isPlaying, currentTime, adjustedStart, adjustedEnd, seekToTime]);

  // Position calculation helpers
  const timeToPct = useCallback((tSec: number): number => {
    const ratio = (tSec - minTimelineStart) / timelineSpan;
    return Math.max(0, Math.min(100, ratio * 100));
  }, [minTimelineStart, timelineSpan]);

  const pctToTime = useCallback((pct: number): number => {
    const ratio = Math.max(0, Math.min(1, pct / 100));
    return minTimelineStart + ratio * timelineSpan;
  }, [minTimelineStart, timelineSpan]);

  // Dragging logic for timeline handles
  const handlePointerDown = (type: 'start' | 'end' | 'playhead', e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = type;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current || !timelineBarRef.current) return;
    const rect = timelineBarRef.current.getBoundingClientRect();
    const clientX = e.clientX;
    const clickPct = ((clientX - rect.left) / rect.width) * 100;
    const targetTime = pctToTime(clickPct);

    if (draggingRef.current === 'start') {
      const newStart = Math.max(minTimelineStart, Math.min(adjustedEnd - 3, Math.round(targetTime)));
      setAdjustedStart(newStart);
      seekToTime(newStart, false);
    } else if (draggingRef.current === 'end') {
      const newEnd = Math.min(maxTimelineEnd, Math.max(adjustedStart + 3, Math.round(targetTime)));
      setAdjustedEnd(newEnd);
      seekToTime(newEnd, false);
    } else if (draggingRef.current === 'playhead') {
      const newTime = Math.max(adjustedStart, Math.min(adjustedEnd, targetTime));
      seekToTime(newTime, false);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingRef.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {}
      draggingRef.current = null;
    }
  };

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineBarRef.current) return;
    const rect = timelineBarRef.current.getBoundingClientRect();
    const clickPct = ((e.clientX - rect.left) / rect.width) * 100;
    const targetTime = Math.round(pctToTime(clickPct));
    seekToTime(targetTime, false);
  };

  // Stepper handlers
  const nudgeStart = (deltaSec: number) => {
    const next = Math.max(minTimelineStart, Math.min(adjustedEnd - 3, adjustedStart + deltaSec));
    setAdjustedStart(next);
    seekToTime(next, false);
  };

  const nudgeEnd = (deltaSec: number) => {
    const next = Math.min(maxTimelineEnd, Math.max(adjustedStart + 3, adjustedEnd + deltaSec));
    setAdjustedEnd(next);
    seekToTime(next, false);
  };

  // Context metrics
  const frontAdded = Math.max(0, Math.round(origStart - adjustedStart));
  const endAdded = Math.max(0, Math.round(adjustedEnd - origEnd));
  const adjustedDuration = Math.max(1, Math.round(adjustedEnd - adjustedStart));
  const origDuration = Math.max(1, Math.round(origEnd - origStart));

  // Transcript lines within the 10-minute adjustment window
  const relevantTranscript = useMemo(() => {
    if (!transcript || transcript.length === 0) return [];
    return transcript.filter(line => line.end >= minTimelineStart && line.start <= maxTimelineEnd);
  }, [transcript, minTimelineStart, maxTimelineEnd]);

  // Construct adjusted clip object for downloading or applying to Studio
  const getAdjustedClip = (): ViralClip => ({
    ...clip,
    title: clipTitle.trim() || clip.title,
    title_suggestion: clipTitle.trim() || clip.title_suggestion,
    start_time: adjustedStart,
    end_time: adjustedEnd,
  });

  const handleDownloadClick = () => {
    onDownload(getAdjustedClip());
  };

  const handleApplyStudioClick = () => {
    if (onApplyToStudio) {
      onApplyToStudio(getAdjustedClip());
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 10000, padding: '1rem' }}>
      <div
        className="studio-modal-card clip-trimmer-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '1060px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: '16px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.08)'
        }}
      >
        {/* Header */}
        <div className="studio-modal-header" style={{ padding: '1rem 1.4rem', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <div className="studio-header-title">
            <div className="studio-icon-badge" style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', color: '#fff' }}>
              ✂️
            </div>
            <div>
              <div className="studio-title-row" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <h2 style={{ fontSize: '1.15rem', margin: 0 }}>{t.trimmer.modalTitle}</h2>
                <span className="status-pill active" style={{ fontSize: '0.68rem', padding: '0.15rem 0.55rem' }}>
                  ±5 min Context Editor
                </span>
              </div>
              <p className="studio-header-desc" style={{ fontSize: '0.78rem', margin: '0.2rem 0 0', color: 'var(--text-secondary)' }}>
                {t.trimmer.modalSubtitle}
              </p>
            </div>
          </div>
          <button className="studio-close-btn" onClick={onClose} title={t.trimmer.closeBtn}>
            ✕
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.2rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

          {/* Title Editor Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.03)', padding: '0.6rem 0.9rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              {t.trimmer.clipTitleLabel}
            </span>
            <input
              type="text"
              className="form-input"
              value={clipTitle}
              onChange={(e) => setClipTitle(e.target.value)}
              placeholder="Clip title"
              style={{ flex: 1, padding: '0.35rem 0.75rem', fontSize: '0.84rem' }}
            />
          </div>

          {/* Top Row: Embedded Video Preview Player & Live Context Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(260px, 1fr)', gap: '1rem', alignItems: 'start' }}>
            {/* Video Player Box */}
            <div style={{ background: '#000', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', position: 'relative', aspectRatio: '16/9' }}>
              <div id="trimmer-yt-player-container" style={{ width: '100%', height: '100%' }}></div>
              {/* Overlay Player Controls */}
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)',
                padding: '0.4rem 0.6rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.4rem',
                fontSize: '0.75rem'
              }}>
                <button
                  type="button"
                  onClick={togglePlay}
                  style={{
                    background: 'rgba(59, 130, 246, 0.3)',
                    border: '1px solid rgba(59, 130, 246, 0.6)',
                    color: '#fff',
                    borderRadius: '6px',
                    padding: '0.2rem 0.55rem',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    fontWeight: 600
                  }}
                >
                  {isPlaying ? '⏸ Pause' : '▶ Play'}
                </button>
                <div style={{ display: 'flex', gap: '0.3rem' }}>
                  <button
                    type="button"
                    onClick={() => seekToTime(adjustedStart, true)}
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: '5px', padding: '0.15rem 0.45rem', cursor: 'pointer', fontSize: '0.68rem' }}
                    title={t.trimmer.jumpToStart}
                  >
                    {t.trimmer.jumpToStart}
                  </button>
                  <button
                    type="button"
                    onClick={() => seekToTime(origStart, true)}
                    style={{ background: 'rgba(234, 179, 8, 0.15)', border: '1px solid rgba(234, 179, 8, 0.4)', color: '#facc15', borderRadius: '5px', padding: '0.15rem 0.45rem', cursor: 'pointer', fontSize: '0.68rem' }}
                    title={t.trimmer.jumpToAiStart}
                  >
                    {t.trimmer.jumpToAiStart}
                  </button>
                  <button
                    type="button"
                    onClick={() => seekToTime(origEnd, true)}
                    style={{ background: 'rgba(234, 179, 8, 0.15)', border: '1px solid rgba(234, 179, 8, 0.4)', color: '#facc15', borderRadius: '5px', padding: '0.15rem 0.45rem', cursor: 'pointer', fontSize: '0.68rem' }}
                    title={t.trimmer.jumpToAiEnd}
                  >
                    {t.trimmer.jumpToAiEnd}
                  </button>
                  <button
                    type="button"
                    onClick={() => seekToTime(adjustedEnd, true)}
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: '5px', padding: '0.15rem 0.45rem', cursor: 'pointer', fontSize: '0.68rem' }}
                    title={t.trimmer.jumpToEnd}
                  >
                    {t.trimmer.jumpToEnd}
                  </button>
                </div>
                <span style={{ color: '#fff', fontWeight: 600, fontFamily: 'monospace' }}>
                  {formatSeconds(currentTime)}
                </span>
              </div>
            </div>

            {/* Context Metrics & Quick Presets */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {/* Metrics Card */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: '12px',
                padding: '0.85rem 1rem',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0.75rem'
              }}>
                <div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {t.trimmer.adjustedDuration}
                  </span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#38bdf8', marginTop: '0.15rem' }}>
                    {formatSeconds(adjustedDuration)}
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' }}>
                    {formatSeconds(adjustedStart)} → {formatSeconds(adjustedEnd)}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {t.trimmer.originalDuration}
                  </span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#facc15', marginTop: '0.15rem' }}>
                    {formatSeconds(origDuration)}
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' }}>
                    {formatSeconds(origStart)} → {formatSeconds(origEnd)}
                  </span>
                </div>

                {/* Added context summary pills */}
                <div style={{ gridColumn: 'span 2', display: 'flex', gap: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.55rem' }}>
                  <div style={{ flex: 1, background: frontAdded > 0 ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255,255,255,0.02)', padding: '0.35rem 0.6rem', borderRadius: '6px', border: `1px solid ${frontAdded > 0 ? 'rgba(56, 189, 248, 0.3)' : 'rgba(255,255,255,0.05)'}` }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{t.trimmer.addedIntro}</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: frontAdded > 0 ? '#38bdf8' : 'var(--text-secondary)' }}>
                      {frontAdded > 0 ? `+${frontAdded}s (${formatSeconds(frontAdded)})` : '0s'}
                    </div>
                  </div>
                  <div style={{ flex: 1, background: endAdded > 0 ? 'rgba(168, 85, 247, 0.12)' : 'rgba(255,255,255,0.02)', padding: '0.35rem 0.6rem', borderRadius: '6px', border: `1px solid ${endAdded > 0 ? 'rgba(168, 85, 247, 0.3)' : 'rgba(255,255,255,0.05)'}` }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{t.trimmer.addedOutro}</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: endAdded > 0 ? '#c084fc' : 'var(--text-secondary)' }}>
                      {endAdded > 0 ? `+${endAdded}s (${formatSeconds(endAdded)})` : '0s'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Presets Bar */}
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '0.6rem 0.8rem' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '0.4rem' }}>
                  {t.trimmer.quickPresets}
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustedStart(origStart);
                      setAdjustedEnd(origEnd);
                      seekToTime(origStart, false);
                    }}
                    style={{
                      background: (adjustedStart === origStart && adjustedEnd === origEnd) ? 'rgba(234, 179, 8, 0.25)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${(adjustedStart === origStart && adjustedEnd === origEnd) ? 'rgba(234, 179, 8, 0.6)' : 'rgba(255,255,255,0.1)'}`,
                      color: (adjustedStart === origStart && adjustedEnd === origEnd) ? '#facc15' : 'var(--text-secondary)',
                      borderRadius: '6px',
                      padding: '0.25rem 0.55rem',
                      fontSize: '0.72rem',
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                  >
                    ✨ {t.trimmer.presetOriginal}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustedStart(Math.max(minTimelineStart, origStart - 15));
                      setAdjustedEnd(Math.min(maxTimelineEnd, origEnd + 15));
                      seekToTime(Math.max(minTimelineStart, origStart - 15), false);
                    }}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)', borderRadius: '6px', padding: '0.25rem 0.55rem', fontSize: '0.72rem', cursor: 'pointer' }}
                  >
                    {t.trimmer.presetPlus15s}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustedStart(Math.max(minTimelineStart, origStart - 30));
                      setAdjustedEnd(Math.min(maxTimelineEnd, origEnd + 30));
                      seekToTime(Math.max(minTimelineStart, origStart - 30), false);
                    }}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)', borderRadius: '6px', padding: '0.25rem 0.55rem', fontSize: '0.72rem', cursor: 'pointer' }}
                  >
                    {t.trimmer.presetPlus30s}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustedStart(Math.max(minTimelineStart, origStart - 60));
                      setAdjustedEnd(Math.min(maxTimelineEnd, origEnd + 60));
                      seekToTime(Math.max(minTimelineStart, origStart - 60), false);
                    }}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)', borderRadius: '6px', padding: '0.25rem 0.55rem', fontSize: '0.72rem', cursor: 'pointer' }}
                  >
                    {t.trimmer.presetPlus1m}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustedStart(minTimelineStart);
                      setAdjustedEnd(maxTimelineEnd);
                      seekToTime(minTimelineStart, false);
                    }}
                    style={{ background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.35)', color: '#38bdf8', borderRadius: '6px', padding: '0.25rem 0.55rem', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}
                  >
                    🚀 {t.trimmer.presetMax5m}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Video Editor Timeline Container */}
          <div style={{ background: 'rgba(12, 14, 24, 0.85)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>

            {/* Timeline Ruler & Zone Legends */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#38bdf8', display: 'inline-block' }}></span>
                  {t.trimmer.introContextZone}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600, color: '#facc15' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#facc15', display: 'inline-block' }}></span>
                  {t.trimmer.originalRecommendation}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#c084fc', display: 'inline-block' }}></span>
                  {t.trimmer.outroContextZone}
                </span>
              </div>
              <span style={{ fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)' }}>
                {formatSeconds(minTimelineStart)} — {formatSeconds(maxTimelineEnd)}
              </span>
            </div>

            {/* Timeline Track Bar */}
            <div
              ref={timelineBarRef}
              onClick={handleTrackClick}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              style={{
                position: 'relative',
                height: '56px',
                background: 'rgba(20, 24, 40, 0.9)',
                borderRadius: '10px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                cursor: 'pointer',
                userSelect: 'none',
                overflow: 'visible',
                boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.5)'
              }}
            >
              {/* Background Zones */}
              {/* 1. Intro Context Zone (Left) */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: `${timeToPct(origStart)}%`,
                  background: 'repeating-linear-gradient(45deg, rgba(56, 189, 248, 0.03), rgba(56, 189, 248, 0.03) 10px, rgba(56, 189, 248, 0.07) 10px, rgba(56, 189, 248, 0.07) 20px)',
                  borderRight: '1px dashed rgba(234, 179, 8, 0.4)',
                }}
              />

              {/* 2. Original AI Highlight Zone (Center) */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${timeToPct(origStart)}%`,
                  width: `${timeToPct(origEnd) - timeToPct(origStart)}%`,
                  background: 'rgba(234, 179, 8, 0.12)',
                  borderLeft: '1px solid rgba(234, 179, 8, 0.6)',
                  borderRight: '1px solid rgba(234, 179, 8, 0.6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                  zIndex: 2
                }}
              >
                <span style={{
                  fontSize: '0.66rem',
                  fontWeight: 700,
                  color: '#facc15',
                  background: 'rgba(15, 23, 42, 0.85)',
                  padding: '0.15rem 0.45rem',
                  borderRadius: '4px',
                  border: '1px solid rgba(234, 179, 8, 0.4)',
                  whiteSpace: 'nowrap',
                  textShadow: '0 1px 2px rgba(0,0,0,0.5)'
                }}>
                  ✨ AI Pick ({origDuration}s)
                </span>
              </div>

              {/* 3. Outro Context Zone (Right) */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${timeToPct(origEnd)}%`,
                  right: 0,
                  background: 'repeating-linear-gradient(45deg, rgba(168, 85, 247, 0.03), rgba(168, 85, 247, 0.03) 10px, rgba(168, 85, 247, 0.07) 10px, rgba(168, 85, 247, 0.07) 20px)',
                  borderLeft: '1px dashed rgba(234, 179, 8, 0.4)',
                }}
              />

              {/* Active Selected Range Overlay */}
              <div
                style={{
                  position: 'absolute',
                  top: '4px',
                  bottom: '4px',
                  left: `${timeToPct(adjustedStart)}%`,
                  width: `${Math.max(0.5, timeToPct(adjustedEnd) - timeToPct(adjustedStart))}%`,
                  background: 'linear-gradient(90deg, rgba(56, 189, 248, 0.28) 0%, rgba(168, 85, 247, 0.28) 100%)',
                  borderTop: '2px solid #38bdf8',
                  borderBottom: '2px solid #c084fc',
                  boxShadow: '0 0 15px rgba(56, 189, 248, 0.2)',
                  pointerEvents: 'none',
                  zIndex: 3,
                  borderRadius: '4px'
                }}
              />

              {/* Draggable Start Handle */}
              <div
                onPointerDown={(e) => handlePointerDown('start', e)}
                style={{
                  position: 'absolute',
                  top: '-4px',
                  bottom: '-4px',
                  left: `${timeToPct(adjustedStart)}%`,
                  width: '16px',
                  marginLeft: '-8px',
                  background: 'linear-gradient(180deg, #38bdf8, #0284c7)',
                  borderRadius: '4px',
                  cursor: 'ew-resize',
                  zIndex: 10,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.6), 0 0 8px rgba(56, 189, 248, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title={`${t.trimmer.startTimeLabel}: ${formatSeconds(adjustedStart)}`}
              >
                <div style={{ width: '2px', height: '24px', background: '#fff', borderRadius: '1px' }}></div>
                {/* Tooltip Badge */}
                <div style={{
                  position: 'absolute',
                  top: '-24px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#0284c7',
                  color: '#fff',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '0.1rem 0.35rem',
                  borderRadius: '3px',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  fontFamily: 'monospace'
                }}>
                  {formatSeconds(adjustedStart)}
                </div>
              </div>

              {/* Draggable End Handle */}
              <div
                onPointerDown={(e) => handlePointerDown('end', e)}
                style={{
                  position: 'absolute',
                  top: '-4px',
                  bottom: '-4px',
                  left: `${timeToPct(adjustedEnd)}%`,
                  width: '16px',
                  marginLeft: '-8px',
                  background: 'linear-gradient(180deg, #c084fc, #9333ea)',
                  borderRadius: '4px',
                  cursor: 'ew-resize',
                  zIndex: 10,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.6), 0 0 8px rgba(192, 132, 252, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title={`${t.trimmer.endTimeLabel}: ${formatSeconds(adjustedEnd)}`}
              >
                <div style={{ width: '2px', height: '24px', background: '#fff', borderRadius: '1px' }}></div>
                {/* Tooltip Badge */}
                <div style={{
                  position: 'absolute',
                  top: '-24px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#9333ea',
                  color: '#fff',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '0.1rem 0.35rem',
                  borderRadius: '3px',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  fontFamily: 'monospace'
                }}>
                  {formatSeconds(adjustedEnd)}
                </div>
              </div>

              {/* Playhead Needle */}
              <div
                onPointerDown={(e) => handlePointerDown('playhead', e)}
                style={{
                  position: 'absolute',
                  top: '-10px',
                  bottom: '-6px',
                  left: `${timeToPct(currentTime)}%`,
                  width: '2px',
                  background: '#ef4444',
                  boxShadow: '0 0 6px rgba(239, 68, 68, 0.8)',
                  zIndex: 8,
                  cursor: 'pointer'
                }}
              >
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: '-4px',
                  width: '10px',
                  height: '10px',
                  background: '#ef4444',
                  borderRadius: '50%'
                }} />
              </div>
            </div>

            {/* Stepper Buttons and Manual Inputs Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.4rem' }}>
              {/* Left Column: Intro / Opening Steppers & Input */}
              <div style={{ background: 'rgba(56, 189, 248, 0.04)', border: '1px solid rgba(56, 189, 248, 0.15)', borderRadius: '10px', padding: '0.6rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#38bdf8' }}>
                    {t.trimmer.introAdjustLabel}
                  </span>
                  <span style={{ fontSize: '0.68rem', color: frontAdded > 0 ? '#38bdf8' : 'var(--text-secondary)' }}>
                    {frontAdded > 0 ? `+${frontAdded}s intro context` : t.trimmer.noAddedContext}
                  </span>
                </div>
                {/* Stepper Buttons */}
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => nudgeStart(-60)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '5px', padding: '0.2rem 0.45rem', fontSize: '0.7rem', cursor: 'pointer' }}>
                    -60s
                  </button>
                  <button type="button" onClick={() => nudgeStart(-30)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '5px', padding: '0.2rem 0.45rem', fontSize: '0.7rem', cursor: 'pointer' }}>
                    -30s
                  </button>
                  <button type="button" onClick={() => nudgeStart(-15)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '5px', padding: '0.2rem 0.45rem', fontSize: '0.7rem', cursor: 'pointer' }}>
                    -15s
                  </button>
                  <button type="button" onClick={() => nudgeStart(-5)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '5px', padding: '0.2rem 0.45rem', fontSize: '0.7rem', cursor: 'pointer' }}>
                    -5s
                  </button>
                  <button type="button" onClick={() => { setAdjustedStart(origStart); seekToTime(origStart, false); }} style={{ background: 'rgba(234, 179, 8, 0.15)', border: '1px solid rgba(234, 179, 8, 0.4)', color: '#facc15', borderRadius: '5px', padding: '0.2rem 0.45rem', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 600 }}>
                    {t.trimmer.resetToAiStart}
                  </button>
                  <button type="button" onClick={() => nudgeStart(+5)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '5px', padding: '0.2rem 0.45rem', fontSize: '0.7rem', cursor: 'pointer' }}>
                    +5s
                  </button>
                  <button type="button" onClick={() => nudgeStart(+15)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '5px', padding: '0.2rem 0.45rem', fontSize: '0.7rem', cursor: 'pointer' }}>
                    +15s
                  </button>
                </div>
                {/* Manual Timestamp Input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.1rem' }}>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{t.trimmer.startTimeLabel}:</label>
                  <input
                    type="text"
                    className="form-input"
                    value={startInputVal}
                    onChange={(e) => setStartInputVal(e.target.value)}
                    onBlur={() => {
                      const sec = parseFormattedTime(startInputVal);
                      if (sec !== null) {
                        const clamped = Math.max(minTimelineStart, Math.min(adjustedEnd - 3, sec));
                        setAdjustedStart(clamped);
                        seekToTime(clamped, false);
                      } else {
                        setStartInputVal(formatSeconds(adjustedStart));
                      }
                    }}
                    style={{ width: '80px', padding: '0.2rem 0.4rem', fontSize: '0.76rem', fontFamily: 'monospace', textAlign: 'center' }}
                  />
                </div>
              </div>

              {/* Right Column: Outro / Closing Steppers & Input */}
              <div style={{ background: 'rgba(168, 85, 247, 0.04)', border: '1px solid rgba(168, 85, 247, 0.15)', borderRadius: '10px', padding: '0.6rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#c084fc' }}>
                    {t.trimmer.outroAdjustLabel}
                  </span>
                  <span style={{ fontSize: '0.68rem', color: endAdded > 0 ? '#c084fc' : 'var(--text-secondary)' }}>
                    {endAdded > 0 ? `+${endAdded}s outro context` : t.trimmer.noAddedContext}
                  </span>
                </div>
                {/* Stepper Buttons */}
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => nudgeEnd(-15)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '5px', padding: '0.2rem 0.45rem', fontSize: '0.7rem', cursor: 'pointer' }}>
                    -15s
                  </button>
                  <button type="button" onClick={() => nudgeEnd(-5)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '5px', padding: '0.2rem 0.45rem', fontSize: '0.7rem', cursor: 'pointer' }}>
                    -5s
                  </button>
                  <button type="button" onClick={() => { setAdjustedEnd(origEnd); seekToTime(origEnd, false); }} style={{ background: 'rgba(234, 179, 8, 0.15)', border: '1px solid rgba(234, 179, 8, 0.4)', color: '#facc15', borderRadius: '5px', padding: '0.2rem 0.45rem', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 600 }}>
                    {t.trimmer.resetToAiEnd}
                  </button>
                  <button type="button" onClick={() => nudgeEnd(+5)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '5px', padding: '0.2rem 0.45rem', fontSize: '0.7rem', cursor: 'pointer' }}>
                    +5s
                  </button>
                  <button type="button" onClick={() => nudgeEnd(+15)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '5px', padding: '0.2rem 0.45rem', fontSize: '0.7rem', cursor: 'pointer' }}>
                    +15s
                  </button>
                  <button type="button" onClick={() => nudgeEnd(+30)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '5px', padding: '0.2rem 0.45rem', fontSize: '0.7rem', cursor: 'pointer' }}>
                    +30s
                  </button>
                  <button type="button" onClick={() => nudgeEnd(+60)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '5px', padding: '0.2rem 0.45rem', fontSize: '0.7rem', cursor: 'pointer' }}>
                    +60s
                  </button>
                </div>
                {/* Manual Timestamp Input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.1rem' }}>
                  <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{t.trimmer.endTimeLabel}:</label>
                  <input
                    type="text"
                    className="form-input"
                    value={endInputVal}
                    onChange={(e) => setEndInputVal(e.target.value)}
                    onBlur={() => {
                      const sec = parseFormattedTime(endInputVal);
                      if (sec !== null) {
                        const clamped = Math.min(maxTimelineEnd, Math.max(adjustedStart + 3, sec));
                        setAdjustedEnd(clamped);
                        seekToTime(clamped, false);
                      } else {
                        setEndInputVal(formatSeconds(adjustedEnd));
                      }
                    }}
                    style={{ width: '80px', padding: '0.2rem 0.4rem', fontSize: '0.76rem', fontFamily: 'monospace', textAlign: 'center' }}
                  />
                </div>
              </div>
            </div>

          </div>

          {/* Transcript Navigator Collapsible Section */}
          {relevantTranscript.length > 0 && (
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '0.8rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showTranscript ? '0.6rem' : '0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem' }}>📜</span>
                  <strong style={{ fontSize: '0.82rem', color: '#fff' }}>{t.trimmer.transcriptTitle}</strong>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                    ({relevantTranscript.length} lines in context window)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTranscript(prev => !prev)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline' }}
                >
                  {showTranscript ? 'Hide ▲' : 'Show ▼'}
                </button>
              </div>

              {showTranscript && (
                <>
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0 0 0.6rem 0' }}>
                    {t.trimmer.transcriptHint}
                  </p>
                  <div style={{ maxHeight: '170px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem', paddingRight: '0.3rem' }}>
                    {relevantTranscript.map((line, idx) => {
                      const inAiPick = line.start >= origStart && line.end <= origEnd;
                      const inAdjusted = line.start >= adjustedStart && line.end <= adjustedEnd;

                      return (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.35rem 0.6rem',
                            borderRadius: '6px',
                            background: inAiPick
                              ? 'rgba(234, 179, 8, 0.12)'
                              : inAdjusted
                              ? 'rgba(56, 189, 248, 0.08)'
                              : 'rgba(255, 255, 255, 0.02)',
                            border: `1px solid ${inAiPick ? 'rgba(234, 179, 8, 0.3)' : inAdjusted ? 'rgba(56, 189, 248, 0.2)' : 'transparent'}`,
                            fontSize: '0.76rem',
                            gap: '0.6rem'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flex: 1, minWidth: 0 }}>
                            <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: inAiPick ? '#facc15' : inAdjusted ? '#38bdf8' : 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
                              {formatSeconds(line.start)}
                            </span>
                            <span style={{ color: inAdjusted ? '#fff' : 'rgba(255,255,255,0.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {line.text}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
                            {inAiPick ? (
                              <span style={{ fontSize: '0.62rem', background: 'rgba(234, 179, 8, 0.25)', color: '#facc15', padding: '0.1rem 0.35rem', borderRadius: '3px', fontWeight: 600 }}>
                                {t.trimmer.aiPickBadge}
                              </span>
                            ) : inAdjusted ? (
                              <span style={{ fontSize: '0.62rem', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', padding: '0.1rem 0.35rem', borderRadius: '3px' }}>
                                {t.trimmer.contextBadge}
                              </span>
                            ) : null}

                            <button
                              type="button"
                              onClick={() => {
                                setAdjustedStart(Math.floor(line.start));
                                seekToTime(line.start, false);
                              }}
                              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-secondary)', borderRadius: '4px', padding: '0.15rem 0.35rem', fontSize: '0.64rem', cursor: 'pointer' }}
                              title={`${t.trimmer.setAsStart} (${formatSeconds(line.start)})`}
                            >
                              {t.trimmer.setAsStart}
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setAdjustedEnd(Math.ceil(line.end));
                                seekToTime(line.end, false);
                              }}
                              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-secondary)', borderRadius: '4px', padding: '0.15rem 0.35rem', fontSize: '0.64rem', cursor: 'pointer' }}
                              title={`${t.trimmer.setAsEnd} (${formatSeconds(line.end)})`}
                            >
                              {t.trimmer.setAsEnd}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

        </div>

        {/* Footer Action Bar */}
        <div style={{
          padding: '0.9rem 1.4rem',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          background: 'rgba(12, 14, 24, 0.95)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.8rem',
          flexWrap: 'wrap'
        }}>
          {/* Left: Reset to Original AI */}
          <button
            type="button"
            onClick={() => {
              setAdjustedStart(origStart);
              setAdjustedEnd(origEnd);
              seekToTime(origStart, false);
            }}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--text-secondary)',
              borderRadius: '8px',
              padding: '0.45rem 0.85rem',
              fontSize: '0.78rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            {t.trimmer.resetBtn}
          </button>

          {/* Right: Studio & Download Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {onApplyToStudio && (
              <button
                type="button"
                onClick={handleApplyStudioClick}
                style={{
                  background: 'rgba(168, 85, 247, 0.15)',
                  border: '1px solid rgba(168, 85, 247, 0.4)',
                  color: '#c084fc',
                  borderRadius: '8px',
                  padding: '0.45rem 0.9rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  transition: 'var(--transition-smooth)'
                }}
              >
                {t.trimmer.applyToStudioBtn}
              </button>
            )}

            <button
              type="button"
              className="glowing-btn"
              onClick={handleDownloadClick}
              disabled={isDownloading}
              style={{
                padding: '0.5rem 1.25rem',
                fontSize: '0.84rem',
                borderRadius: '8px',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                boxShadow: '0 4px 16px rgba(59, 130, 246, 0.4)'
              }}
            >
              {isDownloading ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ animation: 'spin 1s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                  </svg>
                  <span>{t.trimmer.downloadingBtn}</span>
                </>
              ) : (
                <span>{t.trimmer.downloadRawBtn(formatSeconds(adjustedStart), formatSeconds(adjustedEnd))}</span>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
