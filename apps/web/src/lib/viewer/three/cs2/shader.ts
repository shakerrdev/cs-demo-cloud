import { skinPaintGlsl } from './skin-paint';

export const MAX_PROBE_VOLUMES = 128;
export const MAX_ENV_VOLUMES = 128;
export const ENV_VOLUME_TEXELS = 7;

export const vertexShader = /* glsl */ `
in vec4 tangent;
#ifdef LIGHTMAP_ATTR
in vec2 LIGHTMAP_ATTR;
#endif
#ifdef UV2_ATTR
in vec2 UV2_ATTR;
#endif
#ifdef PAINT_ATTR
in vec4 PAINT_ATTR;
#endif
#ifdef BLEND_ATTR
in vec4 BLEND_ATTR;
#endif

uniform mat3 uUvTransform;
uniform vec2 uUvScroll;
uniform float uTime;
uniform vec3 uSkyOrigin;
uniform float uWorldScale;

out vec3 vPosition;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vTangent;
out vec3 vBitangent;
out vec2 vUv;
out vec2 vUv2;
#ifdef LIGHTMAP
centroid out vec2 vLightmapUv;
#endif
#ifdef PAINT_ATTR
out vec4 vPaint;
#endif
#ifdef BLEND_ATTR
out vec4 vBlend;
#endif

#include <skinning_pars_vertex>

void main() {
	vec3 transformed = position;
	vec3 objectNormal = normal;
	vec3 objectTangent = tangent.xyz;
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <skinning_vertex>
#ifdef USE_SKINNING
	objectTangent = (skinMatrix * vec4(objectTangent, 0.0)).xyz;
#endif
	vec4 world = modelMatrix * vec4(transformed, 1.0);
	vPosition = world.xyz;
	vWorld = (world.xyz - uSkyOrigin) * uWorldScale;
	mat3 normalToWorld = mat3(modelMatrix);
	vNormal = normalize(normalToWorld * objectNormal);
	vTangent = normalize(normalToWorld * objectTangent);
	vBitangent = tangent.w * cross(vNormal, vTangent);
	vUv = (uUvTransform * vec3(uv, 1.0)).xy + uUvScroll * uTime;
#ifdef UV2_ATTR
	vUv2 = UV2_ATTR;
#else
	vUv2 = uv;
#endif
#ifdef LIGHTMAP
	vLightmapUv = LIGHTMAP_ATTR;
#endif
#ifdef PAINT_ATTR
	vPaint = PAINT_ATTR;
#endif
#ifdef BLEND_ATTR
	vBlend = BLEND_ATTR;
#endif
	gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler2DArray;

in vec3 vPosition;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vTangent;
in vec3 vBitangent;
in vec2 vUv;
in vec2 vUv2;
#ifdef LIGHTMAP
centroid in vec2 vLightmapUv;
#endif
#ifdef PAINT_ATTR
in vec4 vPaint;
#endif
#ifdef BLEND_ATTR
in vec4 vBlend;
#endif

uniform vec3 uCameraWorld;
uniform float uCutZ;
uniform float uWorldScale;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec4 uSunShadowMask;
uniform float uSunSpecular;
uniform vec3 uAmbientSky;
uniform vec3 uAmbientGround;

uniform sampler2D uColor;
uniform sampler2D uNormal;
uniform sampler2D uAO;
uniform sampler2D uMetal;
uniform sampler2D uTintMask;
uniform sampler2D uColor2;
uniform sampler2D uNormal2;
uniform sampler2D uBlendMod;
uniform sampler2D uDetail;
uniform sampler2D uDetailMask;
uniform sampler2D uSelfIllumMask;
uniform sampler2D uMask1;
uniform sampler2D uMask2;
uniform sampler2D uMask3;
uniform sampler2D uTransmissive;

uniform vec3 uTint;
uniform float uMetalness;
uniform float uAlphaRef;
uniform float uOpacity;
uniform float uBumpStrength;
uniform float uBlendSoftness;
uniform vec2 uLayer2Scale;
uniform mat3 uDetailTransform;
uniform vec3 uDetailBlend;
uniform vec4 uSelfIllum;
uniform vec3 uSelfIllumTint;
uniform vec4 uMaskScales;
uniform vec4 uMaskScroll;
uniform vec4 uMask3Scale;
uniform vec4 uEffect;
uniform vec4 uEffectFresnel;
uniform float uTime;
uniform float uVertexAo;
uniform float uEffectFade;

#ifdef LIGHTMAP
uniform sampler2D uIrradiance;
uniform sampler2D uDirectional;
uniform sampler2D uShadows;
#endif

#ifdef SKIN_PAINT
${skinPaintGlsl}
#endif

#ifdef PROBES
uniform sampler2DArray uProbeIrradiance;
uniform sampler2DArray uProbeShadows;
uniform sampler2D uProbeVolumes;
uniform int uProbeCount;
uniform float uProbeDepth;
#endif

#ifdef ENV_MAP
uniform sampler2DArray uEnvMap;
uniform sampler2D uEnvVolumes;
uniform int uEnvCount;
uniform float uEnvMips;
#endif

#ifdef FOG_CUBE
uniform samplerCube uFogCube;
uniform vec4 uFogDistance;
uniform vec4 uFogHeight;
uniform vec4 uFogMisc;
uniform mat3 uFogRotation;
#endif
#ifdef FOG_GRADIENT
uniform vec4 uGradientBiasScale;
uniform vec2 uGradientExponents;
uniform vec4 uGradientColor;
uniform vec2 uGradientCull;
#endif

out vec4 outColor;

float saturate1(float x) { return clamp(x, 0.0, 1.0); }

vec3 decodeNormal(vec2 rg) {
	vec2 t = vec2(rg.x + rg.y - 1.003922, rg.x - rg.y);
	vec3 n = normalize(vec3(t, 1.0 - abs(t.x) - abs(t.y)));
	n.y = -n.y;
	return n;
}

vec3 srgbToLinear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

vec3 linearToSrgb(vec3 c) {
	c = max(c, vec3(0.0));
	return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

float blendModulation(float factor, float mask, float softness) {
	float lo = max(0.0, mask - softness);
	float hi = min(1.0, mask + softness);
	return smoothstep(lo, hi, factor);
}

#ifdef LIGHTMAP
vec3 lightmapShading(vec3 irradiance, vec4 direction, vec3 normalTs, vec3 geometricNormal) {
	const float minZ = 0.0872;
	const float maxXy = 0.99619;
	vec2 xy = direction.xy * 2.0 - 1.0;
	xy *= maxXy / max(maxXy, length(xy));
	float sinTheta = dot(xy, xy);
	float cosTheta = sqrt(max(0.0, 1.0 - sinTheta));
	float curvature = length(fwidth(geometricNormal)) / max(length(fwidth(vPosition)), 1e-6);
	float flatness = smoothstep(0.1, 0.01, curvature) * 0.8;
	float zScale = mix(1.0, mix(0.1, 2.0, saturate1((1.0 - cosTheta) * 1.5)), flatness);
	vec3 lightTs = normalize(vec3(xy, cosTheta * zScale));
	vec3 nonDirectional = irradiance * saturate1(direction.z);
	float nDotL = max(dot(lightTs, normalTs), 0.0);
	float lightZ = max(lightTs.z, 0.05);
	return nDotL * (irradiance - nonDirectional) / lightZ + nonDirectional;
}
#endif

#ifdef PROBES
vec4 sampleProbe(sampler2DArray atlas, vec3 texel, float layerOffset) {
	vec2 size = vec2(textureSize(atlas, 0).xy);
	vec2 uv = texel.xy / size;
	float z = texel.z - 0.5;
	float z0 = floor(z);
	float f = z - z0;
	vec4 a = texture(atlas, vec3(uv, z0 + layerOffset));
	vec4 b = texture(atlas, vec3(uv, z0 + 1.0 + layerOffset));
	return mix(a, b, f);
}

void probeLighting(vec3 position, vec3 normal, out vec3 irradiance, out vec4 shadows, out float coverage) {
	irradiance = vec3(0.0);
	shadows = vec4(0.0);
	coverage = 0.0;
	vec3 normalSquared = normal * normal;
	for (int i = 0; i < ${MAX_PROBE_VOLUMES}; i++) {
		if (i >= uProbeCount || coverage > 0.99) break;
		vec4 r0 = texelFetch(uProbeVolumes, ivec2(i * 6, 0), 0);
		vec4 r1 = texelFetch(uProbeVolumes, ivec2(i * 6 + 1, 0), 0);
		vec4 r2 = texelFetch(uProbeVolumes, ivec2(i * 6 + 2, 0), 0);
		vec3 local = vec3(dot(r0, vec4(position, 1.0)), dot(r1, vec4(position, 1.0)), dot(r2, vec4(position, 1.0)));
		if (any(lessThan(local, vec3(0.0))) || any(greaterThan(local, vec3(1.0)))) continue;
		vec3 invEdge = texelFetch(uProbeVolumes, ivec2(i * 6 + 3, 0), 0).xyz;
		vec3 fade = clamp(min(local, 1.0 - local) * invEdge, 0.0, 1.0);
		float weight = smoothstep(0.0, 1.0, min(fade.x, min(fade.y, fade.z))) * (1.0 - coverage);
		if (weight <= 0.0) continue;
		vec3 size = texelFetch(uProbeVolumes, ivec2(i * 6 + 4, 0), 0).xyz;
		vec3 offset = texelFetch(uProbeVolumes, ivec2(i * 6 + 5, 0), 0).xyz;
		vec3 texel = clamp(local, 0.5 / size, 1.0 - 0.5 / size) * size + offset;
		vec3 cube = vec3(0.0);
		for (int axis = 0; axis < 3; axis++) {
			float block = normal[axis] >= 0.0 ? float(axis) : float(axis + 3);
			cube += sampleProbe(uProbeIrradiance, texel, block * uProbeDepth).rgb * normalSquared[axis];
		}
		irradiance += cube * weight;
		#ifdef PROBE_SHADOWS
		shadows += sampleProbe(uProbeShadows, texel, 0.0) * weight;
		#endif
		coverage += weight;
	}
}
#endif

#ifdef ENV_MAP
vec3 sampleCubeArray(vec3 dir, float layer, float lod) {
	vec3 a = abs(dir);
	float face;
	float major;
	vec2 st;
	if (a.x >= a.y && a.x >= a.z) {
		major = a.x;
		face = dir.x > 0.0 ? 0.0 : 1.0;
		st = vec2(dir.x > 0.0 ? -dir.z : dir.z, -dir.y);
	} else if (a.y >= a.z) {
		major = a.y;
		face = dir.y > 0.0 ? 2.0 : 3.0;
		st = vec2(dir.x, dir.y > 0.0 ? dir.z : -dir.z);
	} else {
		major = a.z;
		face = dir.z > 0.0 ? 4.0 : 5.0;
		st = vec2(dir.z > 0.0 ? dir.x : -dir.x, -dir.y);
	}
	vec2 uv = st / max(major, 1e-6) * 0.5 + 0.5;
	return textureLod(uEnvMap, vec3(uv, layer * 6.0 + face), lod).rgb;
}

vec4 envTexel(int volume, int row) {
	return texelFetch(uEnvVolumes, ivec2(volume * ${ENV_VOLUME_TEXELS} + row, 0), 0);
}

vec3 environment(vec3 position, vec3 reflection, float lod, out vec4 normalizationSh) {
	vec3 env = vec3(0.0);
	vec4 sh = vec4(0.0);
	float total = 0.01;
	for (int i = 0; i < ${MAX_ENV_VOLUMES}; i++) {
		if (i >= uEnvCount || total > 0.99) break;
		vec4 r0 = envTexel(i, 0);
		vec4 r1 = envTexel(i, 1);
		vec4 r2 = envTexel(i, 2);
		vec3 local = vec3(dot(r0, vec4(position, 1.0)), dot(r1, vec4(position, 1.0)), dot(r2, vec4(position, 1.0)));
		if (any(lessThan(local, vec3(0.0))) || any(greaterThan(local, vec3(1.0)))) continue;
		vec4 minIndex = envTexel(i, 3);
		vec4 sizeBox = envTexel(i, 4);
		vec3 direction = vec3(dot(r0.xyz, reflection), dot(r1.xyz, reflection), dot(r2.xyz, reflection));
		float weight = 1.0;
		if (sizeBox.w > 0.5) {
			vec3 fade = clamp(min(local, 1.0 - local) * envTexel(i, 5).xyz, 0.0, 1.0);
			float edge = min(fade.x, min(fade.y, fade.z));
			if (edge <= 0.0) continue;
			weight = edge * edge * (3.0 - 2.0 * edge) * (1.0 - total);
			vec3 far = max((vec3(0.0) - local) / direction, (vec3(1.0) - local) / direction);
			float distance = min(far.x, min(far.y, far.z));
			direction = minIndex.xyz + (local + direction * distance) * sizeBox.xyz;
		} else {
			direction *= sizeBox.xyz;
		}
		total += weight;
		env += sampleCubeArray(normalize(direction), minIndex.w, lod) * weight;
		sh += envTexel(i, 6) * weight;
	}
	normalizationSh = sh / max(total, 1e-4);
	return env;
}

vec2 envBrdf(float roughness, float nDotV) {
	const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
	const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
	vec4 r = roughness * c0 + c1;
	float a004 = min(r.x * r.x, exp2(-9.28 * nDotV)) * r.x + r.y;
	return vec2(-1.04, 1.04) * a004 + r.zw;
}
#endif

vec3 sunSpecular(vec3 n, vec3 v, vec3 l, float roughness, vec3 f0) {
	vec3 h = normalize(v + l);
	float nDotL = saturate1(dot(n, l));
	float nDotH = saturate1(dot(n, h));
	float nDotV = saturate1(dot(n, v));
	float vDotH = saturate1(dot(l, h));
	float alpha = max(roughness * roughness, 1e-4);
	float k = min(alpha / (1.0 - nDotH * nDotH + (nDotH * alpha) * (nDotH * alpha)), 453.5);
	float d = k * k;
	float visRough = (roughness + 1.0) * (roughness + 1.0) / 8.0;
	float vis = 1.0 / (4.0 * max((nDotL * (1.0 - visRough) + visRough) * (nDotV * (1.0 - visRough) + visRough), 1e-4));
	vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - vDotH, 5.0);
	return d * vis * nDotL * fresnel;
}

vec3 applyFog(vec3 color) {
	vec3 relative = vWorld - uCameraWorld;
#ifdef FOG_GRADIENT
	if (dot(relative.xy, relative.xy) > uGradientCull.x || vWorld.z > uGradientCull.y) {
		vec2 parts = vec2(length(relative), vWorld.z);
		parts = pow(clamp(parts * uGradientBiasScale.zw + uGradientBiasScale.xy, 0.0001, 1.0), uGradientExponents);
		color = mix(color, uGradientColor.rgb, parts.x * parts.y * uGradientColor.a);
	}
#endif
#ifdef FOG_CUBE
	if (dot(relative, relative) > uFogMisc.x || vWorld.z > uFogMisc.y) {
		float distancePart = pow(max(length(relative.xy) * uFogDistance.y + uFogDistance.x, 0.0001), uFogDistance.w);
		float heightPart = pow(max(vWorld.z * uFogHeight.y + uFogHeight.x, 0.0001), uFogHeight.z);
		float blend = saturate1(distancePart) * saturate1(heightPart);
		float lod = saturate1(1.0 - blend * uFogDistance.z) * uFogHeight.w;
		vec3 fogColor = textureLod(uFogCube, uFogRotation * normalize(relative), lod).rgb * uFogMisc.z;
		color = mix(color, fogColor, saturate1(blend) * uFogMisc.w);
	}
#endif
	return color;
}

void main() {
	if (vWorld.z > uCutZ) discard;

	vec2 uv = vUv;
	vec4 color = texture(uColor, uv);

#ifdef EFFECTS
	float m1 = texture(uMask1, vUv * uMaskScales.xy + uMaskScroll.xy * uTime).r;
	float m2 = texture(uMask2, vUv * uMaskScales.zw + uMaskScroll.zw * uTime).r;
	float m3 = texture(uMask3, vUv * uMask3Scale.xy + uMask3Scale.zw * uTime).r;
	#ifdef PAINT_ATTR
	vec4 vertexColor = vPaint;
	#else
	vec4 vertexColor = vec4(1.0);
	#endif
	float effectOpacity = color.a * vertexColor.a * uOpacity * m1 * m2 * m3;
	vec3 ray = vWorld - uCameraWorld;
	vec3 effectNormal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
	float fresnel = clamp(dot(-normalize(ray), effectNormal), 0.0001, 1.0);
	fresnel = saturate1(pow(fresnel, uEffectFresnel.x) * uEffectFresnel.y);
	fresnel = mix(uEffectFresnel.z, uEffectFresnel.w, fresnel);
	float fade = saturate1(length(ray) / max(uEffect.y, 1e-3));
	fade = pow(max(mix(uEffect.z, uEffect.w, fade), 0.0), uEffectFade);
	effectOpacity *= fresnel * fade;
	vec3 effectColor = color.rgb * vertexColor.rgb * uTint * uEffect.x;
	outColor = vec4(applyFog(effectColor), effectOpacity);
	return;
#endif
#ifdef NORMAL_MAP
	vec4 normalTex = texture(uNormal, uv);
#else
	vec4 normalTex = vec4(0.5, 0.5, 1.0, 1.0);
#endif
#ifdef SKIN_PAINT
	vec2 patternUv = (uPatternTransform * vec3(vUv, 1.0)).xy;
	#ifdef SKIN_PAINT_NORMAL
	normalTex.rg = texture(uPaintNormal, patternUv).rg;
	#endif
#endif

#ifdef LAYERS
	vec2 uvB = uv * uLayer2Scale;
	vec4 color2 = texture(uColor2, uvB);
	vec4 normalTex2 = texture(uNormal2, uvB);
	float blendFactor = vBlend.r;
	#if FANCY_BLENDING == 1
	vec4 modTexel = texture(uBlendMod, uvB);
	blendFactor = blendModulation(blendFactor, modTexel.g, modTexel.r);
	#elif FANCY_BLENDING == 2
	blendFactor = blendModulation(blendFactor, texture(uBlendMod, uvB).g, uBlendSoftness);
	#elif FANCY_BLENDING == 3
	blendFactor = blendModulation(blendFactor, texture(uBlendMod, uvB).a, uBlendSoftness);
	#endif
	color = mix(color, color2, blendFactor);
	normalTex = mix(normalTex, normalTex2, blendFactor);
#endif

	vec3 albedo = color.rgb;
	float opacity = color.a;

#ifdef PAINT_MULTIPLY
	vec4 paint = dot(vPaint, vec4(1.0)) > 0.0 ? vPaint : vec4(1.0);
	albedo *= paint.rgb;
	opacity *= paint.a;
#endif

#if defined(TRANSLUCENT) || defined(ALPHA_TEST)
	opacity *= uOpacity;
#else
	opacity = 1.0;
#endif
#ifdef ALPHA_TEST
	if (opacity < uAlphaRef) discard;
#endif

#ifndef NO_TINT
	vec3 tint = uTint;
	#ifdef TINT_MASK
	tint = 1.0 - texture(uTintMask, TINT_UV).r * (1.0 - tint);
	#endif
	albedo *= tint;
#endif

#ifdef MOD2X
	outColor = vec4(mix(vec3(0.5), linearToSrgb(albedo), opacity), 1.0);
	return;
#endif

#ifdef UNLIT
	vec3 unlitColor = albedo;
	outColor = vec4(applyFog(unlitColor), opacity);
	return;
#endif

	vec3 normalTs = decodeNormal(normalTex.rg);
	normalTs = normalize(mix(vec3(0.0, 0.0, 1.0), normalTs, uBumpStrength));
	float roughness = ROUGHNESS;

#if DETAIL > 0
	vec2 detailUv = (uDetailTransform * vec3(DETAIL_UV, 1.0)).xy;
	float detailMask = texture(uDetailMask, DETAIL_MASK_UV).r;
	detailMask = uDetailBlend.x * max(detailMask, uDetailBlend.y);
	#if DETAIL == 1
	albedo *= mix(vec3(1.0), texture(uDetail, detailUv).rgb * 1.9922, detailMask);
	#elif DETAIL == 2 || DETAIL == 4
	vec3 detailColor = 0.9961 * texture(uDetail, detailUv).rgb;
	vec3 gammaAlbedo = linearToSrgb(albedo);
	vec3 screenBlend = 1.0 - (1.0 - detailColor) * (1.0 - gammaAlbedo) * 2.0;
	vec3 multiplyBlend = detailColor * gammaAlbedo * 2.0;
	albedo = mix(albedo, srgbToLinear(mix(multiplyBlend, screenBlend, step(vec3(0.5), gammaAlbedo))), detailMask);
	#endif
#endif

	vec3 geometricNormal = normalize(vNormal);
	if (!gl_FrontFacing) geometricNormal = -geometricNormal;
	vec3 tangent = normalize(vTangent);
	vec3 bitangent = normalize(vBitangent);
	vec3 normal = normalize(mat3(tangent, bitangent, geometricNormal) * normalTs);

	float metalness = uMetalness;
#ifdef METAL_TEXTURE
	metalness = texture(uMetal, vUv).g;
#endif
#ifdef METAL_IN_ALPHA
	metalness = color.a;
#endif

	float ao = 1.0;
#ifdef AO_TEXTURE
	ao = texture(uAO, AO_UV).r;
#endif
#ifdef VERTEX_AO
	ao *= mix(1.0, clamp(vPaint.w, 0.001, 1.0), uVertexAo);
#endif

#ifdef SKIN_PAINT
	skinPaint(vUv, patternUv, albedo, roughness, metalness);
#endif

	vec3 diffuseColor = albedo * (1.0 - metalness);
	vec3 specularColor = mix(vec3(0.04), albedo, metalness);
	vec3 view = normalize(uCameraWorld - vWorld);

	vec3 indirect = uAmbientSky;
	float specularOcclusion = 1.0;
	vec4 shadowTexel = vec4(0.0);

#ifdef LIGHTMAP
	vec3 irradiance = texture(uIrradiance, vLightmapUv).rgb;
	vec4 direction = texture(uDirectional, vLightmapUv);
	indirect = lightmapShading(irradiance, direction, normalTs, geometricNormal);
	specularOcclusion = direction.a;
	shadowTexel = textureLod(uShadows, vLightmapUv, 0.0);
#elif defined(PROBES)
	vec3 probeIrradiance;
	float coverage;
	probeLighting(vPosition, normal, probeIrradiance, shadowTexel, coverage);
	vec3 sky = mix(uAmbientGround, uAmbientSky, normal.z * 0.5 + 0.5);
	indirect = probeIrradiance + sky * (coverage < 0.99 ? 1.0 - coverage : 0.0);
#endif

	float sunVisibility = saturate1(1.0 - dot(shadowTexel, uSunShadowMask));
	vec3 sunLight = uSunColor * sunVisibility;
	float nDotL = max(dot(normal, uSunDir), 0.0);
	vec3 directDiffuse = nDotL * sunLight;
	vec3 directSpecular = sunSpecular(normal, view, uSunDir, roughness, specularColor) * sunLight * uSunSpecular;

	vec3 transmissive = vec3(0.0);
#ifdef TRANSMISSIVE
	transmissive = max(-dot(normal, uSunDir), 0.0) * sunLight * TRANSMISSIVE_COLOR;
#endif

	vec3 indirectSpecular = vec3(0.0);
#ifdef ENV_MAP
	float nDotV = saturate1(dot(normal, view));
	vec2 brdf = envBrdf(roughness, nDotV);
	vec3 singleScatter = specularColor * brdf.x + brdf.y;
	float missing = 1.0 - (brdf.x + brdf.y);
	vec3 averageFresnel = specularColor + (1.0 - specularColor) / 21.0;
	vec3 multiScatter = singleScatter * averageFresnel / (1.0 - averageFresnel * missing) * missing;
	float roughnessSquared = roughness * roughness;
	float smoothness = saturate1(1.0 - roughnessSquared);
	vec3 reflection = reflect(-view, normal);
	reflection = normalize(mix(normal, reflection, smoothness * (sqrt(smoothness) + roughnessSquared)));
	vec4 normalizationSh;
	vec3 env = environment(vPosition, reflection, sqrt(saturate1(roughness)) * uEnvMips, normalizationSh);
	float bakedLuma = dot(vec4(normal, 1.0), normalizationSh);
	float normalization = bakedLuma > 0.0
		? min(dot(indirect, vec3(0.2125, 0.7154, 0.0721)) / bakedLuma, max(roughness * 2.0 + 1.0, 1.0))
		: 1.0;
	indirectSpecular = env * singleScatter * normalization + multiScatter * indirect;
	indirect *= max(vec3(1.0) - (singleScatter + multiScatter), vec3(0.0));
#elif defined(SPECULAR_INDIRECT)
	indirectSpecular = specularColor * indirect * 0.5;
#endif

	directDiffuse *= ao;
	indirect *= ao;
	directSpecular *= ao;
	indirectSpecular *= min(specularOcclusion, ao);

	vec3 lit = diffuseColor * (directDiffuse + indirect) + directSpecular + indirectSpecular + transmissive;

#ifdef SELF_ILLUM
	float illumMask = texture(uSelfIllumMask, SELF_ILLUM_UV).r;
	lit += exp2(uSelfIllum.x) * uSelfIllum.y * uSelfIllumTint * illumMask * mix(vec3(1.0), albedo, uSelfIllum.z);
#endif

	outColor = vec4(applyFog(lit), opacity);
}
`;
