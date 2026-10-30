// Vendored from @dgreenheck/ez-tree 1.1.0 (MIT), trimmed: only the oak and
// pine bark and leaves, loaded by URL next to this file (no bundler). Other
// bark and leaf types fall back to oak.
import * as THREE from 'three';

const textureLoader = new THREE.TextureLoader();
const at = (f) => new URL(`./assets/${f}`, import.meta.url).href;

const loadTexture = (url, srgb = true) => {
  const texture = textureLoader.load(url);
  texture.premultiplyAlpha = true;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const bark = (k) => ({
  ao: loadTexture(at(`bark/${k}_ao_1k.jpg`), false),
  color: loadTexture(at(`bark/${k}_color_1k.jpg`)),
  normal: loadTexture(at(`bark/${k}_normal_1k.jpg`), false),
  roughness: loadTexture(at(`bark/${k}_roughness_1k.jpg`), false),
});
const textures = {
  bark: { oak: bark('oak'), pine: bark('pine') },
  leaves: { oak: loadTexture(at('leaves/oak_color.png')), pine: loadTexture(at('leaves/pine_color.png')) },
};

export function getBarkTexture(barkType, fileType, scale = { x: 1, y: 1 }) {
  const texture = (textures.bark[barkType] || textures.bark.oak)[fileType];
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.x = scale.x;
  texture.repeat.y = 1 / scale.y;
  return texture;
}

export function getLeafTexture(leafType) {
  return textures.leaves[leafType] || textures.leaves.oak;
}
