// placeholder until the director's film.js lands
export async function create({ THREE }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.05, 200);
  camera.position.set(0, 1.4, 3);
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshNormalMaterial()));
  return { scene, camera, update(t) { scene.children[0].rotation.y = t; } };
}
