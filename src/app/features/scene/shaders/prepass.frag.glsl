// Pass 0: a cone march at one ray per tile of pass-1 pixels. Writes the distance along the tile's
// centre ray that no ray in the tile can have hit before, so pass 1 starts there instead of at the
// camera. Every step is safe for every ray of the tile: the cone's radius at t is the widest any
// ray strays from the centre ray, and the centre's distance bound minus that radius is a free ball
// around each ray's own point.
uniform int u_maxSteps;
uniform vec2 u_tileHalf;   // half a tile in uv: the footprint of this texel, as pass 1 samples it

in vec2 v_uv;
layout(location = 0) out vec4 o_start;   // r: start distance, W_FAR when the tile misses; g: steps spent (a half holds both)

void main()
{
    vec3 ro = u_camPos;
    vec3 rd = camRay(v_uv);

    // Widest stray of any ray in the tile from the centre ray, per unit t. The rays are the unit
    // directions through a rectangle on the view plane, whose sublevel sets about rd are convex, so
    // the maximum sits at a corner. The margin is for float rounding.
    float spread = 0.0;
    for (int c = 0; c < 4; c++)
    {
        vec2 corner = vec2(c & 1, c >> 1) * 2.0 - 1.0;
        spread = max(spread, length(camRay(v_uv + corner * u_tileHalf) - rd));
    }
    spread *= 1.05;

    // Past tEnd every ray of the tile is above W_MAX_HEIGHT and still rising (or beyond W_FAR):
    // none can hit anything.
    float rise = rd.y - spread;
    float tEnd = W_FAR;
    if (rise > 0.0)
        tEnd = min(W_FAR, max(0.0, (W_MAX_HEIGHT - ro.y) / rise));

    float t = 0.0;
    float leafness;
    bool onTree;
    int evals = 0;
    for (int i = 0; i < u_maxSteps && t < tEnd; i++)
    {
        evals++;
        // Pass 1's hit tolerance, 0.0006 t + 0.01, is kept clear at the far end of the step too, so
        // no ray of the tile starts inside its own hit radius.
        float s = (sceneDistance(ro + rd * t, leafness, onTree) - spread * t - (0.0006 * t + 0.01)) / 1.0006;
        if (s <= 0.0)
            break;
        t += s;
    }
    float start = t;
#ifdef START_HALF
    // The target is RGBA16F: the write rounds to a half, and the round may go up. Any start past
    // the true one is a ray that could skip a surface, so shave more than half a ulp off first
    // (START_HALF_SCALE, START_HALF_BIAS: Scene.ts). W_FAR stays exact, an integer a half holds.
    start = max(0.0, t * START_HALF_SCALE - START_HALF_BIAS);
#endif
    o_start = vec4(t >= tEnd ? W_FAR : start, float(evals), 0.0, 0.0);
}
