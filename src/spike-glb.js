// spike-glb.js - 阶段0 spike：GLB 骨骼模型加入 helpersScene + AnimationMixer 播放
// 仅 ?spikeglb 时动态加载（独立 chunk，不进主包）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function init(sv) {
  const state = { mixer: null, scene: null };
  window.__SpikeGLB = {
    async loadGLB(b64) {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const loader = new GLTFLoader();
      const gltf = await new Promise((res, rej) => loader.parse(u8.buffer, '', res, rej));
      sv.helpersScene.add(gltf.scene);
      state.scene = gltf.scene;
      const mixer = new THREE.AnimationMixer(gltf.scene);
      state.mixer = mixer;
      if (gltf.animations.length) mixer.clipAction(gltf.animations[0]).play();
      window.__SpikeGLB.mixer = mixer;
      window.__SpikeGLB.scene = gltf.scene;
      return gltf.animations.map((a) => a.name);
    },
    update(dt) { if (state.mixer) state.mixer.update(dt); },
  };
  return true;
}
