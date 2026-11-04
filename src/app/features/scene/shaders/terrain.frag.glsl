// Pass 1: solid surfaces (terrain + world tree), sphere-traced. Writes lit colour with coverage
// and, separately, the hit distance that bounds pass 2.
uniform vec3 u_grass;
uniform vec3 u_rock;
uniform vec3 u_bark;
uniform vec3 u_leaf;
uniform int u_maxSteps;
uniform sampler2D u_start;   // prepass: r = distance no ray of this pixel's tile hits before; W_FAR = tile misses

in vec2 v_uv;
layout(location = 0) out vec4 o_color;   // rgb lit, a coverage
layout(location = 1) out float o_depth;  // hit distance along the ray, W_FAR on a miss
#ifdef TRACE_STATS
layout(location = 2) out float o_steps;  // distance evaluations this ray spent, over 255 (measurement only)
#endif

// ---- trace ---------------------------------------------------------------------------------

void main()
{
    vec3 ro = u_camPos;
    vec3 rd = camRay(v_uv);

    float t = texture(u_start, v_uv).r;
    // Nothing is above W_MAX_HEIGHT: skip the empty air above it, or miss outright. A tile the
    // prepass proved empty arrives as W_FAR.
    bool missAtOnce = t >= W_FAR;
    if (ro.y > W_MAX_HEIGHT)
    {
        missAtOnce = missAtOnce || rd.y >= 0.0;
        t = max(t, (W_MAX_HEIGHT - ro.y) / rd.y);
    }
    if (missAtOnce)
    {
        o_color = vec4(0.0);
        o_depth = W_FAR;
#ifdef TRACE_STATS
        o_steps = 0.0;
#endif
        return;
    }

    bool hit = false;
    bool onTree = false;
    float leafness = 0.0;
    int i = 0;
    int evals = 0;
    for (; i < u_maxSteps; i++)
    {
        evals++;
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
#ifdef TRACE_STATS
    o_steps = float(evals) / 255.0;
#endif

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
