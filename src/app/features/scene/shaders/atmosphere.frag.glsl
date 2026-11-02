// Pass 2: atmosphere, marched only up to pass 1's depth. Height fog is closed-form; the cloud
// slab is marched with a few jittered steps. Output: rgb in-scattered light, a transmittance.
uniform sampler2D u_depth;     // pass 1 hit distance, nearest
uniform int u_steps;           // cloud march steps
uniform float u_frame;
uniform vec2 u_jitter;         // sub-pixel jitter in pixels of this target
uniform vec2 u_size;           // this target's size in pixels
uniform float u_coverage;      // weather knob: 0 clear .. 1 overcast

in vec2 v_uv;
layout(location = 0) out vec4 o_atm;

float hg(float cosTheta, float g)
{
    float g2 = g * g;
    return (1.0 - g2) / (12.566370614 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}

float cloudDensity(vec3 p)
{
    float wind = u_time * 2.5;
    float f = cultmath_fbm_grad(vec3(p.x * 0.0042 + wind * 0.0042, p.y * 0.0075, p.z * 0.0042), 3, 2.0, 0.5).w;
    float h = (p.y - W_CLOUD_Y0) / (W_CLOUD_Y1 - W_CLOUD_Y0);
    float profile = smoothstep(0.0, 0.2, h) * smoothstep(1.0, 0.55, h);
    return clamp((f + 0.55 * u_coverage - 0.25) * 2.4, 0.0, 1.0) * profile;
}

void main()
{
    vec2 jittered = (gl_FragCoord.xy + u_jitter) / u_size;
    vec3 rd = camRay(jittered);
    vec3 ro = u_camPos;
    float depth = texture(u_depth, v_uv).r;
    float tEnd = min(depth, W_ATM_FAR);

    // Exponential height fog, closed form: optical depth of density d0 * exp(-k y) along the ray.
    float k = W_FOG_FALLOFF;
    float dy = rd.y * tEnd;
    float tau = W_FOG_DENSITY * exp(-k * ro.y) * (abs(dy) > 1e-3 ? (1.0 - exp(-k * dy)) / (k * rd.y) : tEnd);
    float fogT = exp(-max(tau, 0.0));
    float cosSun = dot(rd, u_sunDir);
    vec3 fogLight = u_fogColor + u_sunColor * hg(cosSun, 0.55) * 0.9;
    vec3 inscatter = fogLight * (1.0 - fogT);
    float trans = fogT;

    // Clouds: only the part of the ray inside the slab and in front of the surface.
    float ta = 0.0;
    float tb = tEnd;
    if (abs(rd.y) > 1e-4)
    {
        float t0 = (W_CLOUD_Y0 - ro.y) / rd.y;
        float t1 = (W_CLOUD_Y1 - ro.y) / rd.y;
        ta = max(0.0, min(t0, t1));
        tb = min(tEnd, max(t0, t1));
    }
    else if (ro.y < W_CLOUD_Y0 || ro.y > W_CLOUD_Y1)
        tb = 0.0;

    if (tb > ta && u_steps > 0)
    {
        float dt = (tb - ta) / float(u_steps);
        float t = ta + dt * ign(gl_FragCoord.xy, u_frame);
        float T = 1.0;
        vec3 L = vec3(0.0);
        float phase = hg(cosSun, 0.6) + 0.35 * hg(cosSun, -0.2);
        for (int i = 0; i < u_steps; i++)
        {
            vec3 p = ro + rd * t;
            float d = cloudDensity(p);
            if (d > 0.01)
            {
                // One sample toward the sun stands in for self-shadowing.
                float shade = exp(-cloudDensity(p + u_sunDir * 38.0) * 2.2);
                vec3 light = u_sunColor * (phase * 6.0) * shade + mix(u_skyHorizon, u_skyTop, 0.6) * 0.35;
                float ext = d * dt * 0.035;
                float stepT = exp(-ext);
                L += T * (1.0 - stepT) * light;
                T *= stepT;
                if (T < 0.03)
                    break;
            }
            t += dt;
        }
        // Fog in front of the slab is already in `inscatter`; clouds sit behind it.
        inscatter += trans * L;
        trans *= T;
    }

    o_atm = vec4(inscatter, trans);
}
