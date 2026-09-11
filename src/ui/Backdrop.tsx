import { useEffect, useRef } from 'react';

/**
 * The void.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Every panel used to sit on flat #121214 inside a rounded grey box. That reads
 * as a browser window, and it is the single largest reason the app did not look
 * like Warframe. Warframe never shows you a flat ground: the star chart, the
 * arsenal, the foundry all float over a deep, slowly-moving field of nebula gas
 * with a light burning somewhere behind it.
 *
 * So this is the ground. One fullscreen fragment shader, drawn under everything.
 *
 * WHY RAW WEBGL2 AND NOT R3F
 * ──────────────────────────
 * There is no scene here — no camera, no meshes, no lights. It is one triangle
 * and one shader. Pulling in three.js plus a reconciler to draw one triangle
 * would cost a megabyte and a React render tree for zero benefit, and this is an
 * overlay compositing over a running game where every frame is contended.
 *
 * THE FRAME BUDGET IS THE DESIGN CONSTRAINT
 * ─────────────────────────────────────────
 * Burning GPU on our background steals it from the game the player is actually
 * playing. Three guards, all load-bearing:
 *
 *   1. Rendering STOPS entirely when the document is hidden or the element is
 *      off-screen. An invisible canvas costs nothing.
 *   2. DPR is capped at 1.5. The field is soft, low-frequency gas — it has no
 *      high-frequency detail for a 4K backing store to resolve.
 *   3. The field is deliberately slow, so its SPEED does not depend on the
 *      frame rate - `clock` advances by measured dt. That is what makes it
 *      safe to run at whatever rate the display offers rather than at a fixed
 *      cadence chosen here.
 *      It renders at 30 and hands the other half of the budget back.
 *
 * WHAT IT DRAWS, AND WHY EACH LAYER IS THERE
 * ──────────────────────────────────────────
 * Sampled from the player's own star chart captures, the background is NOT
 * black. It is a desaturated teal-green fog with real depth.
 *
 *   - Domain-warped FBM nebula. Plain FBM looks like clouds; warping the sample
 *     point BY another FBM produces the filamentary, stretched structure that
 *     reads as gas rather than as noise. This is the whole trick.
 *   - A second warped layer at a different scale and drift speed, so the two
 *     parallax against each other instead of looking like one flat texture.
 *   - Three star depths on separate parallax rates, for genuine depth.
 *   - One off-screen warm source. The reference is never uniformly lit; the
 *     frame always has a direction the light comes from.
 */

const VERT = `#version 300 es
// Fullscreen coverage from a single vertex-id triangle: no buffers, no
// attributes, no state. Three verts overshooting the clip cube is strictly
// cheaper than a quad's four verts and two triangles.
void main() {
  // Explicit float() casts: GLSL ES 3.00 has no implicit int-to-float
  // conversion, so vec2(int, int) is a compile error rather than a widening.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uIntensity;

// The field's identity. Every colour below is derived from these rather than
// hardcoded, so one shader renders a different PLACE per panel.
uniform vec3  uDeep;   // the ground, in the voids between filaments
uniform vec3  uBody;   // the bulk of the gas
uniform vec3  uRim;    // the lit edges
uniform vec3  uCold;   // the second hue, in the densest folds
uniform vec3  uCrest;  // filament crests
uniform vec3  uWarm;   // the off-screen light source
uniform vec2  uLight;  // where that light sits

out vec4 fragColor;

// --- value noise ------------------------------------------------------------
// Value noise rather than gradient/simplex: this field is soft gas viewed at low
// frequency, where the two are visually indistinguishable, for a third of the
// ALU. On an overlay sharing a GPU with a game that difference is real.
float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // Quintic fade. Cubic smoothstep leaves second-derivative discontinuities at
  // cell edges, which show up as faint grid lines once six octaves are stacked.
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p, int octaves) {
  float v = 0.0;
  float a = 0.5;
  // Rotate per octave. Without it every octave shares an axis and the sum shows
  // an obvious grid; rotating decorrelates them.
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    v += a * noise(p);
    p = rot * p * 2.02;
    a *= 0.5;
  }
  return v;
}

// Domain warping. THIS is what separates gas from clouds: instead of sampling
// FBM at p, sample it at p displaced by another FBM. The displacement stretches
// and folds the field into filaments and voids.
float warped(vec2 p, float t) {
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.06), 4),
                fbm(p + vec2(5.2, 1.3), 4));
  vec2 r = vec2(fbm(p + 3.4 * q + vec2(1.7, 9.2) + t * 0.04, 4),
                fbm(p + 3.4 * q + vec2(8.3, 2.8), 4));
  return fbm(p + 3.0 * r, 5);
}

// --- stars ------------------------------------------------------------------
// Cell-based rather than a noise threshold: one candidate per cell with a
// jittered position gives even coverage with no clumping, and lets each star
// carry its own size and twinkle phase from the same hash.
float starLayer(vec2 uv, float density, float t, float phase) {
  vec2 g = uv * density;
  vec2 i = floor(g);
  vec2 f = fract(g);

  float h = hash(i + phase);
  // Only a fraction of cells get a star; the empty rest is what gives a real
  // sky its irregular spacing.
  if (h < 0.86) return 0.0;

  vec2 pos = vec2(hash(i + 1.7), hash(i + 4.1));
  float d = length(f - pos);

  // Brightness from a separate hash so size and luminance are uncorrelated — a
  // sky where every bright star is also large looks synthetic.
  float bright = hash(i + 7.3);
  float core = smoothstep(0.055 * (0.4 + bright), 0.0, d);

  // Twinkle: slow, per-star phase, never fully off. Stars that blink to zero
  // read as dead pixels.
  float tw = 0.72 + 0.28 * sin(t * 0.7 + bright * 42.0);
  return core * bright * tw;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  // Aspect-corrected by height, so the field's apparent scale stays constant
  // when the window is resized horizontally.
  vec2 uv = (frag - 0.5 * uRes) / uRes.y;
  float t = uTime;

  // ---- nebula ------------------------------------------------------------
  // Two independently drifting layers. The near one is finer and faster, the
  // far one broad and nearly still. Their relative motion is the parallax.
  float far  = warped(uv * 1.15 + vec2(t * 0.010, t * 0.004), t * 0.5);
  float near = warped(uv * 2.60 + vec2(-t * 0.022, t * 0.011), t);

  // Ridged transform: folding the field about its midpoint turns smooth blobs
  // into sharp-crested filaments. Without this the gas reads as fog — it is
  // what produces the stringy structure the reference actually shows.
  float ridge = 1.0 - abs(near - 0.5) * 2.0;
  ridge = pow(clamp(ridge, 0.0, 1.0), 2.6);

  // The palette arrives as uniforms. The star-chart teal sampled from the
  // player's own captures is the DEFAULT, not the only option — each panel
  // supplies its own so the app reads as a series of places rather than one
  // wallpaper behind thirteen screens.
  vec3 deep  = uDeep;
  vec3 body  = uBody;
  vec3 rim   = uRim;
  vec3 cold  = uCold;
  vec3 crest = uCrest;

  vec3 col = deep;
  // Wider smoothstep windows than the first pass: narrow ones pushed almost the
  // whole field into the darkest stop, which is why it measured near-black.
  col = mix(col, body,  smoothstep(0.18, 0.66, far));
  col = mix(col, rim,   smoothstep(0.32, 0.80, near) * 0.85);
  col = mix(col, cold,  smoothstep(0.45, 0.90, far * near) * 0.70);
  col = mix(col, crest, ridge * smoothstep(0.30, 0.78, far) * 0.62);

  // ---- the light source --------------------------------------------------
  // One warm source off the lower-left, whose only job is to give the frame a
  // direction.
  vec2  lightPos = uLight;
  float ld       = length(uv - lightPos);
  float falloff  = 1.0 / (1.0 + ld * ld * 5.5);
  vec3  warm     = uWarm;
  // Multiplied by nebula density, so the light scatters THROUGH the gas rather
  // than sitting on top of it as a lens flare.
  col += warm * falloff * (0.35 + far * 0.9);

  // ---- stars -------------------------------------------------------------
  float s = 0.0;
  s += starLayer(uv + vec2(t * 0.0016, 0.0), 46.0, t, 0.0)  * 0.42;
  s += starLayer(uv + vec2(t * 0.0034, 0.0), 26.0, t, 11.0) * 0.72;
  s += starLayer(uv + vec2(t * 0.0061, 0.0), 15.0, t, 27.0) * 1.00;

  // Stars occlude behind dense gas. Without this they punch through the
  // brightest part of the nebula and it stops reading as volume.
  float occl = 1.0 - smoothstep(0.52, 0.92, near) * 0.75;
  col += vec3(0.72, 0.83, 0.98) * s * occl;

  // ---- vignette ----------------------------------------------------------
  // Pulls the eye to the centre where the UI lives, and hides the field's
  // tiling at the corners.
  float vig = 1.0 - smoothstep(0.48, 1.30, length(uv * vec2(0.82, 1.0)));
  // A 0.34 floor crushed the corners to black and took most of the field with
  // them. 0.62 keeps the edges legibly part of the same space.
  col *= 0.62 + 0.38 * vig;

  col *= uIntensity;

  // ---- dither ------------------------------------------------------------
  // At these luminances 8-bit output bands visibly across the smooth gradients.
  // A sub-LSB dither costs one hash and removes it entirely.
  col += (hash(frag) - 0.5) / 255.0;

  fragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('[backdrop]', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/**
 * A place.
 *
 * One shader, many rooms. Warframe's own screens are not recolours of each
 * other — the star chart is cold and vast, the Foundry is a lit forge, a lich's
 * territory is hostile — and thirteen panels sharing one identical field was the
 * single largest reason this app read as one long dark list rather than as a
 * series of destinations.
 *
 * Values are linear RGB in the shader's own space, so they are deliberately dark;
 * this is gas seen from outside, not a wall colour.
 */
export interface Palette {
  deep: [number, number, number];
  body: [number, number, number];
  rim: [number, number, number];
  cold: [number, number, number];
  crest: [number, number, number];
  /** The off-screen source. Its hue is what the whole field is lit by. */
  warm: [number, number, number];
  /** Where that source sits, in the shader's aspect-corrected space. */
  light: [number, number];
}

/** The star chart teal, sampled from the player's own captures. The baseline. */
export const VOID_PALETTE: Palette = {
  deep: [0.021, 0.04, 0.044],
  body: [0.07, 0.142, 0.146],
  rim: [0.132, 0.238, 0.23],
  cold: [0.09, 0.168, 0.29],
  crest: [0.205, 0.32, 0.318],
  warm: [0.185, 0.13, 0.072],
  light: [-0.62, -0.34],
};

export interface BackdropProps {
  /**
   * Overall brightness. Dense panels dim the field so it never competes with
   * the text sitting on it; the star chart runs it at full.
   */
  intensity?: number;
  /** The room. Changes are cross-faded, never cut. */
  palette?: Palette;
  className?: string;
}

export function Backdrop({ intensity = 1, palette = VOID_PALETTE, className }: BackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /*
   * Props mirrored into refs so the render loop reads the latest values without
   * a prop change tearing down and rebuilding the GL context.
   *
   * Assigned in EFFECTS, never during render: a ref written during render is a
   * side effect in the render phase, and survives renders React discards. After
   * commit is the only correct place, and one frame of lag is invisible against
   * a 600ms palette cross-fade.
   */
  const intensityRef = useRef(intensity);
  // The palette being headed toward. The one actually drawn lives in the loop
  // and chases this, so switching panels dissolves between rooms instead of
  // cutting — a hard swap of the whole field reads as a glitch.
  const targetRef = useRef(palette);

  /*
   * A one-frame repaint the prop effects can reach into the GL effect and call.
   *
   * It exists for reduced motion and nothing else. The palette is normally
   * chased frame by frame, so with the render loop stopped a panel change would
   * set a new target that nothing ever drew, and the previous room would stay on
   * screen for good. That would be reduced motion removing CONTENT rather than
   * removing movement, which is never the trade. Null while the loop owns the
   * canvas, and null again after unmount.
   */
  const repaintRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    intensityRef.current = intensity;
    repaintRef.current?.();
  }, [intensity]);

  useEffect(() => {
    targetRef.current = palette;
    repaintRef.current?.();
  }, [palette]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false, // nothing here has an edge to alias
      depth: false,
      stencil: false,
      powerPreference: 'low-power', // we are the background of an overlay
      desynchronized: true,
    });

    // No WebGL2 leaves the CSS fallback ground visible. A missing background
    // must never be a blank page.
    if (!gl) return;

    const prog = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!prog || !vs || !fs) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[backdrop]', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uInt = gl.getUniformLocation(prog, 'uIntensity');
    const uDeep = gl.getUniformLocation(prog, 'uDeep');
    const uBody = gl.getUniformLocation(prog, 'uBody');
    const uRim = gl.getUniformLocation(prog, 'uRim');
    const uCold = gl.getUniformLocation(prog, 'uCold');
    const uCrest = gl.getUniformLocation(prog, 'uCrest');
    const uWarm = gl.getUniformLocation(prog, 'uWarm');
    const uLight = gl.getUniformLocation(prog, 'uLight');

    /*
     * The palette currently on screen, chasing `targetRef`.
     *
     * Held as a mutable copy rather than read straight from the prop so a panel
     * change is a dissolve. Seeded from the incoming palette so the first frame
     * is already correct — starting from the default and fading would flash the
     * wrong room on mount.
     */
    const live: Palette = {
      deep: [...targetRef.current.deep],
      body: [...targetRef.current.body],
      rim: [...targetRef.current.rim],
      cold: [...targetRef.current.cold],
      crest: [...targetRef.current.crest],
      warm: [...targetRef.current.warm],
      light: [...targetRef.current.light],
    } as Palette;

    /**
     * Move the live palette a fraction `k` of the way toward the target.
     *
     * Split out of `chase` below so the same code can also make the jump
     * outright at k = 1, which is what a static repaint needs: with no loop
     * running there is nothing to do the chasing, and the dissolve is exactly
     * the motion a reduced-motion viewer asked not to have.
     */
    const blend = (k: number) => {
      const t = targetRef.current;
      // Indexed writes need the non-null assertions because the project runs
      // `noUncheckedIndexedAccess`; both arrays are fixed-length tuples of the
      // same size by construction, so the accesses are total.
      const lerp = (a: number[], b: readonly number[]) => {
        for (let i = 0; i < a.length; i++) {
          const from = a[i]!;
          const to = b[i]!;
          a[i] = from + (to - from) * k;
        }
      };
      lerp(live.deep, t.deep);
      lerp(live.body, t.body);
      lerp(live.rim, t.rim);
      lerp(live.cold, t.cold);
      lerp(live.crest, t.crest);
      lerp(live.warm, t.warm);
      lerp(live.light, t.light);
    };

    /** Exponential approach, frame-rate independent via the dt-scaled factor. */
    // ~0.6s to visually settle at 30fps; slow enough to read as a dissolve,
    // fast enough that it is finished before the eye settles on the content.
    const chase = (dtSec: number) => blend(1 - Math.exp(-dtSec * 6));

    // A VAO is required in WebGL2 even when the vertex shader reads no
    // attributes; without one bound the draw is a no-op on some drivers.
    gl.bindVertexArray(gl.createVertexArray());

    const DPR_CAP = 1.5;
    let w = 0;
    let h = 0;

    /**
     * Paint exactly one frame.
     *
     * Separated from the loop because sizing and painting must NOT depend on the
     * loop running. A canvas mounted while the window is hidden gets no rAF at
     * all, and if resizing lived inside the loop it would keep the default
     * 300x150 backing store and show a blank rectangle the moment it became
     * visible. Resize drives a draw directly instead.
     */
    const drawOnce = () => {
      gl.uniform1f(uTime, clock);
      gl.uniform1f(uInt, intensityRef.current);
      gl.uniform3f(uDeep, live.deep[0], live.deep[1], live.deep[2]);
      gl.uniform3f(uBody, live.body[0], live.body[1], live.body[2]);
      gl.uniform3f(uRim, live.rim[0], live.rim[1], live.rim[2]);
      gl.uniform3f(uCold, live.cold[0], live.cold[1], live.cold[2]);
      gl.uniform3f(uCrest, live.crest[0], live.crest[1], live.crest[2]);
      gl.uniform3f(uWarm, live.warm[0], live.warm[1], live.warm[2]);
      gl.uniform2f(uLight, live.light[0], live.light[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      const nw = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const nh = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (nw === w && nh === h) return;
      w = nw;
      h = nh;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
      // Repaint immediately: a resize while paused would otherwise leave the
      // newly-allocated backing store cleared to transparent black.
      drawOnce();
    };

    let raf = 0;
    let running = false;
    // Accumulated, not read from the clock, so pausing and resuming does not
    // jump the field forward by the length of the pause.
    let clock = 0;
    let last = 0;
    /*
     * THE DISPLAY'S RATE, NOT A NUMBER PICKED HERE.
     * ————————————————————————————————————————————
     * This ran at a hard 30fps, on the reasoning that the field drifts slowly
     * enough that 30 and 60 look the same. That is true of the FIELD and false
     * of the experience: on a 120 or 144Hz monitor a half-rate layer behind
     * full-rate content is exactly the mismatch the eye reads as jank, and the
     * backdrop is the largest moving surface on the screen.
     *
     * Uncapping is safe here specifically because the motion was already
     * frame-rate INDEPENDENT: `clock` advances by measured `dt`, not by a fixed
     * step per frame. So the field drifts at the same speed at 30, 60 or 165Hz
     * - only the number of samples along that path changes. Nothing about the
     * look is tied to the cadence.
     *
     * `dt` is still clamped at 100ms so a long stall cannot make the field jump
     * a tenth of a second in one frame, and every reason to STOP - hidden
     * window, reduced motion - is untouched below.
     */
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = last ? now - last : 16;
      last = now;

      const step = Math.min(dt, 100) / 1000;
      clock += step;
      chase(step);
      drawOnce();
    };

    const start = () => {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    };

    /*
     * REDUCED MOTION IS THE THIRD REASON TO STOP, AND THE ONLY ONE CSS CANNOT
     * REACH.
     *
     * This field is the one thing in the app that moves without anyone asking
     * for it: a slow domain-warped drift under everything, for as long as the
     * window is open. That is precisely the class of motion
     * `prefers-reduced-motion` exists to switch off, and the blanket media query
     * in theme.css cannot touch it, because a requestAnimationFrame loop is
     * invisible to `document.getAnimations()`. The rendered-page audit caught
     * this only by photographing the page twice, a second apart, and finding the
     * pixels different while every CSS rule in the app was already correct. So
     * the loop has to read the preference for itself.
     *
     * THE LOOP STOPS. THE FIELD DOES NOT. Reduced motion means the movement
     * goes, never that the ground goes black, so one frame is still painted and
     * stays painted. The shader is parameterised by `uTime` rather than
     * accumulated into a buffer, so a single frame at a fixed clock is a whole
     * correct picture and not the first step toward one.
     */
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    let still = calm.matches;

    /**
     * Paint one frame when the loop is not the thing painting.
     *
     * Adopts the target palette outright first, because nothing else will - see
     * `repaintRef` on the component for why a stale room is worse than a missing
     * dissolve. A no-op while the loop is running, so the prop effects may call
     * it unconditionally.
     */
    const repaint = () => {
      if (running) return;
      blend(1);
      drawOnce();
    };

    // Two independent reasons to stop: the window is hidden, or this element
    // specifically is off-screen. Both must hold for us to draw - and reduced
    // motion vetoes all of it.
    let visible = !document.hidden;
    let onScreen = true;
    const sync = () => (visible && onScreen && !still ? start() : stop());

    const onVis = () => {
      visible = !document.hidden;
      sync();
    };
    document.addEventListener('visibilitychange', onVis);

    /*
     * Watched, not read once at mount. The preference is a system setting on
     * Windows, and this overlay comfortably outlives a trip to the settings app,
     * so reading it only at mount would leave a player who switches it on
     * staring at a field that keeps drifting until they restart the game.
     * Switching it on stops the loop and repaints the frame that is already
     * there; switching it off resumes from the clock that frame left behind, so
     * the field carries on rather than jumping.
     */
    const onCalm = () => {
      still = calm.matches;
      sync();
      repaint();
    };
    calm.addEventListener('change', onCalm);

    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries[0]?.isIntersecting ?? true;
        sync();
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    // Layout, not the loop, owns sizing — see drawOnce above.
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    resize();
    sync();
    repaintRef.current = repaint;

    return () => {
      // The loop must not outlive the effect. `stop()` cancels the pending
      // frame, and the unconditional cancel after it covers the one case
      // `stop()` deliberately skips: a frame still scheduled while the
      // bookkeeping flag says the loop is not running.
      stop();
      cancelAnimationFrame(raf);
      repaintRef.current = null;
      calm.removeEventListener('change', onCalm);
      document.removeEventListener('visibilitychange', onVis);
      io.disconnect();
      ro.disconnect();
      // Release the GPU objects we allocated. The context itself is deliberately
      // NOT force-lost: `loseContext()` is permanent for that canvas, so under
      // StrictMode's mount/unmount/mount it kills the context the second effect
      // then tries to reuse, and the backdrop stays black forever. The context
      // is reclaimed with the canvas element on unmount anyway.
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        // Visible before the first GL frame, and forever if WebGL2 is absent.
        background: 'radial-gradient(120% 90% at 30% 70%, #0d1a1c 0%, #060a0c 60%, #04070a 100%)',
      }}
    />
  );
}
