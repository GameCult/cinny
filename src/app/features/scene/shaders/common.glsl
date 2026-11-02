// Shared by every fragment stage; concatenated after the prelude, CultMath and the world defines.
uniform vec3 u_camPos;
uniform mat3 u_camBasis;   // columns: right, up, forward
uniform vec2 u_tanHalf;    // x: tan(fov/2) * aspect, y: tan(fov/2)
uniform float u_time;
uniform vec3 u_sunDir;     // unit, towards the sun
uniform vec3 u_sunColor;
uniform vec3 u_skyTop;
uniform vec3 u_skyHorizon;
uniform vec3 u_fogColor;

vec3 camRay(vec2 uv)
{
    vec2 ndc = uv * 2.0 - 1.0;
    return normalize(u_camBasis * vec3(ndc * u_tanHalf, 1.0));
}

float ign(vec2 p, float frame)
{
    p += 5.588238 * mod(frame, 64.0);
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

vec3 skyColor(vec3 rd)
{
    float h = clamp(rd.y, 0.0, 1.0);
    vec3 c = mix(u_skyHorizon, u_skyTop, pow(h, 0.45));
    float s = max(dot(rd, u_sunDir), 0.0);
    c += u_sunColor * (1.5 * pow(s, 256.0));
    return c;
}
