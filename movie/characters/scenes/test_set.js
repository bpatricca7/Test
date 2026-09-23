// temporary lighting-cost benchmark
export async function create(env) {
  const { THREE } = env;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  camera.position.set(0, 1.3, 3);
  camera.lookAt(0, 1.3, 0);
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d'); for (let i = 0; i < 64; i++) { x.fillStyle = `hsl(${i * 7},40%,50%)`; x.fillRect((i % 8) * 64, Math.floor(i / 8) * 64, 64, 64); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mats = [
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }),
    new THREE.MeshLambertMaterial({ map: tex }),
    new THREE.MeshPhongMaterial({ map: tex, shininess: 20 }),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, bumpMap: tex, bumpScale: 1 }),
    new THREE.MeshBasicMaterial({ map: tex }),
  ];
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), mats[0]);
  wall.position.set(0, 1.3, -0.5); wall.receiveShadow = true;
  scene.add(wall);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mats[0]); box.position.set(0, 1.2, 0.2); box.castShadow = true; scene.add(box);
  const spot1 = new THREE.SpotLight(0xffaa66, 20, 0, 0.9, 0.6, 2); spot1.position.set(0.5, 2.5, 1.5); spot1.target.position.set(0, 1, 0); spot1.castShadow = true; spot1.shadow.mapSize.set(1024, 1024);
  const spot2 = new THREE.SpotLight(0x66ccff, 5, 0, 1.0, 1, 2); spot2.position.set(-1, 1.2, 1.5);
  const spot3 = new THREE.SpotLight(0xff2222, 5, 0, 0.5, 0.5, 2); spot3.position.set(1, 2, 1);
  const p1 = new THREE.PointLight(0xffaa66, 2, 0, 2); p1.position.set(1, 2, 1);
  const p2 = new THREE.PointLight(0x33ffff, 2, 0, 2); p2.position.set(-1, 1, 1);
  const p3 = new THREE.PointLight(0x33ffff, 2, 0, 2); p3.position.set(0, 1, 1);
  const hemi = new THREE.HemisphereLight(0x223344, 0x111111, 0.5);
  const all = [spot1, spot2, spot3, p1, p2, p3];
  scene.add(spot1, spot1.target, spot2, spot3, p1, p2, p3, hemi);
  return { scene, camera, update(t) {
    const m = Math.floor(t) % 10;       // material
    const nl = Math.floor(t / 10);      // lights mode: 0 = all 6, 1 = 3 (spots only), 2 = hemi only, 3 = all but no shadow
    wall.material = mats[m] || mats[0];
    all.forEach((l, i) => { l.visible = nl === 0 || nl === 3 || (nl === 1 && i < 3); });
    spot1.castShadow = nl !== 3;
  } };
}
