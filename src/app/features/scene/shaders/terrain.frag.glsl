// Pass 1: solid surfaces (terrain + world tree), sphere-traced. Writes lit colour with coverage
// and, separately, the hit distance that bounds pass 2.
uniform vec3 u_grass;
uniform vec3 u_rock;
uniform vec3 u_bark;
uniform vec3 u_leaf;
uniform int u_maxSteps;

in vec2 v_uv;
layout(location = 0) out vec4 o_color;   // rgb lit, a coverage
layout(location = 1) out float o_depth;  // hit distance along the ray, W_FAR on a miss

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
    vec2 g = m * W_AMP * W_FREQ * fg.xz + dm * W_AMP * f * dir;
#if W_ERODE_ENABLED
    CultPhasor ph = terrainPhacelle(xz);
    g += m * W_ERODE_AMP * W_ERODE_FREQ * ph.cos.xz + dm * W_ERODE_AMP * ph.cos.w * dir;
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

void main()
{
    vec3 ro = u_camPos;
    vec3 rd = camRay(v_uv);

    float t = 0.0;
    // Nothing is above W_MAX_HEIGHT: skip the empty air above it, or miss outright.
    if (ro.y > W_MAX_HEIGHT)
    {
        if (rd.y >= 0.0)
        {
            o_color = vec4(0.0);
            o_depth = W_FAR;
            return;
        }
        t = (W_MAX_HEIGHT - ro.y) / rd.y;
    }

    bool hit = false;
    bool onTree = false;
    float leafness = 0.0;
    int i = 0;
    for (; i < u_maxSteps; i++)
    {
        vec3 p = ro + rd * t;
        float d = sceneDistance(p, leafness, onTree);
        if (d < 0.0006 * t + 0.01)
        {
            hit = true;
            break;
        }
        t += d;
        if (t > W_FAR || (p.y > W_MAX_HEIGHT && rd.y > 0.0))
            break;
    }
    // The conservative bound makes grazing rays crawl: a ray that ran out of steps while still
    // below the highest terrain is a distant surface under thick fog, so it ends there.
    if (!hit && i == u_maxSteps && t < W_FAR)
    {
        hit = true;
        sceneDistance(ro + rd * t, leafness, onTree);
    }

    if (!hit)
    {
        o_color = vec4(0.0);
        o_depth = W_FAR;
        return;
    }

    vec3 p = ro + rd * t;
    vec3 n;
    vec3 albedo;
    if (onTree)
    {
        float e = 0.35;
        float l;
        n = normalize(vec3(
            treeDistance(p + vec3(e, 0.0, 0.0), l) - treeDistance(p - vec3(e, 0.0, 0.0), l),
            treeDistance(p + vec3(0.0, e, 0.0), l) - treeDistance(p - vec3(0.0, e, 0.0), l),
            treeDistance(p + vec3(0.0, 0.0, e), l) - treeDistance(p - vec3(0.0, 0.0, e), l)));
        float speckle = 0.75 + 0.25 * cultmath_snoise(p * 0.8);
        albedo = mix(u_bark, u_leaf * speckle, leafness);
    }
    else
    {
        n = terrainNormal(p.xz);
        float rockness = smoothstep(0.78, 0.55, n.y);
        albedo = mix(u_grass, u_rock, rockness);
    }

    float ndl = dot(n, u_sunDir);
    float wrap = clamp(ndl * 0.6 + 0.4, 0.0, 1.0); // half-lambert: no shadow ray in the cheap pass
    vec3 ambient = mix(u_skyHorizon, u_skyTop, 0.5 + 0.5 * n.y) * 0.45;
    vec3 col = albedo * (u_sunColor * wrap * wrap + ambient);

    o_color = vec4(col, 1.0);
    o_depth = t;
}
