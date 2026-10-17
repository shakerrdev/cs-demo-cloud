export const glovePaintGlsl = /* glsl */ `
uniform sampler2D uGloveMask;
uniform sampler2D uGloveSurface;
uniform sampler2D uGloveNormal;
uniform sampler2D uGlovePattern;
uniform sampler2D uGloveDetail1;
uniform sampler2D uGloveDetail2;
uniform sampler2D uGloveDetail3;
uniform sampler2D uGloveDetail4;
uniform sampler2D uGloveDetailNormal1;
uniform sampler2D uGloveDetailNormal2;
uniform sampler2D uGloveDetailNormal3;
uniform sampler2D uGloveDetailNormal4;
uniform vec3 uGloveTints[8];
uniform vec4 uGlovePalette;
uniform vec4 uGlovePatternX0;
uniform vec4 uGlovePatternX1;
uniform vec4 uGloveDetailScale;
uniform vec4 uGloveBlackPoint;
uniform vec4 uGloveRoughContrast;
uniform vec4 uGloveRoughBrightness;
uniform vec4 uGloveMetalness;
uniform vec4 uGloveNormalContrast;
uniform vec4 uGloveCurvature;
uniform vec4 uGloveParams;
uniform vec4 uGloveParams2;
uniform vec4 uGlovePatternProps;

const vec3 GLOVE_LUMA = vec3(0.2125, 0.7154, 0.0721);
const vec3 GLOVE_TAPS[9] = vec3[](
	vec3(0.0, 0.0, 0.3197279),
	vec3(-1.0, -1.0, 0.0510204),
	vec3(-1.0, 0.0, 0.1190476),
	vec3(-1.0, 1.0, 0.0510204),
	vec3(0.0, -1.0, 0.1190476),
	vec3(0.0, 1.0, 0.1190476),
	vec3(1.0, -1.0, 0.0510204),
	vec3(1.0, 0.0, 0.1190476),
	vec3(1.0, 1.0, 0.0510204)
);

float gloveMix(vec4 v, vec3 m) {
	return mix(mix(mix(v.x, v.y, m.x), v.z, m.y), v.w, m.z);
}

vec3 gloveTint(int index) {
	return uGloveTints[clamp(index, 0, 7)];
}

struct GloveSurface {
	vec3 albedo;
	float roughness;
	float metalness;
	vec3 normalTs;
	float ao;
};

GloveSurface glovePaint(vec2 uv) {
	vec4 mask = texture(uGloveMask, uv);
	vec3 m = mask.xyz;
	float wear = uGloveParams.w;
	float thickness = uGloveParams.y;

	vec2 detailUv = uv * gloveMix(uGloveDetailScale, m);
	vec4 d1 = texture(uGloveDetail1, detailUv);
	vec4 d2 = texture(uGloveDetail2, detailUv);
	vec4 d3 = texture(uGloveDetail3, detailUv);
	vec4 d4 = texture(uGloveDetail4, detailUv);
	d1.xy = uGloveBlackPoint.x + d1.xy * (1.0 - uGloveBlackPoint.x);
	d2.xy = uGloveBlackPoint.y + d2.xy * (1.0 - uGloveBlackPoint.y);
	d3.xy = uGloveBlackPoint.z + d3.xy * (1.0 - uGloveBlackPoint.z);
	d4.xy = uGloveBlackPoint.w + d4.xy * (1.0 - uGloveBlackPoint.w);
	vec4 d = mix(mix(mix(d1, d2, m.x), d3, m.y), d4, m.z);
	d.xy = uGloveBlackPoint.x + d.xy * (1.0 - uGloveBlackPoint.x);

	float inverseRough = 1.0 - d.w;
	float roughness = clamp(
		(gloveMix(uGloveRoughContrast, m) * (inverseRough * inverseRough * 0.85 - 0.35) + 0.5) *
			gloveMix(uGloveRoughBrightness, m),
		0.0,
		1.0
	);
	float metalness = gloveMix(uGloveMetalness, m);

	float weights[8] = float[](0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
	vec2 texel = vec2(1.0 / 1024.0) * uGloveParams.x;
	for (int t = 0; t < 9; t++) {
		float a = textureLod(uGloveMask, uv + GLOVE_TAPS[t].xy * texel, 0.0).w;
		int index = clamp(int(floor(a * 8.0 + 0.02)), 0, 7);
		weights[index] += GLOVE_TAPS[t].z;
	}
	vec3 palette = vec3(0.0);
	for (int i = 0; i < 8; i++) palette += uGloveTints[i] * weights[i];
	vec3 color = srgbToLinear(palette);

	float targetLuma = d.y;
	vec2 detailRg = mix(mix(mix(
		texture(uGloveDetailNormal1, detailUv).xy,
		texture(uGloveDetailNormal2, detailUv).xy, m.x),
		texture(uGloveDetailNormal3, detailUv).xy, m.y),
		texture(uGloveDetailNormal4, detailUv).xy, m.z);
	vec3 detailNormal = decodeNormal(detailRg);
	detailNormal = normalize(mix(vec3(0.0, 0.0, 1.0), detailNormal, gloveMix(uGloveNormalContrast, m)));

	if (uGloveParams2.y > 0.5) {
		int mode = int(uGloveParams2.z + 0.5);
		int replace = int(uGloveParams2.w + 0.5);
		float replaced = (mode == 1 || mode == 3) ? 1.0 : weights[clamp(replace, 0, 7)];
		vec2 flipped = vec2(uv.x * uGloveParams2.x, uv.y);
		vec2 patternUv = vec2(
			dot(flipped, uGlovePatternX0.xy) + uGlovePatternX0.w,
			dot(flipped, uGlovePatternX1.xy) + uGlovePatternX1.w
		) + vec2((d.y * 2.0 - 1.0) / 1024.0 * uGloveParams.z);
		vec4 pattern = texture(uGlovePattern, patternUv);
		vec3 patternColor;
		if (mode < 2) {
			float total = pattern.x + pattern.y + pattern.z;
			float amount = clamp(total, 0.0, 1.0) * replaced *
				clamp(thickness - d.z * pow(wear, 4.0), 0.0, 1.0);
			float covered = amount * min(1.0, thickness);
			roughness *= mix(1.0, uGlovePatternProps.x, covered);
			targetLuma = mix(d.y, 0.5, amount);
			detailNormal = normalize(mix(detailNormal, vec3(0.0, 0.0, 1.0), covered));
			patternColor = mix(mix(mix(
				gloveTint(int(uGlovePalette.x) - 1),
				gloveTint(int(uGlovePalette.y) - 1), pattern.x),
				gloveTint(int(uGlovePalette.z) - 1), pattern.y),
				gloveTint(int(uGlovePalette.w) - 1), pattern.z);
		} else {
			patternColor = pattern.rgb;
		}
		color = mix(color, srgbToLinear(patternColor), replaced);
		metalness = mix(metalness, uGlovePatternProps.y, replaced);
	}

	vec4 surface = texture(uGloveSurface, uv);
	float curvature = pow(max(surface.x, 1e-4), gloveMix(uGloveCurvature, m));
	vec3 lifted = max(color, color * (1.0 + curvature * 0.5));
	vec3 hue = normalize(max(lifted, vec3(0.001)));
	float luma = dot(vec3(min(1.0, targetLuma)), GLOVE_LUMA);
	vec3 albedo = clamp(
		hue * min(luma / dot(hue, GLOVE_LUMA), 3.0 * luma * max(lifted.x, max(lifted.y, lifted.z))),
		0.0,
		1.0
	);

	vec3 base = decodeNormal(texture(uGloveNormal, uv).xy);
	vec3 normalTs = normalize(vec3(base.xy + detailNormal.xy, base.z * detailNormal.z));
	return GloveSurface(albedo, roughness, metalness, normalTs, surface.x);
}
`;
