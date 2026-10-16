export const skinPaintGlsl = /* glsl */ `
uniform sampler2D uPattern;
uniform sampler2D uPaintWear;
uniform sampler2D uPaintGrunge;
uniform sampler2D uPaintMasks;
uniform sampler2D uPaintAo;
uniform sampler2D uPaintNormal;
uniform sampler2D uPaintPosition;
uniform sampler2D uPaintSurface;
uniform mat3 uPatternTransform;
uniform mat3 uWearTransform;
uniform mat3 uGrungeTransform;
uniform vec3 uPaintColors[4];
uniform vec4 uPaintDurability;
uniform vec4 uPaintRoughnessColors;
uniform vec4 uPaintMetalnessColors;
uniform vec3 uPaintAlbedoLevels;
uniform vec3 uMetallicPaintAlbedoLevels;
uniform vec4 uPaintParams;
uniform vec4 uPaintParams2;
uniform vec2 uSprayBias;

const vec3 PAINT_LUMA = vec3(0.2125, 0.7154, 0.0721);

float paintMix(vec4 v, vec3 m) {
	return mix(mix(mix(v.x, v.y, m.x), v.z, m.y), v.w, m.z);
}

vec3 paintColor(vec3 m) {
	return mix(mix(mix(uPaintColors[0], uPaintColors[1], m.x), uPaintColors[2], m.y), uPaintColors[3], m.z);
}

float paintBand(float a) {
	return smoothstep(0.5, 0.6, a) * smoothstep(1.0, 0.9, a);
}

float paintMax(vec3 c) {
	return max(c.x, max(c.y, c.z));
}

vec3 paintLevels(vec3 c, vec3 source, vec3 levels, float wear) {
	if (levels.x == 0.0 && levels.z == 0.0) return c;
	vec3 n = normalize(max(vec3(0.0003), c));
	float level = mix(min(levels.x, dot(source, PAINT_LUMA)), levels.z, clamp(pow(paintMax(c), levels.y), 0.0, 1.0));
	return mix(c, n * level / paintMax(n), wear);
}

vec4 paintProject(vec2 p) {
	return texture(uPattern, (uPatternTransform * vec3(p, 1.0)).xy);
}

vec4 paintSpray(vec2 uv) {
	vec3 position = texture(uPaintPosition, uv).xyz * 2.0;
	vec3 n = normalize(texture(uPaintSurface, uv).xyz * 2.0 - 1.0);
	vec4 a = paintProject(position.yz);
	vec4 b = paintProject(position.xz);
	vec4 c = paintProject(position.yx);
	return mix(mix(a, b, uSprayBias.x * pow(abs(n.y), 7.0)), c, uSprayBias.y * pow(abs(n.z), 7.0));
}

void skinPaint(vec2 uv, vec2 patternUv, inout vec3 albedo, inout float roughness, inout float metalness) {
	float wear = uPaintParams.x;
	float softness = uPaintParams.y;
	float brightness = uPaintParams.z;
	float paintRoughness = uPaintParams.w;
	float paintMetalness = uPaintParams2.x;
	bool perColor = uPaintParams2.y > 0.5;
	vec4 ao = texture(uPaintAo, uv);
	vec4 masks = texture(uPaintMasks, uv);
	float wearTexel = texture(uPaintWear, (uWearTransform * vec3(uv, 1.0)).xy).r;
	vec4 grungeTexel = texture(uPaintGrunge, (uGrungeTransform * vec3(uv, 1.0)).xy);
	vec4 grunge = mix(vec4(1.0), grungeTexel, pow(1.0 - ao.x, 4.0) * 0.25 + 0.75 * wear);
	float scratches = (ao.w + wearTexel * ao.x) * (wear * 6.0 + 1.0);
	vec3 base = albedo;
	float baseRoughness = roughness;
	float baseMetalness = metalness;

#if SKIN_PAINT <= 2 || SKIN_PAINT == 6
	#if SKIN_PAINT == 0
	vec3 weights = masks.xyz;
	float durability = paintMix(uPaintDurability, weights);
	float soft = softness * durability;
	float worn = smoothstep(0.58 - soft, 0.68 + soft, scratches * durability);
	float metal = paintMix(uPaintMetalnessColors, weights);
	float rough = perColor ? paintMix(uPaintRoughnessColors, weights) : paintRoughness;
	vec3 color = paintColor(weights);
	#elif SKIN_PAINT == 6
	vec4 pattern = texture(uPattern, patternUv);
	float coverage = max(0.0, smoothstep(0.0, 0.5, pattern.w));
	float soft = softness * coverage;
	float worn = smoothstep(0.58 - soft, 0.68 + soft, (scratches + paintBand(pattern.w)) * coverage);
	float metal = paintMetalness;
	float rough = paintRoughness;
	vec3 color = clamp(pattern.rgb * brightness, 0.0, 1.0);
	#else
		#if SKIN_PAINT == 1
	vec4 pattern = texture(uPattern, patternUv);
	float my = masks.y;
	float mz = masks.z;
		#else
	vec4 pattern = paintSpray(uv);
	float my = 0.0;
	float mz = 0.0;
		#endif
	float band = paintBand(pattern.w);
	float durability = mix(mix(paintMix(uPaintDurability, pattern.rgb), uPaintDurability.z, my), uPaintDurability.w, mz);
		#if SKIN_PAINT == 1
	float amount = (scratches + band) * max(clamp(my + mz, 0.0, 1.0), smoothstep(0.0, 0.5, pattern.w)) * durability;
		#else
	float amount = scratches * durability;
		#endif
	float soft = softness * durability;
	float a = 0.56 - 0.06 * wear;
	float b = 0.54 - 0.12 * wear;
	float c = 0.52 - 0.18 * wear;
	vec3 weights = pattern.rgb * vec3(
		smoothstep(0.58 + soft, a - soft, amount),
		smoothstep(a + soft, b - soft, amount),
		smoothstep(b + soft, c - soft, amount)
	);
	float worn = smoothstep(0.58 - soft, 0.68 + soft, amount);
	float metal = mix(mix(paintMix(uPaintMetalnessColors, weights), uPaintMetalnessColors.z, my), uPaintMetalnessColors.w, mz);
	float rough = perColor
		? mix(mix(paintMix(uPaintRoughnessColors, weights), uPaintRoughnessColors.z, my), uPaintRoughnessColors.w, mz)
		: paintRoughness;
	vec3 color = mix(mix(paintColor(weights), uPaintColors[2], my), uPaintColors[3], mz);
	color = clamp(color * mix(brightness, 1.0, smoothstep(0.0, 0.01, worn) * (1.0 - band)), 0.0, 1.0);
	#endif
	vec3 levels = mix(uPaintAlbedoLevels, uMetallicPaintAlbedoLevels, metal);
	albedo = mix(paintLevels(color * grunge.rgb, color, levels, wear), base, worn);
	roughness = mix(min(1.0, rough + (1.0 - grunge.w) * wear * wear * 0.5), baseRoughness, worn);
	metalness = mix(metal, baseMetalness, worn);

#elif SKIN_PAINT <= 5
	float mx = masks.x;
	#if SKIN_PAINT == 3
	float worn = smoothstep(0.58 - softness, 0.68 + softness, scratches);
	float cover = max(1.0 - mx, worn);
	float chip = smoothstep(0.0, 0.01, worn) * mx;
	vec3 paint = uPaintColors[0];
	float rough = mix(paintRoughness, 0.35, chip);
	#else
		#if SKIN_PAINT == 4
	vec4 pattern = texture(uPattern, patternUv);
		#else
	vec4 pattern = paintSpray(uv);
		#endif
	float my = masks.y;
	float mz = masks.z;
	float band = paintBand(pattern.w);
	float durability = mix(mix(paintMix(uPaintDurability, pattern.rgb), uPaintDurability.z, my), uPaintDurability.w, mz);
	float soft = softness * durability;
		#if SKIN_PAINT == 4
	float worn = smoothstep(0.58 - soft, 0.68 + soft, (scratches + band) * durability);
	vec3 paint = mix(mix(paintColor(pattern.rgb * mx), uPaintColors[2], my), uPaintColors[3], mz);
		#else
	float worn = smoothstep(0.58 - soft, 0.68 + soft, scratches * durability);
	vec3 paint = mix(mix(paintColor(pattern.rgb), uPaintColors[2], my), uPaintColors[3], mz);
		#endif
	float cover = max(1.0 - mx, worn);
	float chip = smoothstep(0.0, 0.01, worn) * (1.0 - band) * mx;
		#if SKIN_PAINT == 4
	float edge = 1.0 - min(1.0, pattern.w * 2.0);
	float rough = mix(edge * edge * 0.85 + 0.15, paintRoughness, step(0.5, pattern.w));
	rough = mix(mix(rough, paintRoughness, max(max(my, mz), cover)), 0.35, chip);
		#else
	float rough = mix(paintRoughness, 0.35, chip);
		#endif
	#endif
	float bright = mix(brightness, 1.0, chip);
	vec3 color = mix(mix(base, paint, mx), vec3(0.38, 0.37, 0.35), chip);
	color = clamp(clamp(color * bright, 0.0, 1.0) * bright, 0.0, 1.0);
	vec3 shaded = color * mix(grunge.rgb, vec3(1.0), chip);
	albedo = mix(paintLevels(shaded, color, uMetallicPaintAlbedoLevels, wear), base, cover);
	roughness = mix(baseRoughness, min(1.0, rough + (1.0 - dot(grunge.rgb, PAINT_LUMA)) * 0.2), max(0.0, 1.0 - cover));
	metalness = mix(mx, baseMetalness, cover);

#else
	vec4 pattern = texture(uPattern, patternUv);
	float mx = masks.x;
	float spots = smoothstep(0.1, 0.2, wearTexel * ao.y * ao.x * ao.x * wear);
	float age = smoothstep(
		0.0,
		0.15,
		clamp(ao.x * ao.y - wear * 0.1, 0.0, 1.0) - clamp(grungeTexel.x * grungeTexel.y * grungeTexel.z, 0.0, 1.0) * 0.23 + 0.08
	);
	float grungeLuma = dot(grunge.rgb, PAINT_LUMA);
	float grime = (1.0 - grunge.w) * wear;
	float patinaMetal = mix(mix(1.0, pow(age * grunge.w * grungeLuma, 0.5), wear), 1.0, spots);
	vec3 color = mix(pattern.rgb, pattern.rgb * brightness, max(mx, uPaintParams2.z));
	vec3 tint = mix(mix(uPaintColors[1], uPaintColors[3], sqrt(wear)), mix(uPaintColors[1], uPaintColors[2], wear), age);
	vec3 patina = mix(tint * color, uPaintColors[0] * dot(color, PAINT_LUMA), spots);
	float extra = (1.0 - grungeLuma) * wear * 0.05 + (1.0 - age) * 0.15 * wear + grime * 0.15;
	#if SKIN_PAINT == 7
	float rough = clamp(paintRoughness * mix(1.0, 0.9, spots) + extra, 0.0, 1.0);
	albedo = mix(paintLevels(patina * grunge.rgb, color * uPaintColors[1], uMetallicPaintAlbedoLevels, wear), base, 1.0 - mx);
	roughness = mix(baseRoughness, mix(min(1.0, rough + grime * wear * 0.5), rough, mx), step(ao.w, 0.996) * mx);
	metalness = mix(baseMetalness, patinaMetal, mx);
	#else
	float bare = 1.0 - mx;
	float coverage = max(0.0, smoothstep(0.0, 0.5, pattern.w));
	float amount = ((min(ao.w, bare) + wearTexel * ao.x) * (wear * 6.0 + 1.0) + paintBand(pattern.w)) * coverage;
	float soft = softness * coverage;
	bool solid = mx > 0.99;
	float worn = solid ? amount : smoothstep(0.58 - soft, 0.68 + soft, amount);
	float edge = 1.0 - min(1.0, pattern.w * 2.0);
	float paintRough = mix(paintRoughness, mix(edge * edge * 0.85 + 0.15, paintRoughness, step(0.5, pattern.w)), mx);
	float rough = clamp(paintRough * mix(1.0, 0.9, spots) + extra, 0.0, 1.0);
	vec3 levels = mix(uPaintAlbedoLevels, uMetallicPaintAlbedoLevels, mix(paintMetalness, 1.0, mx));
	vec3 shaded = mix(color, patina, mx) * grunge.rgb;
	albedo = mix(paintLevels(shaded, mix(color, color * uPaintColors[1], mx), levels, wear), base, worn * bare);
	roughness = mix(baseRoughness, mix(min(1.0, rough + grime * wear * 0.5), rough, mx), solid ? 1.0 : max(0.0, 1.0 - worn));
	metalness = mix(mix(paintMetalness, baseMetalness, worn), patinaMetal, mx);
	#endif
#endif
}
`;
