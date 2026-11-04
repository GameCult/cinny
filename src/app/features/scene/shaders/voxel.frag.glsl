// One pass, straight to the canvas: for every pixel, march down its screen column from the camera
// outward, one height lookup per step, until a column of terrain rises past the pixel.
//
// Projection is a shear, as in the classic voxel renderer: a point at depth z along the view axis
// whose terrain top is h projects to ndc y = horizon + (h - camY) / (z * tanHalf.y). A pixel below
// the horizon is covered by the first sample whose top reaches it, which is the same pixel a
// running-horizon column renderer paints, found without carrying the horizon between pixels. The
// camera is above the highest terrain, so nothing is covered above the horizon (no lookups at all),
// and below it no sample shallower than (camY - VOX_HB) / (tanHalf.y * -rel) can reach the pixel,
// so the march starts there.
uniform sampler2D u_height;   // RG8, the ring of 16-bit heights
uniform sampler2D u_sky;      // baked sky, gamma-encoded
// u_camPos and u_tanHalf (x: tan(fov/2) * aspect, y: tan(fov/2)) come from the shared block.
uniform vec2 u_fwd;           // unit forward on the ground plane (x, z)
uniform vec2 u_right;         // unit right on the ground plane
uniform float u_horizon;      // ndc y of the horizon
uniform vec3 u_grass;
uniform vec3 u_rock;
uniform float u_frame;

in vec2 v_uv;
layout(location = 0) out vec4 o_color;   // rgb gamma-encoded; with TRACE_STATS, a: lookups spent / 255

float cellHeight(ivec2 c)
{
    vec2 t = floor(texelFetch(u_height, c & (VOX_RING - 1), 0).rg * 255.0 + 0.5);
    return mix(-VOX_HB, VOX_HB, (t.x * 256.0 + t.y) / 65535.0);
}

vec3 skyAt(float az, float el)
{
    vec3 c = texture(u_sky, vec2(az * 0.15915494 + 0.5, el * 0.63661977)).rgb;
    return pow(c, vec3(2.2));
}

void main()
{
    vec2 ndc = v_uv * 2.0 - 1.0;
    vec2 d = u_fwd + u_right * (ndc.x * u_tanHalf.x);   // ground direction per unit of view depth
    float dl = length(d);
    float rel = ndc.y - u_horizon;                      // ndc height above the horizon
    float az = atan(d.y, d.x);
    float camY = u_camPos.y;
    float zFar = VOX_FAR / dl;

    int lookups = 0;
    float z = 0.0;
    float h = 0.0;
    ivec2 cell = ivec2(0);
    bool hit = false;
    if (rel < 0.0)
    {
        z = max(VOX_NEAR, (camY - VOX_HB) / (-rel * u_tanHalf.y));
        for (int i = 0; i < VOX_MAX_LOOKUPS; i++)
        {
            if (z >= zFar)
                break;
            cell = ivec2(floor((u_camPos.xz + d * z) * (1.0 / VOX_CELL)));
            h = cellHeight(cell);
            lookups++;
            if (rel <= (h - camY) / (z * u_tanHalf.y))
            {
                hit = true;
                break;
            }
            z += max(VOX_STEP_MIN, z * VOX_STEP_REL);
        }
    }

    vec3 horizonCol = skyAt(az, 0.0);
    vec3 col;
    if (hit)
    {
        float hx = cellHeight(cell + ivec2(1, 0));
        float hz = cellHeight(cell + ivec2(0, 1));
        vec3 n = normalize(vec3((h - hx) / VOX_CELL, 1.0, (h - hz) / VOX_CELL));
        float lit = max(dot(n, u_sunDir), 0.0);
        float high = smoothstep(0.1, 0.9, (h + VOX_HB) / (2.0 * VOX_HB));
        vec3 albedo = mix(u_grass, u_rock, clamp((1.0 - n.y) * 4.0 + high * 0.6, 0.0, 1.0));
        col = albedo * (u_skyTop * 5.0 + u_fogColor * 2.0 + u_sunColor * (0.3 * lit));
        col = mix(col, horizonCol * 0.6 + u_fogColor, 1.0 - exp(-z * dl * VOX_FOG));
    }
    else
    {
        float el = rel > 0.0 ? atan(rel * u_tanHalf.y, dl) : 0.0;
        col = skyAt(az, el);
    }

    float dither = (ign(gl_FragCoord.xy, u_frame) - 0.5) / 255.0;
    o_color = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)) + dither, 1.0);
#ifdef TRACE_STATS
    o_color.a = float(lookups) / 255.0;
#endif
}
