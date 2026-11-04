// The sky behind the strips, one fullscreen triangle: the baked sky by azimuth and elevation above
// the horizon. Below the horizon it is the horizon colour, which is what shows past the last strip.
uniform sampler2D u_sky;      // baked sky, gamma-encoded
// u_tanHalf comes from the shared block.
uniform vec2 u_fwd;           // unit forward on the ground plane (x, z)
uniform vec2 u_right;         // unit right on the ground plane
uniform float u_horizon;      // ndc y of the horizon
uniform float u_frame;

in vec2 v_uv;
layout(location = 0) out vec4 o_color;

void main()
{
    vec2 ndc = v_uv * 2.0 - 1.0;
    vec2 d = u_fwd + u_right * (ndc.x * u_tanHalf.x);
    float rel = ndc.y - u_horizon;
    float el = rel > 0.0 ? atan(rel * u_tanHalf.y, length(d)) : 0.0;
    vec3 c = texture(u_sky, vec2(atan(d.y, d.x) * 0.15915494 + 0.5, el * 0.63661977)).rgb;
    float dither = (ign(gl_FragCoord.xy, u_frame) - 0.5) / 255.0;
    o_color = vec4(c + dither, 1.0);
}
