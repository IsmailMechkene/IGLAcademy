import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward, AlertTriangle,
} from 'lucide-react';
import { PLAYBACK_SPEEDS } from '../../types';
import { formatTime } from '../../utils/format';
import styles from './VideoPlayer.module.css';

export interface VideoPlayerHandle {
  getCurrentTime: () => number;
  getDuration: () => number;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
}

interface Props {
  src: string;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  defaultSpeed: number;
  onMissingFile?: () => void;
  onError?: () => void;
  missing?: boolean;
}

const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { src, onEnded, onTimeUpdate, onPrev, onNext, hasPrev, hasNext, defaultSpeed, onMissingFile, onError, missing },
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
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    getDuration: () => videoRef.current?.duration ?? 0,
    play: () => void videoRef.current?.play(),
    pause: () => void videoRef.current?.pause(),
    seek: (seconds: number) => {
      if (videoRef.current) videoRef.current.currentTime = seconds;
    },
  }));

  // Apply default speed when it changes (settings)
  useEffect(() => {
    setSpeed(defaultSpeed);
  }, [defaultSpeed]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  // Track fullscreen changes
  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

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

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (missing) {
    return (
      <div className={styles.player} ref={containerRef}>
        <div className={styles.errorState}>
          <AlertTriangle size={40} color="var(--warning)" />
          <h3>Video file not found</h3>
          <p>
            This lesson's file appears to have been moved or deleted. Your progress is saved —
            locate the file to keep watching.
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
          setCurrentTime(v.currentTime);
          onTimeUpdate?.(v.currentTime, v.duration);
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
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
      />

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
          <button className={styles.controlBtn} onClick={onPrev} disabled={!hasPrev} title="Previous lesson">
            <SkipBack size={19} />
          </button>
          <button className={styles.controlBtn} onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className={styles.controlBtn} onClick={onNext} disabled={!hasNext} title="Next lesson">
            <SkipForward size={19} />
          </button>
          <div className={styles.volumeWrap}>
            <button className={styles.controlBtn} onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
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
          <div style={{ position: 'relative' }}>
            <button
              className={styles.controlBtn}
              onClick={() => setSpeedMenuOpen((o) => !o)}
              title="Playback speed"
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
          <button className={styles.controlBtn} onClick={toggleFullscreen} title="Fullscreen">
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
});

export default VideoPlayer;
