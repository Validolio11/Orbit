const { test } = require('node:test');
const assert = require('node:assert/strict');
test('radial sectors map each cardinal position correctly and reject dead zones', async () => {
  const {sectorAt}=await import('../src/renderer/wheel.mjs');
  assert.equal(sectorAt(0,-150,8),0);
  assert.equal(sectorAt(150,0,8),2);
  assert.equal(sectorAt(0,150,8),4);
  assert.equal(sectorAt(-150,0,8),6);
  assert.equal(sectorAt(0,0,8),-1);
  assert.equal(sectorAt(0,-250,8),-1);
  assert.equal(sectorAt(100,0,0),-1);
});
test('radial math round trips the center of every sector including odd and maximum counts',async()=>{
  const {sectorAt,sectorPath}=await import('../src/renderer/wheel.mjs');
  for(const count of [1,2,3,5,8,12])for(let index=0;index<count;index++){
    const angle=(-90+index*360/count)*Math.PI/180;
    assert.equal(sectorAt(150*Math.cos(angle),150*Math.sin(angle),count),index);
    assert.equal(/NaN|Infinity/.test(sectorPath(index,count)),false);
  }
});
test('sector gutters have equal width at both ends and every sector count',async()=>{
  const {sectorPath}=await import('../src/renderer/wheel.mjs');
  for(const count of [2,3,5,8,12])for(let index=0;index<count;index++){
    const path=sectorPath(index,count);
    const values=[...path.matchAll(/(?:M|L)([\d.-]+),([\d.-]+)/g)].map(m=>[Number(m[1])-240,Number(m[2])-240]);
    const start=-Math.PI/2+index*2*Math.PI/count-Math.PI/count;
    const end=start+2*Math.PI/count;
    const outerOffset=-Math.sin(start)*values[0][0]+Math.cos(start)*values[0][1];
    const innerOffset=-Math.sin(end)*values[1][0]+Math.cos(end)*values[1][1];
    assert.ok(Math.abs(outerOffset-3)<.002,`outer edge: ${count} sectors`);
    assert.ok(Math.abs(innerOffset+3)<.002,`inner edge: ${count} sectors`);
    const next=sectorPath((index+1)%count,count).match(/^M([\d.-]+),([\d.-]+)/);
    const neighborOffset=-Math.sin(end)*(Number(next[1])-240)+Math.cos(end)*(Number(next[2])-240);
    assert.ok(Math.abs(neighborOffset-3)<.002);
  }
});
