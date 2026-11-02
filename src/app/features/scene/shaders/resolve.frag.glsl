// TAA resolve for the atmosphere target: reproject history by the pass-1 depth, clamp it to the
// current frame's 3x3 neighbourhood, blend.
uniform sampler2D u_cur;
uniform sampler2D u_history;
uniform sampler2D u_depth;
uniform vec3 u_prevPos;
uniform mat3 u_prevBasis;
uniform vec2 u_prevTanHalf;
uniform float u_blend;        // weight of the current frame; 1 resets
uniform vec2 u_curSize;

in vec2 v_uv;
layout(location = 0) out vec4 o_hist;

void main()
{
    vec2 px = 1.0 / u_curSize;
    vec4 cur = texture(u_cur, v_uv);
    vec4 lo = cur;
    vec4 hi = cur;
    for (int y = -1; y <= 1; y++)
        for (int x = -1; x <= 1; x++)
        {
            vec4 s = texture(u_cur, v_uv + vec2(float(x), float(y)) * px);
            lo = min(lo, s);
            hi = max(hi, s);
        }

    // Where this pixel's ray ended, reprojected into last frame's camera.
    vec3 rd = camRay(v_uv);
    float t = min(texture(u_depth, v_uv).r, 600.0);
    vec3 v = u_camPos + rd * t - u_prevPos;
    vec3 local = transpose(u_prevBasis) * v;
    vec2 prevNdc = local.z > 0.0 ? local.xy / (local.z * u_prevTanHalf) : vec2(2.0);
    vec2 prevUv = prevNdc * 0.5 + 0.5;
    bool inside = all(greaterThanEqual(prevUv, vec2(0.0))) && all(lessThanEqual(prevUv, vec2(1.0)));

    float a = (inside && u_blend < 1.0) ? u_blend : 1.0;
    vec4 hist = clamp(texture(u_history, prevUv), lo, hi);
    o_hist = mix(hist, cur, a);
}
