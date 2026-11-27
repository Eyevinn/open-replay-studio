// ---------- deterministic match simulation (same t = same frame on every camera) ----------
const L=105, W=68;
function ball(t){
  let x = 38*Math.sin(t*0.061) + 11*Math.sin(t*0.23+1.3) + 4*Math.sin(t*0.71);
  let y = 22*Math.sin(t*0.047+2) + 8*Math.sin(t*0.29+0.4) + 3*Math.sin(t*0.9);
  const z = Math.max(0, 6*Math.sin(t*0.5)**9);              // occasional lofted ball
  return {x:Math.max(-50,Math.min(50,x)), y:Math.max(-32,Math.min(32,y)), z};
}
const formation=[[-50,0],[-36,-22],[-38,-8],[-38,8],[-36,22],[-20,-15],[-22,0],[-20,15],[-6,-24],[-4,0],[-6,24]];
const players=[];
for(let team=0;team<2;team++) formation.forEach((p,i)=>{
  const s=team?-1:1; players.push({team,i,bx:p[0]*s*0.9,by:p[1]*s,ph:i*1.7+team*3.1,gk:i===0});
});
players.push({team:2,i:0,bx:0,by:0,ph:9,gk:false}); // referee
function playerPos(p,t,b){
  if(p.team===2) return {x:b.x*0.8-8+3*Math.sin(t*0.3), y:b.y*0.6-10+3*Math.cos(t*0.27), run:1};
  const slideX = b.x*(p.gk?0.12:0.55), slideY=b.y*(p.gk?0.25:0.35);
  let x=p.bx+slideX+2.5*Math.sin(t*0.4+p.ph), y=p.by+slideY+2.5*Math.cos(t*0.33+p.ph);
  if(!p.gk){ const dx=b.x-x, dy=b.y-y, d=Math.hypot(dx,dy); const w=Math.max(0,1-d/22)*0.85; x+=dx*w; y+=dy*w; }
  return {x:Math.max(-54,Math.min(54,x)), y:Math.max(-35,Math.min(35,y)), run:1};
}

// ---------- tiny 3D camera ----------
function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function norm(a){const l=Math.hypot(...a);return [a[0]/l,a[1]/l,a[2]/l]}
function makeView(pos,target,fov,w,h){
  const f=norm(sub(target,pos)); const r=norm(cross(f,[0,0,1])); const u=cross(r,f);
  const focal = w/(2*Math.tan(fov/2));
  return {pos,f,r,u,focal,w,h};
}
function toCam(v,p){const d=sub(p,v.pos);return [dot(d,v.r),dot(d,v.u),dot(d,v.f)]}
function proj(v,c){return [v.w/2+v.focal*c[0]/c[2], v.h/2-v.focal*c[1]/c[2]]}
const NEAR=0.5;
function polyScreen(v,pts){
  const cs=pts.map(p=>toCam(v,p)), out=[];
  for(let i=0;i<cs.length;i++){
    const a=cs[i], b=cs[(i+1)%cs.length], ai=a[2]>NEAR, bi=b[2]>NEAR;
    if(ai) out.push(a);
    if(ai!==bi){ const k=(NEAR-a[2])/(b[2]-a[2]); out.push([a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,NEAR]); }
  }
  return out.map(c=>proj(v,c));
}
function fillPoly(ctx,s,col){ if(s.length<3) return; ctx.beginPath(); s.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath(); ctx.fillStyle=col; ctx.fill(); }
function line3(ctx,v,a,b){
  let ca=toCam(v,a), cb=toCam(v,b);
  if(ca[2]<NEAR&&cb[2]<NEAR) return;
  if(ca[2]<NEAR){const k=(NEAR-ca[2])/(cb[2]-ca[2]); ca=ca.map((x,i)=>x+(cb[i]-x)*k);}
  if(cb[2]<NEAR){const k=(NEAR-cb[2])/(ca[2]-cb[2]); cb=cb.map((x,i)=>x+(ca[i]-x)*k);}
  const pa=proj(v,ca), pb=proj(v,cb); ctx.moveTo(pa[0],pa[1]); ctx.lineTo(pb[0],pb[1]);
}
const pitchLines=(()=>{ const L2=L/2,W2=W/2, segs=[];
  const rect=(x0,y0,x1,y1)=>{segs.push([[x0,y0],[x1,y0]],[[x1,y0],[x1,y1]],[[x1,y1],[x0,y1]],[[x0,y1],[x0,y0]])};
  rect(-L2,-W2,L2,W2); segs.push([[0,-W2],[0,W2]]);
  rect(-L2,-20.16,-L2+16.5,20.16); rect(L2-16.5,-20.16,L2,20.16);
  rect(-L2,-9.16,-L2+5.5,9.16); rect(L2-5.5,-9.16,L2,9.16);
  for(let i=0;i<40;i++){const a=i/40*Math.PI*2,b=(i+1)/40*Math.PI*2;segs.push([[9.15*Math.cos(a),9.15*Math.sin(a)],[9.15*Math.cos(b),9.15*Math.sin(b)]]);}
  return segs; })();

// cameras: letter, name, view function
const CAMS=[
  {l:"A",name:"Main Wide",  v:(t,b)=>[[0,-58,24],[b.x*0.85,b.y*0.25,0],0.62]},
  {l:"B",name:"Tight",      v:(t,b)=>[[6,-56,22],[b.x,b.y,0.8],0.16]},
  {l:"C",name:"High 18yd L",v:(t,b)=>[[-36,-50,26],[b.x*0.7-8,b.y*0.4,0],0.5]},
  {l:"D",name:"Reverse",    v:(t,b)=>[[0,52,12],[b.x,b.y,0.8],0.3]},
  {l:"E",name:"Goal L",     v:(t,b)=>[[-66,0,5],[Math.min(b.x,10)*0.7-15,b.y*0.8,0],0.55]},
  {l:"F",name:"Goal R",     v:(t,b)=>[[66,0,5],[Math.max(b.x,-10)*0.7+15,b.y*0.8,0],0.55]},
  {l:"G",name:"Spidercam",  v:(t,b)=>[[b.x-16,b.y-8,30],[b.x,b.y,0],0.7]},
  {l:"H",name:"Handheld",   v:(t,b)=>[[b.x*0.5+20,-40+2*Math.sin(t*3),2+0.2*Math.sin(t*5)],[b.x,b.y,0.9],0.22]},
];

const SCENE_NAMES={Football:Object.fromEntries(CAMS.map(c=>[c.l,c.name])),Skate:null};
function drawScene(ctx,w,h,cam,t,opts={}){
  if(typeof CFG!=="undefined"&&CFG.scene==="Skate") return drawSkate(ctx,w,h,cam,t,opts);
  const b=ball(t); const [pos,tgt,fov]=cam.v(t,b);
  const v=makeView(pos,tgt,fov,w,h);
  // stands
  const g=ctx.createLinearGradient(0,0,0,h); g.addColorStop(0,"#161a22"); g.addColorStop(1,"#232833");
  ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
  // crowd speckle (stable per camera)
  ctx.fillStyle="#ffffff10"; for(let i=0;i<160;i++){const x=(i*97.3%1)*w, y=((i*53.7)%h); ctx.fillRect((i*131)%w,y*0.6,2,2);}
  // grass surround + mowing stripes
  fillPoly(ctx,polyScreen(v,[[-62,-42,0],[62,-42,0],[62,42,0],[-62,42,0]]),"#2c6b2f");
  for(let i=0;i<14;i++){ if(i%2) continue; const x0=-L/2+i*L/14, x1=x0+L/14;
    fillPoly(ctx,polyScreen(v,[[x0,-W/2,0],[x1,-W/2,0],[x1,W/2,0],[x0,W/2,0]]),"#347a36"); }
  // ad boards
  fillPoly(ctx,polyScreen(v,[[-56,38,0],[56,38,0],[56,38,0.9],[-56,38,0.9]]),"#1d3d8f");
  fillPoly(ctx,polyScreen(v,[[-56,-38,0],[56,-38,0],[56,-38,0.9],[-56,-38,0.9]]),"#8f1d4d");
  // lines
  ctx.strokeStyle="#ffffffd0"; ctx.lineWidth=Math.max(1,w/400); ctx.beginPath();
  pitchLines.forEach(s=>line3(ctx,v,[s[0][0],s[0][1],0],[s[1][0],s[1][1],0])); ctx.stroke();
  // goals
  ctx.lineWidth=Math.max(1.5,w/250); ctx.beginPath();
  [-L/2,L/2].forEach(x=>{ line3(ctx,v,[x,-3.66,0],[x,-3.66,2.44]); line3(ctx,v,[x,3.66,0],[x,3.66,2.44]); line3(ctx,v,[x,-3.66,2.44],[x,3.66,2.44]); });
  ctx.stroke();
  // players sorted far to near
  const items=players.map(p=>{const q=playerPos(p,t,b); return {p,q,c:toCam(v,[q.x,q.y,0])};}).filter(o=>o.c[2]>NEAR);
  items.push({ball:true,c:toCam(v,[b.x,b.y,b.z+0.11])});
  items.sort((a,b2)=>b2.c[2]-a.c[2]);
  for(const o of items){
    if(o.ball){ const s=proj(v,o.c), sh=proj(v,toCam(v,[b.x,b.y,0])); const r=Math.max(1.5,v.focal*0.22/o.c[2]);
      ctx.fillStyle="#0006"; ctx.beginPath(); ctx.ellipse(sh[0],sh[1],r,r*0.4,0,0,7); ctx.fill();
      ctx.fillStyle="#fff"; ctx.beginPath(); ctx.arc(s[0],s[1],r,0,7); ctx.fill(); continue; }
    const {p,q}=o; const feet=proj(v,o.c), head=proj(v,toCam(v,[q.x,q.y,1.8]));
    const hgt=feet[1]-head[1]; if(hgt<1) continue; const wd=hgt*0.32;
    const shirt = p.team===2?"#111":p.gk?(p.team?"#c6ff2e":"#ff9a1f"):(p.team?"#f2f2f2":"#1f3a8a");
    const shorts= p.team===2?"#111":p.team?"#c42a2a":"#0d1a40";
    ctx.fillStyle="#0005"; ctx.beginPath(); ctx.ellipse(feet[0],feet[1],wd*0.7,wd*0.22,0,0,7); ctx.fill();
    const stride=Math.sin(t*9+p.ph)*wd*0.25;
    ctx.fillStyle="#e2b48f"; ctx.fillRect(feet[0]-wd*0.3+stride,feet[1]-hgt*0.45,wd*0.22,hgt*0.45); ctx.fillRect(feet[0]+wd*0.08-stride,feet[1]-hgt*0.45,wd*0.22,hgt*0.45);
    ctx.fillStyle=shorts; ctx.fillRect(feet[0]-wd/2,feet[1]-hgt*0.55,wd,hgt*0.17);
    ctx.fillStyle=shirt; ctx.fillRect(feet[0]-wd/2,feet[1]-hgt*0.86,wd,hgt*0.33);
    ctx.fillStyle="#d9a77f"; ctx.beginPath(); ctx.arc(head[0],head[1]+hgt*0.07,hgt*0.08,0,7); ctx.fill();
    if(hgt>40){ ctx.fillStyle=p.team?"#c42a2a":"#fff"; ctx.font=`700 ${hgt*0.16}px system-ui`; ctx.textAlign="center"; ctx.fillText(String(p.i+1),feet[0],feet[1]-hgt*0.62); }
  }
  if(!opts.thumb){ // vignette + grain
    const vg=ctx.createRadialGradient(w/2,h/2,h*0.3,w/2,h/2,h*0.9); vg.addColorStop(0,"#0000"); vg.addColorStop(1,"#0008");
    ctx.fillStyle=vg; ctx.fillRect(0,0,w,h);
  }
}

// ---------- skate scene: street best trick, three riders taking turns (same t = same frame on every camera) ----------
// One attempt every SK_P seconds: wait at the start, push, roll, trick at the stair set (flip over it, or slide the rail),
// land (or bail), ride out. The other two wait at the back of the deck. All from t, so replays and angles line up.
const SK_P=15, SK_TP=3.7;
const RIDERS=[{name:"Kai",shirt:"#e64a3b",pants:"#22252b",skin:"#d9a77f",hair:"#2a1d14"},
              {name:"Mila",shirt:"#25b3a3",pants:"#2c3e66",skin:"#c58b62",hair:"#151515"},
              {name:"Rio",shirt:"#f2c230",pants:"#4b3a2a",skin:"#e2b48f",hair:"#6b4a22"}];
const SK_TRICKS=["Kickflip","Heelflip","Tre flip","Boardslide","50-50","Kickflip","Boardslide","Ollie"];
const SKATE_TAGS=["Make","Bail","Kickflip","Heelflip","Tre flip","Boardslide","50-50","Ollie"];
const sstep=(a,b,x)=>{ const k=Math.max(0,Math.min(1,(x-a)/(b-a))); return k*k*(3-2*k); };
function skHash(k){ let x=Math.imul(k+11,2654435761)>>>0; x^=x>>>15; x=Math.imul(x,2246822519)>>>0; x^=x>>>13; return x>>>0; }
function skAttempt(k){ const h=skHash(k), trick=SK_TRICKS[h%SK_TRICKS.length], rail=trick==="Boardslide"||trick==="50-50";
  return {k,rider:((k%3)+3)%3,trick,rail,bail:((h>>>8)%6)===0,Y:rail?3.6:(((h>>>4)%3)-1)*0.8}; }
const skRailZ=x=>Math.max(0.61,0.85+1.2-0.4*x);
// when the rider pops and lands, inside the attempt
const skPop=a=>a.rail?SK_TP-0.24:SK_TP, skLand=a=>a.rail?SK_TP-0.24+1.49:SK_TP+1.1;
function skState(a,tau){
  const o={x:-11,y:a.Y,z:1.2,yaw:0,byaw:0,roll:0,pose:"stand",tilt:0,bx:null,head:0};
  if(tau<1) return o;
  if(tau<2){ const s=tau-1; o.x=-11+2.5*s*s; o.pose="push"; return o; }
  const tr=skPop(a), slide=a.trick==="Boardslide"?Math.PI/2:0;
  if(tau<tr){ o.x=-8.5+5*(tau-2); o.pose=tau>tr-0.45?"crouch":"stand"; return o; }
  let tl=skLand(a), xl;
  if(!a.rail){ xl=5.5;
    if(tau<tl){ const s=tau-tr, k=sstep(0,0.55,s); o.x=5*s; o.z=1.2+4.3*s-4.9*s*s; o.pose="air";
      if(a.trick==="Kickflip") o.roll=2*Math.PI*k; else if(a.trick==="Heelflip") o.roll=-2*Math.PI*k;
      else if(a.trick==="Tre flip"){ o.roll=2*Math.PI*k; o.byaw=2*Math.PI*k; }
      return o; }
  } else { xl=5.2; o.y=3.6; const s=tau-tr;
    if(s<0.32){ const q=s/0.32; o.x=-1.2+4.6*s; o.z=1.2+(skRailZ(o.x)+0.02-1.2)*q+0.35*Math.sin(Math.PI*q); o.pose="air"; o.byaw=slide*q; o.yaw=o.byaw*0.7; return o; }
    if(s<1.04){ o.x=0.27+3.13*(s-0.32)/0.72; o.z=skRailZ(o.x)+0.02; o.pose="grind"; o.byaw=slide; o.yaw=slide*0.7; return o; }
    if(s<1.49){ const q=s-1.04; o.x=3.4+4*q; o.z=Math.max(0,skRailZ(3.4)+0.667*q-4.9*q*q); o.pose="air"; o.byaw=slide*(1-q/0.45); o.yaw=o.byaw*0.7; return o; }
  }
  o.z=0; const y0=o.y, d=tau-tl;
  // ride out: curve over to the gap in the fence (x 13 to 17) and up the alley between the buildings
  const ride=(x0,dd)=>{ const u=Math.min(1,dd/8), m=1-u, P1x=Math.max(x0+4,15), P2x=15, P2y=40;
    o.x=m*m*x0+2*m*u*P1x+u*u*P2x; o.y=m*m*y0+2*m*u*y0+u*u*P2y;
    o.yaw=Math.atan2(2*u*(P2y-y0),2*m*(P1x-x0)+2*u*(P2x-P1x)); o.byaw=o.yaw; o.head=o.yaw; o.roll=0; o.pose=dd>8?"gone":dd<0.4?"crouch":"stand"; };
  if(!a.bail){ ride(xl,d); return o; }
  if(d>=5.3){ ride(xl+5,d-5.3); return o; }
  // bail: rider slides and lies down, the board rolls away upside down; then the rider walks to it
  if(d<0.5){ o.x=xl+2.5*d; o.tilt=Math.PI/2*sstep(0,0.5,d); o.pose="fall"; }
  else if(d<2.3){ o.x=xl+1.25; o.tilt=Math.PI/2; o.pose="fall"; }
  else if(d<2.8){ o.x=xl+1.25; o.tilt=Math.PI/2*(1-sstep(2.3,2.8,d)); o.pose="fall"; }
  else { o.x=xl+1.25+3.75*(d-2.8)/2.5; o.pose="walk"; }
  const bd=Math.min(d,2.5); o.bx=xl+4*bd-0.8*bd*bd; o.by=y0+0.3*bd; o.bz=0; o.byaw=0.5*bd; o.roll=Math.PI*Math.min(1,d/0.3);
  return o; }
// where the tracking cameras look: the rider on now, easing over to the next rider's start near the end of an attempt
function skFocus(t){ const k=Math.floor(t/SK_P), tau=t-k*SK_P, s=skState(skAttempt(k),tau), nx=skAttempt(k+1);
  const m=sstep(SK_P-2.5,SK_P,tau), z=s.z-(s.pose==="fall"?0.65*Math.sin(s.tilt||0):0); return {x:s.x+(-11-s.x)*m, y:s.y+(nx.Y-s.y)*m, z:z+(1.2-z)*m, head:(s.head||0)*(1-m)}; }
const SKATE_CAMS={
  A:{name:"Wide",        v:(t,f)=>[[2,-26,10],[2+(f.x-2)*0.35,0,1],0.78]},
  B:{name:"Tight",       v:(t,f)=>[[9,-11,2.2],[f.x,f.y,f.z+0.9],0.3]},
  // follow: behind the rider's direction of travel, a little to the side while riding along the course
  C:{name:"Follow",      v:(t,f)=>{ const c=Math.cos(f.head), s=Math.sin(f.head), k=2*Math.max(0,c);
    return [[f.x-5.5*c+k*s,f.y-5.5*s-k*c,f.z+1.6+0.05*Math.sin(t*6)],[f.x+1.5*c,f.y+1.5*s,f.z+0.7],0.95]; }},
  D:{name:"Reverse",     v:(t,f)=>[[17,3,1.7],[f.x*0.6+1,f.y*0.5,f.z*0.7+0.9],0.5]},
  E:{name:"Rail Low",    v:(t,f)=>[[5.2,5.6,0.35],[f.x,f.y,f.z+0.8],0.75]},
  F:{name:"Overhead",    v:(t,f)=>[[2,-9,18],[f.x*0.5+2,0,0],0.85]},
  G:{name:"Deck Fisheye",v:(t,f)=>[[-1.2,-2.6,1.45],[f.x*0.4+2,f.y*0.3,1.4],1.25]},
  H:{name:"Long Lens",   v:(t,f)=>[[34,-22,4],[f.x,f.y,f.z+0.9],0.12]},
};
// static course: boxes become faces with an outward normal (back faces are skipped), then everything is depth sorted
const SK_FACES=(()=>{ const F=[];
  const box=(x0,x1,y0,y1,z0,z1,top,side,front)=>{ front=front||side;
    F.push({p:[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],n:[0,0,1],c:top});
    F.push({p:[[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1]],n:[1,0,0],c:front});
    F.push({p:[[x0,y1,z0],[x0,y0,z0],[x0,y0,z1],[x0,y1,z1]],n:[-1,0,0],c:side});
    F.push({p:[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]],n:[0,-1,0],c:side});
    F.push({p:[[x1,y1,z0],[x0,y1,z0],[x0,y1,z1],[x1,y1,z1]],n:[0,1,0],c:side}); };
  box(-16,0,-7,7,0,1.2,"#9aa0a8","#6f757d","#7b818a");                 // start deck
  for(let i=0;i<3;i++) box(i,i+1,-4,4,0,0.9-0.3*i,"#a9afb7","#737981","#868c94");   // stair set
  box(8,14,-6.2,-5.4,0,0.45,"#b9a27a","#8e7a58");                     // granite ledge
  box(26,27.6,-6,6,0,3,"#8d9197","#5f646b");                           // quarter pipe deck
  for(let j=0;j<6;j++){ const a0=j/6*Math.PI/2, a1=(j+1)/6*Math.PI/2, x=a=>26-3*Math.cos(a), z=a=>3-3*Math.sin(a);
    F.push({p:[[x(a1),-6,z(a1)],[x(a0),-6,z(a0)],[x(a0),6,z(a0)],[x(a1),6,z(a1)]],n:[-Math.sin((a0+a1)/2),0,Math.cos((a0+a1)/2)],c:j%2?"#b8a07a":"#b09872"}); }
  const ban=["#1d3d8f","#8f1d4d","#1f6b5a","#5a3d8f","#8f6a1d"];
  // fence with banners, in short pieces (so depth sorting stays right), with a gap at x 13 to 17 where riders leave
  let bi=0; for(let x=-22;x<32;x+=2.7){ const x1=Math.min(32,x+2.7); if(x1>13&&x<17) continue; box(x,x1-0.05,12.6,12.9,0,1.1,"#202734",ban[Math.floor(bi++/2)%5]); }
  box(-40,12,20,27,0,9,"#56627a","#4a5569"); box(18,50,20,27,0,9,"#56627a","#4a5569");   // buildings, with an alley at x 12 to 18
  box(-40,-24,-30,20,0,12,"#4f5a70","#434d61");
  box(44,60,-30,20,0,14,"#4c566b","#404a5d");
  for(let r=0;r<3;r++) for(let c=0;c<24;c++){ const x0=-37+c*3.6, z0=1.8+r*2.4, lit=((c*7+r*3)%5)===0; if(x0>10&&x0<18.5) continue;  // windows on the long buildings
    F.push({p:[[x0,19.97,z0],[x0+1.8,19.97,z0],[x0+1.8,19.97,z0+1.3],[x0,19.97,z0+1.3]],n:[0,-1,0],c:lit?"#d8c98c":"#7f93ad"}); }
  for(let r=0;r<4;r++) for(let c=0;c<9;c++){ const y0=-26+c*5, z0=2+r*2.5, lit=((c*5+r)%6)===0;             // and on the tall one at the end
    F.push({p:[[43.97,y0+2,z0],[43.97,y0,z0],[43.97,y0,z0+1.4],[43.97,y0+2,z0+1.4]],n:[-1,0,0],c:lit?"#d8c98c":"#7a8ea8"}); }
  return F; })();
// people watching behind the fence (stable)
const SK_CROWD=Array.from({length:44},(_,i)=>({x:-20+i*1.15+((i*37)%7)*0.08,y:13.5+((i*53)%9)*0.12,h:1.55+((i*29)%5)*0.06,c:["#c9cfd8","#e64a3b","#2c3e66","#f2c230","#25b3a3","#8a8f98"][i%6],ph:i*1.3})).filter(p=>p.x<10||p.x>19.5);

function drawSkate(ctx,w,h,cam,t,opts){
  const def=SKATE_CAMS[cam.l]||SKATE_CAMS.A, f=skFocus(t), [pos,tgt,fov]=def.v(t,f), v=makeView(pos,tgt,fov,w,h);
  // sky and ground
  const g=ctx.createLinearGradient(0,0,0,h); g.addColorStop(0,"#4f6683"); g.addColorStop(1,"#a4b3c4"); ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
  fillPoly(ctx,polyScreen(v,[[-200,-200,0],[200,-200,0],[200,200,0],[-200,200,0]]),"#454a52");
  fillPoly(ctx,polyScreen(v,[[-30,-14,0],[42,-14,0],[42,14,0],[-30,14,0]]),"#7d8189");
  ctx.strokeStyle="#ffffff14"; ctx.lineWidth=1; ctx.beginPath();
  for(let x=-28;x<=40;x+=4) line3(ctx,v,[x,-14,0.005],[x,14,0.005]); for(let y=-12;y<=12;y+=4) line3(ctx,v,[-30,y,0.005],[42,y,0.005]); ctx.stroke();
  const depth=p=>toCam(v,p)[2], items=[];
  for(const fc of SK_FACES){ const c=fc.p.reduce((a,p)=>[a[0]+p[0]/4,a[1]+p[1]/4,a[2]+p[2]/4],[0,0,0]);
    if(dot(fc.n,sub(pos,c))<=0) continue; const ds=fc.p.map(depth); if(ds.every(x=>x<NEAR)) continue;
    // floors (the deck, step tops) sort by their far edge, so a rider standing on one is always drawn on top of it
    items.push({d:fc.n[2]===1?Math.max(...ds):depth(c),face:fc}); }
  // handrail in four pieces, with posts
  for(let i=0;i<4;i++){ const x0=-0.6+i*1.05, x1=x0+1.05; items.push({d:depth([(x0+x1)/2,3.6,skRailZ((x0+x1)/2)]),rail:[[x0,3.6,skRailZ(x0)],[x1,3.6,skRailZ(x1)]]}); }
  [0,1.5,3].forEach(x=>items.push({d:depth([x,3.6,0.5]),rail:[[x,3.6,x<3?0.9-0.3*Math.floor(x):0],[x,3.6,skRailZ(x)]],post:true}));
  // ledge coping
  items.push({d:depth([11,-5.4,0.45]),rail:[[8,-5.4,0.46],[14,-5.4,0.46]],coping:true});
  for(const p of SK_CROWD){ const d=depth([p.x,p.y,1]); if(d>NEAR) items.push({d,crowd:p}); }
  // riders: the one on now, the previous one if still riding out, the others waiting at the back of the deck
  const k=Math.floor(t/SK_P), tau=t-k*SK_P, a=skAttempt(k), pa=skAttempt(k-1), cur=skState(a,tau), prev=skState(pa,tau+SK_P);
  const riders=[[a.rider,cur]]; if(prev.pose!=="gone") riders.push([pa.rider,prev]);
  const q1=skAttempt(k+1).rider, q2=skAttempt(k+2).rider;
  riders.push([q1,{x:-14.5,y:-5,z:1.2,yaw:0.2,byaw:0.2,roll:0,pose:"stand",tilt:0,bx:null,idle:1}]);
  if(prev.pose==="gone") riders.push([q2,{x:-14.6,y:-3.5,z:1.2,yaw:-0.1,byaw:-0.1,roll:0,pose:"stand",tilt:0,bx:null,idle:2}]);
  for(const [r,s] of riders){ if(s.pose==="gone") continue; const d=depth([s.x,s.y,s.z+0.9]); if(d>NEAR) items.push({d,rider:r,s}); }
  items.sort((p,q)=>q.d-p.d);
  for(const it of items){
    if(it.face){ fillPoly(ctx,polyScreen(v,it.face.p),it.face.c); continue; }
    if(it.rail){ ctx.strokeStyle=it.coping?"#c9ced6":"#d6dbe2"; ctx.lineWidth=Math.max(1,v.focal*(it.post?0.04:0.05)/Math.max(it.d,1)); ctx.beginPath(); line3(ctx,v,it.rail[0],it.rail[1]); ctx.stroke(); continue; }
    if(it.crowd){ const p=it.crowd, ft=proj(v,toCam(v,[p.x,p.y,0])), hd=proj(v,toCam(v,[p.x,p.y,p.h+0.05*Math.sin(t*2+p.ph)])), hg=ft[1]-hd[1]; if(hg<1) continue;
      ctx.fillStyle=p.c; ctx.fillRect(ft[0]-hg*0.16,hd[1]+hg*0.18,hg*0.32,hg*0.5); ctx.fillStyle="#d9a77f"; ctx.beginPath(); ctx.arc(hd[0],hd[1]+hg*0.09,hg*0.09,0,7); ctx.fill(); continue; }
    skDrawRider(ctx,v,pos,RIDERS[it.rider],it.s,t);
  }
  if(!opts.thumb){ const vg=ctx.createRadialGradient(w/2,h/2,h*0.3,w/2,h/2,h*0.9); vg.addColorStop(0,"#0000"); vg.addColorStop(1,"#0007"); ctx.fillStyle=vg; ctx.fillRect(0,0,w,h); }
}
function skGround(x,y){ if(x<0&&x>-16&&Math.abs(y)<7) return 1.2; if(x>=0&&x<3&&Math.abs(y)<4) return 0.9-0.3*Math.floor(x); return 0; }
function skDrawRider(ctx,v,camPos,R,s,t){
  const P=p=>{ const c=toCam(v,p); return c[2]>NEAR?proj(v,c):null; }, W=p=>{ const c=toCam(v,p); return c[2]>NEAR?c[2]:1e9; };
  const add=(a,b,k=1)=>[a[0]+b[0]*k,a[1]+b[1]*k,a[2]+b[2]*k];
  const dir=[Math.cos(s.yaw),Math.sin(s.yaw),0], side=[-Math.sin(s.yaw),Math.cos(s.yaw),0];
  // shadow on whatever is under the rider
  const gz=skGround(s.x,s.y), sh=P([s.x,s.y,gz+0.01]), dd=W([s.x,s.y,gz]);
  if(sh&&s.pose!=="fall"){ const r=v.focal*0.35/dd; ctx.fillStyle="#0005"; ctx.beginPath(); ctx.ellipse(sh[0],sh[1],r,r*0.35,0,0,7); ctx.fill(); }
  // board: a short plank that can flip (roll) and spin (yaw); grip tape on top, wood underneath
  const bx=s.bx!=null?s.bx:s.x, by=s.bx!=null?s.by:s.y, bz=(s.bx!=null?s.bz:s.z)+0.08;
  const bd=[Math.cos(s.byaw),Math.sin(s.byaw),0], bs=[-Math.sin(s.byaw),Math.cos(s.byaw),0];
  const wv=add([bs[0]*Math.cos(s.roll)*0.11,bs[1]*Math.cos(s.roll)*0.11,0],[0,0,1],0.11*Math.sin(s.roll)), B=[bx,by,bz];
  const quad=[add(add(B,bd,-0.42),wv,-1),add(add(B,bd,0.42),wv,-1),add(add(B,bd,0.42),wv,1),add(add(B,bd,-0.42),wv,1)];
  const nrm=cross(bd,wv), up=dot(nrm,sub(camPos,B))>0;
  fillPoly(ctx,polyScreen(v,quad),up?"#1b1c1f":"#c8894a");
  // body as thick strokes: legs, torso, arms, head
  const crouch={stand:0,push:0.05,crouch:0.35,air:0.45,grind:0.3,walk:0,fall:0}[s.pose]||0;
  const hgt=1.74*(1-crouch*0.42), tilt=s.tilt||0;
  const U=[dir[0]*Math.sin(tilt),dir[1]*Math.sin(tilt),Math.cos(tilt)];
  const base=s.pose==="fall"||s.pose==="walk"?[s.x,s.y,s.z+0.02]:[s.x,s.y,s.z+0.13];
  const hip=add(base,U,hgt*0.5), sho=add(base,U,hgt*0.8), head=add(base,U,hgt*0.92);
  const step=s.pose==="walk"?0.25*Math.sin(t*7):0;
  const fF=s.pose==="walk"?add(base,dir,step):add(base,bd,0.2), fB=s.pose==="walk"?add(base,dir,-step):add(base,bd,-0.2);
  const knee=(f)=>add(add(f,[(hip[0]-f[0])/2,(hip[1]-f[1])/2,(hip[2]-f[2])/2]),dir,0.18*crouch+0.02);
  const lw=Math.max(1,v.focal*0.14/W(hip));
  const seg=(pts,col,width)=>{ const sp=pts.map(P); if(sp.some(p=>!p)) return; ctx.strokeStyle=col; ctx.lineWidth=width; ctx.lineCap="round"; ctx.lineJoin="round"; ctx.beginPath(); sp.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.stroke(); };
  seg([fF,knee(fF),hip],R.pants,lw); seg([fB,knee(fB),hip],R.pants,lw);
  seg([hip,sho],R.shirt,lw*1.45);
  const [spread,drop]={stand:[0.13,-0.58],walk:[0.14,-0.56],push:[0.25,-0.45],crouch:[0.42,-0.22],air:[0.48,-0.05],grind:[0.52,-0.08],fall:[0.45,-0.1]}[s.pose]||[0.13,-0.58];
  const swing=s.idle?0.04*Math.sin(t*1.5+s.idle):s.pose==="walk"?0.12*Math.sin(t*7):0;
  seg([sho,add(add(add(sho,side,spread),[0,0,1],drop),dir,swing)],R.shirt,lw*0.8); seg([sho,add(add(add(sho,side,-spread),[0,0,1],drop),dir,-swing)],R.shirt,lw*0.8);
  const hp=P(head); if(hp){ const r=Math.max(1.2,v.focal*0.115/W(head)); ctx.fillStyle=R.skin; ctx.beginPath(); ctx.arc(hp[0],hp[1],r,0,7); ctx.fill();
    ctx.fillStyle=R.hair; ctx.beginPath(); ctx.arc(hp[0],hp[1],r,Math.PI*1.05,Math.PI*1.95); ctx.fill(); }
}
