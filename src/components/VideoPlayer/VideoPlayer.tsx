import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward, AlertTriangle,
  Captions, PictureInPicture2, Repeat,
} from 'lucide-react';
import { PLAYBACK_SPEEDS } from '../../types';
import { formatTime } from '../../utils/format';
import { api } from '../../services/api';
import styles from './VideoPlayer.module.css';

export interface SubtitleTrack {
  index: number;
  label: string;
  url: string;
}

export interface VideoPlayerHandle {
  getCurrentTime: () => number;
  getDuration: () => number;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  togglePlay: () => void;
  seekBy: (deltaSeconds: number) => void;
  volumeBy: (delta: number) => void;
  toggleMute: () => void;
  toggleFullscreen: () => void;
  cycleSpeed: (direction: 1 | -1) => void;
  togglePip: () => void;
}

interface Props {
  src?: string;
  lessonId?: number;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onLoadedMetadata?: (duration: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  defaultSpeed: number;
  onMissingFile?: () => void;
  onError?: () => void;
  missing?: boolean;
  /** Non-empty when the file exists but the browser cannot play it. */
  loadError?: string | null;
  mediaKind?: 'video' | 'practice';
}

const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { src, lessonId, onEnded, onTimeUpdate, onLoadedMetadata, onPrev, onNext, hasPrev, hasNext, defaultSpeed, onMissingFile, onError, missing, loadError, mediaKind = 'video' },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(defaultSpeed);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [activeTrack, setActiveTrack] = useState<number | 'off'>('off');
  const [ccMenuOpen, setCcMenuOpen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loopRef = useRef<{ a: number | null; b: number | null }>({ a: null, b: null });
  loopRef.current = { a: loopA, b: loopB };
  const togglePlayRef = useRef<() => void>(() => undefined);
  const pokeControlsRef = useRef<() => void>(() => undefined);
  const toggleMuteRef = useRef<() => void>(() => undefined);
  const toggleFullscreenRef = useRef<() => void>(() => undefined);
  const togglePipRef = useRef<() => void>(() => undefined);

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    getDuration: () => videoRef.current?.duration ?? 0,
    play: () => void videoRef.current?.play(),
    pause: () => void videoRef.current?.pause(),
    seek: (seconds: number) => {
      if (videoRef.current) videoRef.current.currentTime = seconds;
    },
    togglePlay: () => togglePlayRef.current(),
    seekBy: (deltaSeconds: number) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration)) return;
      v.currentTime = Math.min(Math.max(0, v.currentTime + deltaSeconds), v.duration || 0);
      pokeControlsRef.current();
    },
    volumeBy: (delta: number) => {
      const v = videoRef.current;
      if (!v) return;
      const next = Math.min(1, Math.max(0, v.volume + delta));
      v.volume = next;
      v.muted = next === 0 ? true : v.muted;
      setVolume(next);
      if (next > 0) setMuted(false);
    },
    toggleMute: () => toggleMuteRef.current(),
    toggleFullscreen: () => toggleFullscreenRef.current(),
    cycleSpeed: (direction: 1 | -1) => {
      setSpeed((prev) => {
        const idx = PLAYBACK_SPEEDS.indexOf(prev as (typeof PLAYBACK_SPEEDS)[number]);
        const next = idx < 0 ? 2 : (idx + direction + PLAYBACK_SPEEDS.length) % PLAYBACK_SPEEDS.length;
        return PLAYBACK_SPEEDS[next];
      });
    },
    togglePip: () => void togglePipRef.current(),
  }));

  // Load subtitle tracks for video lessons
  useEffect(() => {
    setTracks([]);
    setActiveTrack('off');
    if (lessonId === undefined) return;
    let cancelled = false;
    api()
      .media.subtitles(lessonId)
      .then((t) => {
        if (!cancelled) setTracks(t);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lessonId, src]);

  // Apply default speed when it changes (settings)
  useEffect(() => {
    setSpeed(defaultSpeed);
  }, [defaultSpeed]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  // Track fullscreen + PiP changes (PiP events fire on the video element)
  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Escape closes open control menus
  useEffect(() => {
    if (!speedMenuOpen && !ccMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSpeedMenuOpen(false);
        setCcMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [speedMenuOpen, ccMenuOpen]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPipEnter = () => setIsPip(true);
    const onPipLeave = () => setIsPip(false);
    v.addEventListener('enterpictureinpicture', onPipEnter);
    v.addEventListener('leavepictureinpicture', onPipLeave);
    return () => {
      v.removeEventListener('enterpictureinpicture', onPipEnter);
      v.removeEventListener('leavepictureinpicture', onPipLeave);
    };
  }, [src]);

  // Auto-hide controls while playing
  const pokeControls = () => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, 2600);
  };

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
    pokeControls();
  };

  const handleSeek = (value: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = value;
    setCurrentTime(value);
  };

  const handleVolume = (value: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = value;
    v.muted = value === 0;
    setVolume(value);
    setMuted(value === 0);
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current.requestFullscreen();
  };

  const togglePip = async () => {
    const v = videoRef.current;
    if (!v || !document.pictureInPictureEnabled || v.disablePictureInPicture) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {
      // PiP unavailable for this video — stay inline
    }
  };

  // A–B loop: press once to set A, again to set B (loop on), again to clear.
  const cycleLoop = () => {
    const t = videoRef.current?.currentTime ?? 0;
    if (loopA === null) {
      setLoopA(t);
      setLoopB(null);
    } else if (loopB === null) {
      if (t > loopA + 0.5) setLoopB(t);
      else {
        setLoopA(null);
        setLoopB(null);
      }
    } else {
      setLoopA(null);
      setLoopB(null);
    }
    pokeControls();
  };

  togglePlayRef.current = togglePlay;
  pokeControlsRef.current = pokeControls;
  toggleMuteRef.current = toggleMute;
  toggleFullscreenRef.current = toggleFullscreen;
  togglePipRef.current = () => void togglePip();

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (missing) {
    return (
      <div className={styles.player} ref={containerRef}>
        <div className={styles.errorState}>
          <AlertTriangle size={40} color="var(--warning)" />
          <h3>{mediaKind === 'practice' ? 'Practice test not found' : 'Video file not found'}</h3>
          <p>
            This lesson's file appears to have been moved or deleted. Your progress is saved —
            locate the file to keep {mediaKind === 'practice' ? 'studying' : 'watching'}.
          </p>
          {onMissingFile && (
            <button className="btn btn-ghost" onClick={onMissingFile}>
              Locate file
            </button>
          )}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.player} ref={containerRef}>
        <div className={styles.errorState}>
          <AlertTriangle size={40} color="var(--danger)" />
          <h3>This video could not be played</h3>
          <p>{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.player}
      ref={containerRef}
      onMouseMove={pokeControls}
      onMouseLeave={() => playing && setControlsVisible(false)}
    >
      <video
        ref={videoRef}
        className={styles.video}
        src={src}
        onClick={togglePlay}
        onPlay={() => {
          setPlaying(true);
          pokeControls();
        }}
        onPause={() => {
          setPlaying(false);
          setControlsVisible(true);
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          // A–B loop enforcement
          const { a, b } = loopRef.current;
          if (a !== null && b !== null && b > a && (v.currentTime < a || v.currentTime >= b)) {
            v.currentTime = a;
            return;
          }
          setCurrentTime(v.currentTime);
          onTimeUpdate?.(v.currentTime, v.duration);
        }}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          onLoadedMetadata?.(e.currentTarget.duration);
        }}
        onError={() => onError?.()}
        onEnded={() => {
          setPlaying(false);
          setControlsVisible(true);
          onEnded?.();
        }}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
        }}
      >
        {tracks
          .filter((t) => activeTrack === t.index)
          .map((t) => (
            <track key={t.url} kind="subtitles" src={t.url} label={t.label} default />
          ))}
      </video>

      {!playing && (
        <button className={styles.centerPlay} onClick={togglePlay} aria-label="Play">
          <Play size={30} fill="currentColor" />
        </button>
      )}

      <div className={`${styles.controls} ${controlsVisible ? styles.visible : ''}`}>
        <div className={styles.seekRow}>
          <span className={styles.time}>{formatTime(currentTime)}</span>
          <input
            type="range"
            className={styles.seekBar}
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            style={{ ['--progress' as string]: `${progress}%` }}
            onChange={(e) => handleSeek(Number(e.target.value))}
            aria-label="Seek"
          />
          <span className={styles.time}>{formatTime(duration)}</span>
        </div>
        <div className={styles.controlRow}>
          <button className={styles.controlBtn} onClick={onPrev} disabled={!hasPrev} title="Previous lesson" aria-label="Previous lesson">
            <SkipBack size={19} />
          </button>
          <button className={styles.controlBtn} onClick={togglePlay} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className={styles.controlBtn} onClick={onNext} disabled={!hasNext} title="Next lesson" aria-label="Next lesson">
            <SkipForward size={19} />
          </button>
          <div className={styles.volumeWrap}>
            <button className={styles.controlBtn} onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'} aria-label={muted ? 'Unmute' : 'Mute'}>
              {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              type="range"
              className={styles.volumeSlider}
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              style={{ ['--volume' as string]: `${(muted ? 0 : volume) * 100}%` }}
              onChange={(e) => handleVolume(Number(e.target.value))}
              aria-label="Volume"
            />
          </div>
          <div className={styles.spacer} />
          {loopA !== null && (
            <span className={styles.loopLabel} title="A–B loop range">
              A {formatTime(loopA)}{loopB !== null ? ` – B ${formatTime(loopB)}` : ' …'}
            </span>
          )}
          <button
            className={styles.controlBtn}
            onClick={cycleLoop}
            title={loopA === null ? 'Loop: set point A' : loopB === null ? 'Loop: set point B' : 'Loop: clear'}
            aria-label={loopA === null ? 'Set loop point A' : loopB === null ? 'Set loop point B' : 'Clear loop'}
            aria-pressed={loopB !== null}
            style={loopB !== null ? { color: 'var(--accent)' } : undefined}
          >
            <Repeat size={17} />
          </button>
          {tracks.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button
                className={styles.controlBtn}
                onClick={() => setCcMenuOpen((o) => !o)}
                title="Subtitles"
                aria-label="Subtitles"
                aria-expanded={ccMenuOpen}
                style={activeTrack !== 'off' ? { color: 'var(--accent)' } : undefined}
              >
                <Captions size={18} />
              </button>
              {ccMenuOpen && (
                <div className={styles.speedMenu} role="menu" aria-label="Subtitle tracks">
                  <button
                    className={`${styles.speedOption} ${activeTrack === 'off' ? styles.active : ''}`}
                    onClick={() => {
                      setActiveTrack('off');
                      setCcMenuOpen(false);
                    }}
                  >
                    Off
                  </button>
                  {tracks.map((t) => (
                    <button
                      key={t.index}
                      className={`${styles.speedOption} ${activeTrack === t.index ? styles.active : ''}`}
                      onClick={() => {
                        setActiveTrack(t.index);
                        setCcMenuOpen(false);
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && (
            <button
              className={styles.controlBtn}
              onClick={() => void togglePip()}
              title={isPip ? 'Exit picture-in-picture' : 'Picture-in-picture'}
              aria-label={isPip ? 'Exit picture-in-picture' : 'Picture-in-picture'}
              aria-pressed={isPip}
            >
              <PictureInPicture2 size={18} />
            </button>
          )}
          <div style={{ position: 'relative' }}>
            <button
              className={styles.controlBtn}
              onClick={() => setSpeedMenuOpen((o) => !o)}
              title="Playback speed"
              aria-label="Playback speed"
              aria-expanded={speedMenuOpen}
              style={{ width: 'auto', padding: '0 10px', fontSize: 13, fontWeight: 600 }}
            >
              {speed}x
            </button>
            {speedMenuOpen && (
              <div className={styles.speedMenu}>
                {PLAYBACK_SPEEDS.map((s) => (
                  <button
                    key={s}
                    className={`${styles.speedOption} ${s === speed ? styles.active : ''}`}
                    onClick={() => {
                      setSpeed(s);
                      setSpeedMenuOpen(false);
                    }}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className={styles.controlBtn} onClick={toggleFullscreen} title="Fullscreen" aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
});

export default VideoPlayer;
