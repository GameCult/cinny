// Probe: the gradient cultmath_fbm_grad / cultmath_phacelle return for vec3(xz * f, c) is (d/dx, d/dz, d/dc, value),
// so the world-z slope is .y, not .z. Compares analytic gradients with central differences at one point.
// Usage (playwright + swiftshader): node harness/scene/gradAxis.cjs <repo>/src/app/features/scene/shaders
const { chromium } = require('playwright'); const fs=require('fs');
const S=process.argv[2];
const cm=fs.readFileSync(S+'/CultMath.glsl','utf8'), ph=fs.readFileSync(S+'/CultMath.Phacelle.glsl','utf8');
const fs_=`#version 300 es
precision highp float; precision highp int;
${cm}
${ph}
out vec4 o;
const float F=1.0/520.0;
float fb(vec2 p){return cultmath_fbm_grad(vec3(p*F,0.0),4,2.0,0.45).w;}
float pc(vec2 p){return cultmath_phacelle(vec3(p/40.0,0.5),vec3(1.5,0.5,0.0),0.0,0.5).cos.w;}
void main(){
 vec2 p=vec2(1234.5,-777.7); float e=0.5;
 int k=int(gl_FragCoord.x);
 if(k==0){vec4 g=cultmath_fbm_grad(vec3(p*F,0.0),4,2.0,0.45); o=vec4(g.xyz*F,0.0);} // analytic per metre: x,y,z
 else if(k==1){o=vec4((fb(p+vec2(e,0))-fb(p-vec2(e,0)))/(2.0*e),(fb(p+vec2(0,e))-fb(p-vec2(0,e)))/(2.0*e),0,0);}
 else if(k==2){vec4 g=cultmath_phacelle(vec3(p/40.0,0.5),vec3(1.5,0.5,0.0),0.0,0.5).cos; o=vec4(g.xyz/40.0,0.0);}
 else {o=vec4((pc(p+vec2(e,0))-pc(p-vec2(e,0)))/(2.0*e),(pc(p+vec2(0,e))-pc(p-vec2(0,e)))/(2.0*e),0,0);}
}`;
(async()=>{const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const pg=await b.newPage();
const r=await pg.evaluate(([src])=>{const c=document.createElement('canvas');const g=c.getContext('webgl2');g.getExtension('EXT_color_buffer_float');
const mk=(t,s)=>{const x=g.createShader(t);g.shaderSource(x,s);g.compileShader(x);if(!g.getShaderParameter(x,g.COMPILE_STATUS))throw g.getShaderInfoLog(x);return x};
const p=g.createProgram();g.attachShader(p,mk(g.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}'));g.attachShader(p,mk(g.FRAGMENT_SHADER,src));g.linkProgram(p);g.useProgram(p);
const t=g.createTexture();g.bindTexture(g.TEXTURE_2D,t);g.texImage2D(g.TEXTURE_2D,0,g.RGBA32F,4,1,0,g.RGBA,g.FLOAT,null);const f=g.createFramebuffer();g.bindFramebuffer(g.FRAMEBUFFER,f);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,t,0);g.viewport(0,0,4,1);g.drawArrays(g.TRIANGLES,0,3);
const o=new Float32Array(16);g.readPixels(0,0,4,1,g.RGBA,g.FLOAT,o);return Array.from(o)},[fs_]).catch(e=>'ERR '+String(e).slice(0,500));
console.log(Array.isArray(r)?['fbm analytic x,y,z','fbm FD dx,dz','phac analytic','phac FD'].map((n,i)=>n+': '+r.slice(i*4,i*4+3).map(v=>v.toExponential(3)).join('  ')).join('\n'):r);await b.close()})();
