(()=>{const T=game.debug.THREE;const cams=game.debug.cameras;const orig=cams.update.bind(cams);
window.__enu=(p)=>{const up=p.clone().normalize();const east=new T.Vector3(-up.y,up.x,0).normalize();const north=new T.Vector3().crossVectors(up,east);return {up,east,north};};
window.__ll=(lat,lon,r)=>{const la=lat*Math.PI/180,lo=lon*Math.PI/180;return new T.Vector3(Math.cos(la)*Math.cos(lo),Math.cos(la)*Math.sin(lo),Math.sin(la)).multiplyScalar(r);};
cams.update=(dt)=>{orig(dt);const c=window.__co;if(!c)return;const v=game.view;v.cameraMCI.copy(c.pos);const z=c.dir.clone().normalize().negate();const x=new T.Vector3().crossVectors(c.up,z).normalize();const y=new T.Vector3().crossVectors(z,x);const m=new T.Matrix4().makeBasis(x,y,z);v.quat.setFromRotationMatrix(m);v.fov=c.fov;};})()
