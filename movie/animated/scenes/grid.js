// placeholder for the "grid" scene — replaced by the real scene
export async function create({ THREE }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 1000);
  camera.position.set(0, 0, 6);
  const mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.3, 200, 32),
    new THREE.MeshStandardMaterial({ color: 0x88aaff, emissive: 0x223366 }));
  scene.add(mesh, new THREE.AmbientLight(0xffffff, 0.3));
  const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(3, 4, 5); scene.add(light);
  return { scene, camera, update(t) { mesh.rotation.set(t * 0.3, t * 0.5, 0); } };
}
