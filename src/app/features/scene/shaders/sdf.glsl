// The solid world as a distance bound: terrain graph plus tree. Shared by the pass-1 trace and the
// cone prepass, so both step by the same bound.

// ---- terrain -------------------------------------------------------------------------------

float terrainMask(vec2 xz) { return smoothstep(W_PLATEAU_IN, W_PLATEAU_OUT, length(xz)); }

// Value only; cultmath_fbm_grad is the shipped fbm, a public value-only fbm is Libby's gap.
float terrainFbm(vec2 xz) { return cultmath_fbm_grad(vec3(xz * W_FREQ, 0.0), W_OCTAVES, W_LACUNARITY, W_GAIN).w; }

#if W_ERODE_ENABLED
CultPhasor terrainPhacelle(vec2 xz)
{
    // A fixed stripe wave vector: ridges across the sheet, not slope-aligned erosion.
    return cultmath_phacelle(vec3(xz * W_ERODE_FREQ, 0.0), W_ERODE_SIDE, 0.0, W_ERODE_NORM);
}
#endif

// Conservative distance to the terrain graph. Above the envelope (fbm + erosion amplitude) the
// cheap envelope bound is exact enough to step by; only within it is the eroded field evaluated.
float terrainDistance(vec3 p)
{
    float m = terrainMask(p.xz);
    // Flat plateau: the height is exactly 0, so neither noise is evaluated. Sky rays spend most
    // of their steps here.
    if (m <= 0.0)
        return p.y * W_SLOPE_ENV_INV;
    float hb = m * W_AMP * terrainFbm(p.xz);
    float above = p.y - (hb + m * W_ERODE_AMP);
    if (above > 0.0)
        return above * W_SLOPE_ENV_INV;
#if W_ERODE_ENABLED
    hb += m * W_ERODE_AMP * terrainPhacelle(p.xz).cos.w;
#endif
    return (p.y - hb) * W_SLOPE_FULL_INV;
}

vec3 terrainNormal(vec2 xz)
{
    float r = length(xz);
    float m = smoothstep(W_PLATEAU_IN, W_PLATEAU_OUT, r);
    float s = clamp((r - W_PLATEAU_IN) / (W_PLATEAU_OUT - W_PLATEAU_IN), 0.0, 1.0);
    float dm = r > 0.0 ? 6.0 * s * (1.0 - s) / (W_PLATEAU_OUT - W_PLATEAU_IN) : 0.0;
    vec2 dir = r > 0.0 ? xz / r : vec2(0.0);
    vec4 fg = cultmath_fbm_grad(vec3(xz * W_FREQ, 0.0), W_OCTAVES, W_LACUNARITY, W_GAIN);
    float f = fg.w;
    vec2 g = m * W_AMP * W_FREQ * fg.xy + dm * W_AMP * f * dir;
#if W_ERODE_ENABLED
    CultPhasor ph = terrainPhacelle(xz);
    g += m * W_ERODE_AMP * W_ERODE_FREQ * ph.cos.xy + dm * W_ERODE_AMP * ph.cos.w * dir;
#endif
    return normalize(vec3(-g.x, 1.0, -g.y));
}

// ---- world tree ----------------------------------------------------------------------------

float smin(float a, float b, float k)
{
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * k * 0.25;
}

// Not an exact SDF: the flare, ellipsoid and displacement are all scaled to stay under 1-Lipschitz.
float treeDistance(vec3 p, out float leafness)
{
    vec3 c = vec3(0.0, 0.5 * (W_CANOPY_Y + W_CANOPY_R.y), 0.0);
    float bound = length(p - c) - (W_CANOPY_Y + W_CANOPY_R.y);
    leafness = 0.0;
    if (bound > 8.0)
        return bound;

    float ang = atan(p.z, p.x);
    float y01 = clamp(p.y / W_TRUNK_H, 0.0, 1.0);
    float radius = mix(W_TRUNK_R0, W_TRUNK_R1, y01) + 6.0 * exp(-p.y * 0.2) * (1.0 + 0.35 * sin(6.0 * ang + p.y * 0.15));
    float trunk = max(length(p.xz) - radius, p.y - W_TRUNK_H * 1.2) * 0.7;

    vec3 q = (p - vec3(0.0, W_CANOPY_Y, 0.0)) / W_CANOPY_R;
    float disp = cultmath_snoise(p * 0.05 + vec3(0.0, u_time * 0.015, 0.0));
    float canopy = (length(q) - 1.0) * min(W_CANOPY_R.x, W_CANOPY_R.y) - 3.0 * disp;
    canopy *= 0.45; // 1 / (1 + 3 * 0.05 * L)

    float d = smin(trunk, canopy, 6.0);
    leafness = clamp(0.5 + (trunk - canopy) * 0.15, 0.0, 1.0);
    return d;
}

// ---- trace ---------------------------------------------------------------------------------

float sceneDistance(vec3 p, out float leafness, out bool onTree)
{
    float dt = terrainDistance(p);
    float dr = treeDistance(p, leafness);
    onTree = dr < dt;
    return min(dt, dr);
}
