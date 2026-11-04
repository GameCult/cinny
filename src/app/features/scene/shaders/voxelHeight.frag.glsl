// Ring generation: writes the height of the world cell each texel of the ring holds. A pure function
// of the cell, so any order of writes gives the same ring. The camera's draw call scissors this to
// the columns and rows it just admitted.
uniform ivec2 u_origin;   // lowest world cell of the ring's window

in vec2 v_uv;
layout(location = 0) out vec4 o_height;   // rg: height as 16 bits across [-VOX_HB, VOX_HB], high byte first

void main()
{
    ivec2 texel = ivec2(gl_FragCoord.xy);
    ivec2 cell = u_origin + ((texel - u_origin) & (VOX_RING - 1));
    vec2 xz = (vec2(cell) + 0.5) * VOX_CELL;
    // The ray-march scene's terrain, unmasked: fbm envelope plus Phacelle ridges.
    float h = W_AMP * terrainFbm(xz);
#if W_ERODE_ENABLED
    h += W_ERODE_AMP * terrainPhacelle(xz).cos.w;
#endif
    float q = floor(clamp((h + VOX_HB) / (2.0 * VOX_HB), 0.0, 1.0) * 65535.0 + 0.5);
    float hi = floor(q / 256.0);
    o_height = vec4(hi / 255.0, (q - hi * 256.0) / 255.0, 0.0, 1.0);
}
