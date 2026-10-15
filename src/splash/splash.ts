/**
 * Launch animation for the splash window (splash.html).
 *
 * A port of the IGLAcademy Rive file: the same three timelines (Intro, a
 * looping Loading, Exit), keyframes and easing curves, played at 60 fps on
 * the inline SVG. Like the Rive state machine, Intro always plays in full,
 * then Loading loops until the app window is ready, then Exit plays and the
 * main process is told to swap windows.
 */

export {};

declare global {
  interface Window {
    splash: {
      onFinish: (callback: () => void) => void;
      done: () => void;
    };
  }
}

const FPS = 60;
const INTRO_FRAMES = 72;
const LOADING_FRAMES = 90;
const EXIT_FRAMES = 30;

type Ease = (t: number) => number;

const linear: Ease = (t) => t;
const hold: Ease = () => 0;

/** CSS-style cubic-bezier(x1, y1, x2, y2) timing function. */
function cubic(x1: number, y1: number, x2: number, y2: number): Ease {
  const bez = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  const slope = (a: number, b: number, t: number) =>
    3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t;
  return (x) => {
    if (x <= 0 || x >= 1) return x <= 0 ? 0 : 1;
    // Newton's method for the curve parameter at this x, bisection if it stalls.
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = slope(x1, x2, t);
      if (Math.abs(d) < 1e-6) break;
      t -= (bez(x1, x2, t) - x) / d;
    }
    if (t < 0 || t > 1 || Math.abs(bez(x1, x2, t) - x) > 1e-4) {
      let lo = 0;
      let hi = 1;
      t = x;
      for (let i = 0; i < 30; i++) {
        if (bez(x1, x2, t) < x) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return bez(y1, y2, t);
  };
}

const easeOut = cubic(0.22, 1, 0.36, 1);
const easeInOut = cubic(0.45, 0, 0.55, 1);
const sweep = cubic(0.65, 0, 0.35, 1);
const exitEase = cubic(0.55, 0, 1, 0.45);

/** [frame, value, easing toward the next key] — the interpolator sits on the earlier key, as in Rive. */
type Key = [number, number, Ease];

function sample(keys: Key[], frame: number): number {
  if (frame <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [f0, v0, ease] = keys[i];
    const [f1, v1] = keys[i + 1];
    if (frame < f1) return v0 + (v1 - v0) * ease((frame - f0) / (f1 - f0));
  }
  return keys[keys.length - 1][1];
}

/** Everything the timelines animate. Unkeyed values persist between timelines. */
interface Pose {
  bottomY: number;
  bottomOpacity: number;
  middleY: number;
  middleOpacity: number;
  capY: number;
  capOpacity: number;
  tasselY: number;
  tasselOpacity: number;
  tasselRotation: number;
  trackOpacity: number;
  trimStart: number;
  trimEnd: number;
  logoScale: number;
  logoOpacity: number;
}

type Timeline = Partial<Record<keyof Pose, Key[]>>;

const intro: Timeline = {
  bottomY: [[0, 59.5, easeOut], [18, 29.5, linear]],
  bottomOpacity: [[0, 0, linear], [14, 1, linear]],
  middleY: [[0, 21, hold], [8, 21, easeOut], [26, -9, linear]],
  middleOpacity: [[0, 0, hold], [8, 0, linear], [22, 1, linear]],
  capY: [[0, -105.5, hold], [16, -105.5, easeOut], [34, -65.5, easeInOut], [40, -68.5, easeInOut], [46, -65.5, linear]],
  capOpacity: [[0, 0, hold], [16, 0, linear], [26, 1, linear]],
  tasselY: [[0, -103.5, hold], [16, -103.5, easeOut], [34, -63.5, easeInOut], [40, -66.5, easeInOut], [46, -63.5, linear]],
  tasselOpacity: [[0, 0, hold], [16, 0, linear], [26, 1, linear]],
  tasselRotation: [[0, 0, hold], [34, 0, easeInOut], [43, 18, easeInOut], [53, -10, easeInOut], [62, 5, easeInOut], [72, 0, linear]],
  trackOpacity: [[0, 0, hold], [36, 0, linear], [52, 1, linear]],
  trimStart: [[0, 0, hold]],
  trimEnd: [[0, 0, hold]],
};

const loading: Timeline = {
  tasselRotation: [[0, 0, easeInOut], [22, 5, easeInOut], [45, 0, easeInOut], [67, -5, easeInOut], [90, 0, linear]],
  trimEnd: [[0, 0, sweep], [60, 100, hold], [90, 100, hold]],
  trimStart: [[0, 0, hold], [25, 0, sweep], [90, 100, hold]],
};

const exit: Timeline = {
  logoScale: [[0, 1, exitEase], [24, 0.92, hold]],
  logoOpacity: [[0, 1, exitEase], [24, 0, hold]],
  trimStart: [[0, 0, hold]],
  trimEnd: [[0, 100, hold]],
};

const pose: Pose = {
  bottomY: 29.5,
  bottomOpacity: 1,
  middleY: -9,
  middleOpacity: 1,
  capY: -65.5,
  capOpacity: 1,
  tasselY: -63.5,
  tasselOpacity: 1,
  tasselRotation: 0,
  trackOpacity: 1,
  trimStart: 0,
  trimEnd: 100,
  logoScale: 1,
  logoOpacity: 1,
};

function apply(timeline: Timeline, frame: number): void {
  for (const [prop, keys] of Object.entries(timeline) as [keyof Pose, Key[]][]) {
    pose[prop] = sample(keys, frame);
  }
}

const el = (id: string) => document.getElementById(id) as unknown as SVGElement;
const logo = el('logo');
const bookBottom = el('book-bottom');
const bookMiddle = el('book-middle');
const cap = el('cap');
const tassel = el('tassel');
const track = el('track');
const bar = el('bar');

// The tassel hangs from the cap's right corner, tilted slightly outward;
// its swing is added on top of that rest angle.
const TASSEL_X = 97;
const TASSEL_REST_ROTATION = -9.55;

function render(): void {
  const s = pose.logoScale;
  logo.setAttribute('transform', `translate(197.5 203.5) scale(${s})`);
  logo.setAttribute('opacity', String(pose.logoOpacity));
  bookBottom.setAttribute('transform', `translate(-1.5 ${pose.bottomY})`);
  bookBottom.setAttribute('opacity', String(pose.bottomOpacity));
  bookMiddle.setAttribute('transform', `translate(-1.5 ${pose.middleY})`);
  bookMiddle.setAttribute('opacity', String(pose.middleOpacity));
  cap.setAttribute('transform', `translate(-1.5 ${pose.capY})`);
  cap.setAttribute('opacity', String(pose.capOpacity));
  tassel.setAttribute(
    'transform',
    `translate(${TASSEL_X} ${pose.tasselY}) rotate(${TASSEL_REST_ROTATION + pose.tasselRotation})`,
  );
  tassel.setAttribute('opacity', String(pose.tasselOpacity));
  track.setAttribute('opacity', String(pose.trackOpacity));
  // Trim path as a dash: visible from trimStart to trimEnd (pathLength = 100).
  const length = pose.trimEnd - pose.trimStart;
  bar.setAttribute('visibility', length > 0.05 ? 'visible' : 'hidden');
  bar.setAttribute('stroke-dasharray', `${Math.max(length, 0)} 200`);
  bar.setAttribute('stroke-dashoffset', String(-pose.trimStart));
}

let doneSent = false;
function done(): void {
  if (doneSent) return;
  doneSent = true;
  window.splash.done();
}

let finishRequested = false;
window.splash.onFinish(() => {
  finishRequested = true;
});

if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  // Still logo, no motion: hand over as soon as the app is ready.
  render();
  window.splash.onFinish(done);
} else {
  let phase: 'intro' | 'loading' | 'exit' = 'intro';
  let phaseStart = performance.now();

  const tick = (now: number) => {
    const frame = ((now - phaseStart) / 1000) * FPS;
    if (phase === 'intro') {
      apply(intro, Math.min(frame, INTRO_FRAMES));
      if (frame >= INTRO_FRAMES) {
        phase = 'loading';
        phaseStart += (INTRO_FRAMES / FPS) * 1000;
      }
    } else if (phase === 'loading') {
      if (finishRequested) {
        phase = 'exit';
        phaseStart = now;
        apply(exit, 0);
      } else {
        apply(loading, frame % LOADING_FRAMES);
      }
    } else {
      apply(exit, Math.min(frame, EXIT_FRAMES));
      if (frame >= EXIT_FRAMES) {
        render();
        done();
        return;
      }
    }
    render();
    requestAnimationFrame(tick);
  };

  apply(intro, 0);
  render();
  requestAnimationFrame(tick);
}
