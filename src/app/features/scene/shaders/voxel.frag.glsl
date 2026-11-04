// A strip's fragment: the flat colour its vertex shader chose, dithered against banding. With
// TRACE_STATS, each fragment instead adds one count to red (the host blends additively), so the
// target reads back as fragments per pixel.
uniform float u_frame;

flat in vec3 v_color;
layout(location = 0) out vec4 o_color;

void main()
{
#ifdef TRACE_STATS
    o_color = vec4(1.0 / 255.0, 0.0, 0.0, 1.0);
#else
    float dither = (ign(gl_FragCoord.xy, u_frame) - 0.5) / 255.0;
    o_color = vec4(v_color + dither, 1.0);
#endif
}
