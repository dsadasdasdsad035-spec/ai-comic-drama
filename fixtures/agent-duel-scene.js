// 固定验收场景：山体、男女双剑对打、相机环绕并始终看向两人中点。
let S;
let man;
let woman;
let swordM;
let swordW;
let clash;

function init(ctx) {
  S = ctx;
  S.scene.background = new THREE.Color(0x8fa6ad);
  S.scene.fog = new THREE.Fog(0x8fa6ad, 16, 34);

  const ground = new THREE.Mesh(
    new THREE.CylinderGeometry(18, 18, 0.5, 48),
    new THREE.MeshStandardMaterial({ color: 0x42564a, roughness: 0.95 })
  );
  ground.position.y = -0.25;
  S.scene.add(ground);

  // 三座远山围住场地，保证环绕到任意角度都能看到山体背景。
  const mountainMat = new THREE.MeshStandardMaterial({ color: 0x3c4d45, roughness: 1 });
  const mountainPositions = [
    [0, 3.8, -16, 9, 9],
    [-15, 3.2, -7, 7, 8],
    [15, 3.0, -6, 7, 7.5],
  ];
  for (const [x, y, z, radius, height] of mountainPositions) {
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 9), mountainMat);
    mountain.position.set(x, y, z);
    S.scene.add(mountain);
  }

  man = new THREE.Group();
  woman = new THREE.Group();
  const bodyM = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.24, 1.05, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x2f5d8a, roughness: 0.7 })
  );
  const bodyW = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.21, 0.98, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0xb85c7a, roughness: 0.7 })
  );
  man.add(bodyM);
  woman.add(bodyW);

  const headMat = new THREE.MeshStandardMaterial({ color: 0xd6b08c, roughness: 0.8 });
  const headM = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), headMat);
  const headW = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), headMat);
  headM.position.y = 0.82;
  headW.position.y = 0.78;
  man.add(headM);
  woman.add(headW);
  man.position.set(-0.72, 0.82, 0);
  woman.position.set(0.72, 0.82, 0);
  man.rotation.y = 0.45;
  woman.rotation.y = -0.45;
  S.scene.add(man, woman);

  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xd9e2e8, metalness: 0.85, roughness: 0.25 });
  const hiltMat = new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.9 });
  const makeSword = () => {
    const group = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.2, 0.035), bladeMat);
    blade.position.y = 0.62;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.08), hiltMat);
    guard.position.y = 0.05;
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.24, 8), hiltMat);
    hilt.position.y = -0.1;
    group.add(blade, guard, hilt);
    return group;
  };
  swordM = makeSword();
  swordW = makeSword();
  swordM.position.set(-0.16, 0.42, 0.18);
  swordW.position.set(0.16, 0.42, 0.18);
  swordM.rotation.z = -1.05;
  swordW.rotation.z = 1.05;
  man.add(swordM);
  woman.add(swordW);

  clash = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd166 })
  );
  clash.position.set(0, 1.12, 0.2);
  S.scene.add(clash);

  S.scene.add(new THREE.HemisphereLight(0xf3f7ff, 0x26332d, 2.4));
  const key = new THREE.DirectionalLight(0xfff2d8, 2.6);
  key.position.set(5, 9, 6);
  S.scene.add(key);

  S.camera.position.set(8, 3.2, 8);
  S.camera.lookAt(0, 0.85, 0);
}

function renderAt(t) {
  if (!S) return;
  const duration = S.duration || 4;
  const p = Math.min(1, Math.max(0, t / duration));
  const angle = -0.7 + p * 2.1;
  S.camera.position.set(Math.cos(angle) * 8, 3.2, Math.sin(angle) * 8);
  S.camera.lookAt(0, 0.85, 0);

  const swing = Math.sin(t * 5.2);
  man.position.set(-0.72 + swing * 0.08, 0.82, 0);
  woman.position.set(0.72 - swing * 0.08, 0.82, 0);
  man.rotation.y = 0.45 + swing * 0.12;
  woman.rotation.y = -0.45 - swing * 0.12;
  swordM.rotation.z = -1.05 + swing * 0.12;
  swordW.rotation.z = 1.05 - swing * 0.12;
  clash.position.set(swing * 0.04, 1.12 + swing * 0.04, 0.2);
  clash.scale.setScalar(0.8 + Math.abs(swing) * 0.5);
}

function dispose() {}
