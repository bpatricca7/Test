export async function create({ THREE, renderer, W, H }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 1000);
  camera.position.set(0, 0, 6);
  const mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.3, 200, 32),
    new THREE.MeshStandardMaterial({ color: 0x88aaff, emissive: 0x223366 }));
  scene.add(mesh, new THREE.AmbientLight(0xffffff, 0.3));
  const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(3, 4, 5); scene.add(light);
  const samples = +(new URLSearchParams(location.search).get('s') || 4);
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  const qs = new THREE.Scene();
  const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { tex: { value: rt.texture } }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: 'uniform sampler2D tex; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tex, vUv); }',
  }));
  q.frustumCulled = false; qs.add(q);
  const MS = true;
  return { scene: MS ? qs : scene, camera: MS ? qc : camera, update(t) {
    mesh.rotation.set(t * 0.3, t * 0.5, 0);
    if (MS) { renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null); }
  } };
}
