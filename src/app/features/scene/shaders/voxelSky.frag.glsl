// Sky bake, run once: azimuth across, elevation up from the horizon to the zenith, with cloud
// bands. Stored gamma-encoded because the target is 8 bits.
in vec2 v_uv;
layout(location = 0) out vec4 o_sky;

void main()
{
    float az = (v_uv.x - 0.5) * 6.2831853;
    float el = v_uv.y * 1.5707963;
    vec3 rd = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
    // Dusk: the horizon glow gives way to the night blue within the visible band, not at the zenith.
    vec3 c = mix(u_skyHorizon, u_skyTop, smoothstep(0.0, 0.2, rd.y));
    c += u_sunColor * (0.5 * pow(max(dot(rd, u_sunDir), 0.0), 64.0));

    // Bands: noise stretched along the horizon, layered by elevation. Taken from the direction
    // vector so the seam at +-pi is seamless.
    vec3 q = vec3(rd.x * 2.2, rd.y * 11.0, rd.z * 2.2);
    float n = 0.5 + 0.5 * cultmath_snoise(q) + 0.25 * cultmath_snoise(q * 2.3 + 7.0);
    float cover = smoothstep(0.62, 0.95, n) * smoothstep(0.02, 0.2, el) * (1.0 - smoothstep(0.55, 1.1, el));
    float sunSide = pow(max(dot(rd, u_sunDir), 0.0), 3.0);
    vec3 cloud = u_skyHorizon * 0.9 + u_skyTop * 4.0 + u_sunColor * (0.07 * sunSide);
    c = mix(c, cloud, cover * 0.8);

    o_sky = vec4(pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}
