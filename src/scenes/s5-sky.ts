// The sky as the rover's detector sees it, from Rocky's horizon scan (validation_rad.json: one skyline elevation per degree
// of azimuth, 0 = north, clockwise, from 1 m above the ground). Two ways to draw it:
//   dome(...)     a translucent hemisphere in the 3D scene, sky hidden by rock filled dark, the skyline as a crisp line
//   fisheye(...)  looking straight up: the real scene rendered into a cube map, unwrapped as an equidistant fisheye
import * as THREE from 'three';

/** Unit direction for azimuth (degrees from north, clockwise) and elevation (degrees). World: X east, Y up, Z south. */
export const dir = (az: number, el: number) => new THREE.Vector3(Math.sin(az * Math.PI / 180) * Math.cos(el * Math.PI / 180), Math.sin(el * Math.PI / 180), -Math.cos(az * Math.PI / 180) * Math.cos(el * Math.PI / 180));

const skylineTexture = (horizon: number[]) => {
  const t = new THREE.DataTexture(new Float32Array(horizon), horizon.length, 1, THREE.RedFormat, THREE.FloatType);
  t.wrapS = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
};
// shared GLSL: azimuth/elevation of a direction, and the skyline elevation there
const GLSL = `uniform sampler2D hz;
  float azOf(vec3 d) { return mod(degrees(atan(d.x, -d.z)) + 360., 360.); }
  float elOf(vec3 d) { return degrees(asin(clamp(d.y, -1., 1.))); }
  float skyline(float az) { return texture2D(hz, vec2((az + .5) / 360., .5)).r; }`;

export function dome(scene: THREE.Scene, centre: THREE.Vector3, radius: number, horizon: number[]) {
  const g = new THREE.Group(); g.position.copy(centre); scene.add(g);
  // drawn over the rock (depthTest off) so the blocked part shows against the walls that block it
  const shell = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false, uniforms: { hz: { value: skylineTexture(horizon) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `${GLSL} varying vec3 vP;
      void main(){ vec3 d = normalize(vP); float az = azOf(d), el = elOf(d);
        vec4 c = el < skyline(az) ? vec4(.16, .14, .13, .45) : vec4(1., .98, .95, .07);
        float we = fwidth(el), le = abs(fract(el / 15. + .5) - .5) * 15.;                      // lines of constant elevation every 15 degrees
        float k = cos(radians(el)), wa = min(fwidth(az), 2.) * k, la = abs(fract(az / 30. + .5) - .5) * 30. * k;   // and of constant azimuth every 30
        float line = max(1. - smoothstep(.0, 1.2 * we, le), el < 75. ? (1. - smoothstep(.0, 1.2 * wa, la)) * .7 : 0.);
        c = mix(c, vec4(1., 1., 1., .55), line);
        gl_FragColor = c;
        #include <colorspace_fragment>
      }`,
  }));
  shell.renderOrder = 10; g.add(shell);
  // the skyline itself, a thin tube on the dome
  const pts = horizon.map((h, az) => dir(az, Math.max(0, h)).multiplyScalar(radius * .995));
  const line = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 720, radius * .0035, 6, true), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, fog: false }));
  line.renderOrder = 11; g.add(line);
  return g;
}

/** Looking straight up from `eye`: north at the top, east on the left (as the sky is seen from below). Returns a draw function. */
export function fisheye(renderer: THREE.WebGLRenderer, scene: THREE.Scene, eye: THREE.Vector3, horizon: number[]) {
  const rt = new THREE.WebGLCubeRenderTarget(512), cube = new THREE.CubeCamera(.1, 60000, rt); cube.position.copy(eye); scene.add(cube);
  const mat = new THREE.ShaderMaterial({
    uniforms: { cube: { value: rt.texture }, hz: { value: skylineTexture(horizon) }, view: { value: new THREE.Vector3(1, 1, 1) } },
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `${GLSL} uniform samplerCube cube; uniform vec3 view; varying vec2 vU;
      void main(){ vec2 p = (vU - .5) * vec2(view.x, view.y) / view.z;          // view: width, height, circle radius (px)
        float r = length(p); if (r > 1.) { gl_FragColor = vec4(.07, .07, .075, 1.); return; }
        float el = 90. - r * 90., az = mod(degrees(atan(-p.x, p.y)) + 360., 360.);
        vec3 d = vec3(sin(radians(az)) * cos(radians(el)), sin(radians(el)), -cos(radians(az)) * cos(radians(el)));
        vec3 c = textureCube(cube, d).rgb;
        c = el < skyline(az) ? mix(c, vec3(.03, .03, .03), .55) : mix(c, vec3(1.), .45);
        gl_FragColor = vec4(c, 1.);
        #include <colorspace_fragment>
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat), fs = new THREE.Scene(), cam = new THREE.Camera(); fs.add(quad); quad.frustumCulled = false;
  let ready = false;
  /** Render the cube map once (the scene does not move); `hide` are objects left out of it. */
  const capture = (hide: THREE.Object3D[]) => { for (const o of hide) o.visible = false; cube.update(renderer, scene); for (const o of hide) o.visible = true; ready = true; };
  const draw = (w: number, h: number, radiusPx: number, hide: THREE.Object3D[]) => { if (!ready) capture(hide); mat.uniforms.view.value.set(w, h, radiusPx); renderer.render(fs, cam); };
  return { draw };
}
