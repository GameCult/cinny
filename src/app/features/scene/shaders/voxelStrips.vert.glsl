// The terrain, painter's order. Six vertices are one strip: a screen column (one pixel wide) at one
// depth step. The host draws steps far to near with no depth test, so a nearer strip overwrites
// what it hides, which is the classic voxel renderer's occlusion without a running horizon.
//
// Projection is a shear: a point at depth z along the view axis whose terrain top is h projects to
// ndc y = horizon + (h - camY) / (z * tanHalf.y). A strip runs from its own top down to the top of
// the next nearer strip, or to the screen bottom for the first. Where the nearer top is higher the
// quad is upside down, but it then lies below that nearer top, and the nearer strips drawn after
// it cover everything below their tops, so no test for "hidden" is needed and no vertex has to
// read both heights to place itself. No pixel below a strip's top is left unpainted either:
// the nearer strips cover the rest.
//
// One plain drawArrays of triangles, no vertex buffers, no instancing: gl_VertexID alone says which
// strip and which corner. The six vertices are BL BR TL | TL BR TR. A bottom vertex reads the nearer
// neighbour's height; a top vertex its own. The colour is computed on the two corners that are the
// last vertex of a triangle (TL and TR, which also read the neighbour's height, for the slope) and
// leaves as a flat varying: the provoking vertex of a GL ES triangle is its last.
uniform sampler2D u_height;   // RG8, the ring of 16-bit heights
uniform sampler2D u_sky;      // baked sky, gamma-encoded
// u_camPos, u_tanHalf (x: tan(fov/2) * aspect, y: tan(fov/2)) and the palette come from the shared block.
uniform vec2 u_fwd;           // unit forward on the ground plane (x, z)
uniform vec2 u_right;         // unit right on the ground plane
uniform float u_horizon;      // ndc y of the horizon
uniform vec3 u_grass;
uniform vec3 u_rock;
uniform int u_columns;        // screen columns, one per drawing-buffer pixel
uniform int u_firstStep;      // nearest step drawn; its strips run to the screen bottom

flat out vec3 v_color;        // gamma-encoded

float cellHeight(ivec2 c)
{
    vec2 t = floor(texelFetch(u_height, c & (VOX_RING - 1), 0).rg * 255.0 + 0.5);
    return mix(-VOX_HB, VOX_HB, (t.x * 256.0 + t.y) / 65535.0);
}

// The closed form of z += max(VOX_STEP_MIN, z * VOX_STEP_REL) from VOX_NEAR; voxelWorld.ts has the same.
float stepDepth(int k)
{
    return k <= VOX_LINEAR
        ? VOX_NEAR + float(k) * VOX_STEP_MIN
        : VOX_GROW_FROM * pow(1.0 + VOX_STEP_REL, float(k - VOX_LINEAR));
}

void main()
{
    int strip = gl_VertexID / 6;
    int corner = gl_VertexID - strip * 6;
    bool top = corner == 2 || corner == 3 || corner == 5;
    bool carriesColour = corner == 2 || corner == 5;
    float side = (corner == 1 || corner == 4 || corner == 5) ? 1.0 : -1.0;
    int column = strip % u_columns;
    int k = VOX_STEPS - 1 - strip / u_columns;   // far to near

    float cx = (float(column) + 0.5) / float(u_columns) * 2.0 - 1.0;
    vec2 d = u_fwd + u_right * (cx * u_tanHalf.x);       // ground direction per unit of view depth
    float dl = length(d);
    float z = stepDepth(k);
    v_color = vec3(0.0);
    gl_Position = vec4(cx + side / float(u_columns), -1.0, 0.0, 1.0);
    if (z * dl >= VOX_FAR)
    {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);          // outside the column's far plane: clipped
        return;
    }

    int kp = max(k - 1, 0);
    // The nearer neighbour's depth, without a second pow: one growth step back, or one linear step.
    float zp = k > VOX_LINEAR + 1 ? z * (1.0 / (1.0 + VOX_STEP_REL)) : VOX_NEAR + float(kp) * VOX_STEP_MIN;
    vec2 cam = u_camPos.xz;
    vec2 base = cam * (1.0 / VOX_CELL);
    vec2 dcell = d * (1.0 / VOX_CELL);
    if (!top)
    {
        // Bottom edge: the nearer strip's top. If that is higher than this strip's own top the quad is
        // upside down, but it then lies below the nearer top, where nearer strips are drawn over it.
        float hp = cellHeight(ivec2(floor(base + dcell * zp)));
        float yNear = k == u_firstStep ? -1.0 : u_horizon + (hp - u_camPos.y) / (zp * u_tanHalf.y);
        gl_Position.y = clamp(yNear, -1.0, 1.0);
        return;
    }
    float h = cellHeight(ivec2(floor(base + dcell * z)));
    gl_Position.y = clamp(u_horizon + (h - u_camPos.y) / (z * u_tanHalf.y), -1.0, 1.0);
    if (!carriesColour)
        return;
    // Colour by height and slope along the view ray, then fog toward the sky's horizon colour.
    float hp = cellHeight(ivec2(floor(base + dcell * zp)));
    float slope = (h - hp) / max((z - zp) * dl, 1e-3);
    vec2 dn = d / dl;
    vec3 n = normalize(vec3(-slope * dn.x, 1.0, -slope * dn.y));
    float lit = max(dot(n, u_sunDir), 0.0);
    float high = smoothstep(0.1, 0.9, (h + VOX_HB) / (2.0 * VOX_HB));
    vec3 albedo = mix(u_grass, u_rock, clamp((1.0 - n.y) * 4.0 + high * 0.6, 0.0, 1.0));
    vec3 col = albedo * (u_skyTop * 5.0 + u_fogColor * 2.0 + u_sunColor * (0.3 * lit));
    float az = atan(d.y, d.x);
    vec3 horizonCol = pow(textureLod(u_sky, vec2(az * 0.15915494 + 0.5, 0.0), 0.0).rgb, vec3(2.2));
    col = mix(col, horizonCol * 0.6 + u_fogColor, 1.0 - exp(-z * dl * VOX_FOG));
    v_color = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
}
