/* SkyBlink hero nebula.
 * Draws the real JWST "Cosmic Cliffs" image (NASA, ESA, CSA, STScI) through a small WebGL shader.
 * The cursor acts like a gravitational lens: it gently magnifies and bends the light around it.
 * Decoration only: this image is never used as data.
 * Falls back to the plain <img> when WebGL is missing or the user prefers reduced motion. */
(function () {
  "use strict";

  const VERT = `
    attribute vec2 a;
    varying vec2 v;
    void main() { v = vec2(a.x * .5 + .5, .5 - a.y * .5); gl_Position = vec4(a, 0., 1.); }`;

  const FRAG = `
    precision mediump float;
    uniform sampler2D u_tex;
    uniform vec2 u_res, u_img, u_mouse, u_par;
    uniform float u_lens, u_time;
    varying vec2 v;

    vec2 cover(vec2 uv) {
      float rs = u_res.x / u_res.y, ri = u_img.x / u_img.y;
      vec2 s = rs > ri ? vec2(1., ri / rs) : vec2(rs / ri, 1.);
      return (uv - .5) * s + .5;
    }

    void main() {
      vec2 p = v * u_res;
      vec2 d = p - u_mouse;
      float r = length(d);
      float R = .14 * min(u_res.x, u_res.y) + 70.;
      float k = u_lens * exp(-(r * r) / (R * R));

      vec2 uv = (p - d * .38 * k) / u_res;
      float z = 1.07 + .015 * sin(u_time * .05);
      uv = (uv - .5) / z + .5 + u_par * .012 + vec2(sin(u_time * .031), cos(u_time * .027)) * .004;
      vec2 t = cover(uv);

      vec2 dir = r > 0. ? d / r : vec2(0.);
      float ca = .006 * k;
      vec3 c = vec3(texture2D(u_tex, t + dir * ca).r, texture2D(u_tex, t).g, texture2D(u_tex, t - dir * ca).b);

      float ring = exp(-pow((r - R * .7) / (R * .05), 2.)) * u_lens;
      c *= 1. + .22 * k;
      c += vec3(1., .78, .55) * ring * .07;
      gl_FragColor = vec4(c, 1.);
    }`;

  function shader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }

  // Returns a cleanup function. `img` must be loaded (or loading) and same-origin.
  function mount(container, img) {
    const noop = () => {};
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return noop;

    const canvas = document.createElement("canvas");
    canvas.className = "nebula-gl";
    canvas.setAttribute("aria-hidden", "true");
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) return noop;

    const vs = shader(gl, gl.VERTEX_SHADER, VERT), fs = shader(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return noop;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return noop;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U = n => gl.getUniformLocation(prog, n);
    const u = { res: U("u_res"), img: U("u_img"), mouse: U("u_mouse"), par: U("u_par"), lens: U("u_lens"), time: U("u_time") };

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
     [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]
      .forEach(([k, val]) => gl.texParameteri(gl.TEXTURE_2D, k, val));

    let ready = false, raf = 0, visible = true, running = true;
    const host = container.closest(".hero") || container;
    const target = { x: 0, y: 0, lens: 0, px: 0, py: 0 };
    const cur = { x: 0, y: 0, lens: 0, px: 0, py: 0 };
    let dpr = 1;

    function upload() {
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      } catch { return; }
      gl.uniform2f(u.img, img.naturalWidth, img.naturalHeight);
      ready = true;
      container.appendChild(canvas);
      requestAnimationFrame(() => canvas.classList.add("is-on"));
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      const w = Math.max(1, Math.round(container.clientWidth * dpr));
      const h = Math.max(1, Math.round(container.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(u.res, w, h);
    }

    function onMove(e) {
      const rect = container.getBoundingClientRect();
      target.x = (e.clientX - rect.left) * dpr;
      target.y = (e.clientY - rect.top) * dpr;
      target.px = (e.clientX - rect.left) / rect.width * 2 - 1;
      target.py = (e.clientY - rect.top) / rect.height * 2 - 1;
      if (!cur.lens) { cur.x = target.x; cur.y = target.y; }
      // Ease the lens off over text, forms and the preview so reading stays calm.
      target.lens = e.target.closest("a, button, input, form, figure, .hero-copy") ? 0.35 : 1;
    }
    function onLeave() { target.lens = 0; target.px = 0; target.py = 0; }

    const t0 = performance.now();
    function frame(now) {
      raf = 0;
      if (!running || !visible || !ready) return;
      cur.x += (target.x - cur.x) * .1;
      cur.y += (target.y - cur.y) * .1;
      cur.px += (target.px - cur.px) * .05;
      cur.py += (target.py - cur.py) * .05;
      cur.lens += (target.lens - cur.lens) * .06;
      if (cur.lens < .002) cur.lens = 0;
      gl.uniform2f(u.mouse, cur.x, cur.y);
      gl.uniform2f(u.par, cur.px, cur.py);
      gl.uniform1f(u.lens, cur.lens);
      gl.uniform1f(u.time, (now - t0) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf && running && visible && ready) raf = requestAnimationFrame(frame); };

    const ro = new ResizeObserver(() => { resize(); kick(); });
    ro.observe(container);
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting && !document.hidden; kick(); });
    io.observe(host);
    const onVis = () => { visible = !document.hidden; kick(); };
    document.addEventListener("visibilitychange", onVis);
    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);

    resize();
    const start = () => { upload(); kick(); };
    if (img.complete && img.naturalWidth) start();
    else img.addEventListener("load", start, { once: true });

    return function cleanup() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      img.removeEventListener("load", start);
      canvas.remove();
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    };
  }

  window.SkyNebula = { mount };
})();
