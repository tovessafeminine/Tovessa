/* ============================================================
   TOVESSA — Three.js 3D Hero Animation
   Floating luxury particles + rotating ring
   ============================================================ */

(function initThree() {
  const canvas = document.getElementById('three-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  /* ── Scene Setup ── */
  const scene    = new THREE.Scene();
  const camera   = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 5;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);

  /* ── Lighting ── */
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const gold1 = new THREE.PointLight(0xc9a84c, 3, 14);
  gold1.position.set(3, 3, 3);
  scene.add(gold1);

  const gold2 = new THREE.PointLight(0xe2c97e, 1.5, 10);
  gold2.position.set(-3, -2, 2);
  scene.add(gold2);

  const white1 = new THREE.PointLight(0xf5f0e8, 1.2, 12);
  white1.position.set(0, 4, -2);
  scene.add(white1);

  const blush = new THREE.PointLight(0xa52d54, 0.9, 10);
  blush.position.set(-2, 3, 1.5);
  scene.add(blush);

  /* ── Materials ── */
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xc9a84c, metalness: 0.92, roughness: 0.12,
    envMapIntensity: 1.2
  });
  const goldDimMat = new THREE.MeshStandardMaterial({
    color: 0x7a5f2a, metalness: 0.88, roughness: 0.22
  });
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0xc9a84c, wireframe: true, opacity: 0.18, transparent: true
  });

  /* ── Main Torus Ring ── */
  const torusGeo  = new THREE.TorusGeometry(2.2, 0.04, 16, 120);
  const torus     = new THREE.Mesh(torusGeo, goldMat);
  torus.rotation.x = Math.PI * 0.38;
  scene.add(torus);

  /* ── Inner ring ── */
  const innerRingGeo = new THREE.TorusGeometry(1.55, 0.025, 12, 100);
  const innerRing    = new THREE.Mesh(innerRingGeo, goldDimMat);
  innerRing.rotation.x = Math.PI * 0.22;
  innerRing.rotation.y = Math.PI * 0.15;
  scene.add(innerRing);

  /* ── Icosahedron Centre ── */
  const icoGeo = new THREE.IcosahedronGeometry(0.42, 1);
  const ico    = new THREE.Mesh(icoGeo, goldMat);
  scene.add(ico);

  /* ── Wireframe Sphere ── */
  const wireSphGeo = new THREE.IcosahedronGeometry(1.85, 2);
  const wireSph    = new THREE.Mesh(wireSphGeo, wireMat);
  scene.add(wireSph);

  /* ── Floating Particles ── */
  const particleCount = 220;
  const positions = new Float32Array(particleCount * 3);
  const sizes     = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    const r = 2.5 + Math.random() * 2.8;
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    sizes[i] = 1.2 + Math.random() * 2.8;
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeo.setAttribute('size',     new THREE.BufferAttribute(sizes, 1));
  const particleMat = new THREE.PointsMaterial({
    color: 0xc9a84c, size: 0.025,
    transparent: true, opacity: 0.65,
    sizeAttenuation: true
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  /* ── Small orbiting diamonds ── */
  const orbiters = [];
  for (let i = 0; i < 6; i++) {
    const geo  = new THREE.OctahedronGeometry(0.06 + Math.random() * 0.06, 0);
    const mesh = new THREE.Mesh(geo, goldMat);
    const ang  = (i / 6) * Math.PI * 2;
    mesh.userData = { angle: ang, radius: 2.15 + Math.random() * 0.3, speed: 0.005 + Math.random() * 0.006, tilt: Math.random() * Math.PI };
    scene.add(mesh);
    orbiters.push(mesh);
  }

  /* ── Mouse Parallax ── */
  let mouseX = 0, mouseY = 0;
  document.addEventListener('mousemove', e => {
    mouseX = (e.clientX / window.innerWidth  - 0.5) * 0.8;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 0.5;
  });

  /* ── Resize ── */
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /* ── Animation Loop ── */
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    torus.rotation.y     = t * 0.18;
    torus.rotation.z     = t * 0.06;
    innerRing.rotation.y = -t * 0.24;
    innerRing.rotation.z = t * 0.08;
    ico.rotation.x       = t * 0.35;
    ico.rotation.y       = t * 0.28;
    wireSph.rotation.x   = t * 0.07;
    wireSph.rotation.y   = -t * 0.05;
    particles.rotation.y = t * 0.04;

    ico.position.y = Math.sin(t * 0.7) * 0.08;

    orbiters.forEach(o => {
      o.userData.angle += o.userData.speed;
      const a = o.userData.angle, r = o.userData.radius, tilt = o.userData.tilt;
      o.position.x = r * Math.cos(a);
      o.position.y = r * Math.sin(a) * Math.sin(tilt) * 0.45;
      o.position.z = r * Math.sin(a) * Math.cos(tilt) * 0.55;
      o.rotation.x = t * 1.2;
      o.rotation.z = t * 0.8;
    });

    /* light animation */
    gold1.position.x = Math.sin(t * 0.4) * 4;
    gold1.position.y = Math.cos(t * 0.3) * 3;
    blush.position.x = Math.cos(t * 0.25) * 3.5;
    blush.position.z = Math.sin(t * 0.25) * 2.5;

    /* camera parallax */
    camera.position.x += (mouseX - camera.position.x) * 0.04;
    camera.position.y += (-mouseY - camera.position.y) * 0.04;
    camera.lookAt(scene.position);

    renderer.render(scene, camera);
  }
  animate();
})();
