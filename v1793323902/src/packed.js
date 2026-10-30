// Materials drawn with our scanned textures (tools/import_textures.py), whose
// normal map carries the surface's roughness in its blue channel: the
// normal's z is rebuilt from x and y, and the roughness read from blue (times
// the material's own roughness, so 1 keeps the scan's).

const MAP_N = 'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;';

export function packedNormal(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace(MAP_N, 'vec3 mapN = vec3(texture2D( normalMap, vNormalMapUv ).xy * 2.0 - 1.0, 0.0); mapN.z = sqrt(max(0.0, 1.0 - dot(mapN.xy, mapN.xy)));')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * texture2D( normalMap, vNormalMapUv ).b, 0.04, 1.0);');
  };
  mat.customProgramCacheKey = () => 'packedNormal';
  return mat;
}
