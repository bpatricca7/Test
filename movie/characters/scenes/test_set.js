// temporary: baseline cost
export async function create(env) {
  const { THREE, renderer } = env;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  const s2 = new THREE.Scene();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), new THREE.MeshBasicMaterial({ color: 0x808080 }));
  m.position.z = -2; s2.add(m);
  const rt = new THREE.WebGLRenderTarget(1920, 1080, { type: THREE.HalfFloatType });
  let log = [];
  return { scene, camera, update(t) {
    if (t >= 1) {
      const gl = renderer.getContext(); const px = new Uint8Array(4);
      const a = performance.now();
      for (let i = 0; i < 5; i++) { renderer.setRenderTarget(rt); renderer.render(s2, camera); }
      renderer.setRenderTarget(null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      console.warn('5x basic fullscreen into halffloat RT: ' + (performance.now() - a).toFixed(0));
    }
  } };
}
