// Full-resolution composite to the canvas: solid over sky, then the accumulated atmosphere.
uniform sampler2D u_solid;   // rgb lit, a coverage (bilinear)
uniform sampler2D u_atm;     // TAA'd atmosphere (bilinear)
uniform float u_frame;

in vec2 v_uv;
out vec4 o_frag;

vec3 tonemap(vec3 x)
{
    // Narkowicz ACES fit.
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main()
{
    vec3 rd = camRay(v_uv);
    vec4 solid = texture(u_solid, v_uv);
    vec4 atm = texture(u_atm, v_uv);
    vec3 base = mix(skyColor(rd), solid.rgb, solid.a);
    vec3 col = base * atm.a + atm.rgb;
    col = tonemap(col);
    col = pow(col, vec3(1.0 / 2.2));
    col += (ign(gl_FragCoord.xy, u_frame) - 0.5) / 255.0;
    o_frag = vec4(col, 1.0);
}
