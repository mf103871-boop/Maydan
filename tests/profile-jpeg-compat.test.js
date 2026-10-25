import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import encodeJpeg from '../src/profiles/vendor/jpeg-encoder.js';
import {sanitizeJpeg} from '../server/profiles/images.mjs';

test('portable JPEG output passes the unchanged entropy validator across alignments, qualities and edge blocks', async()=>{
  let seed=778;
  for(const kind of ['avatar','cover'])for(const size of [1,7,8,9,15,16,17,31,32,33])for(const quality of [40,64,88]){
    const width=kind==='avatar'?size:3*size,height=size;
    const data=new Uint8ClampedArray(width*height*4);
    for(let i=0;i<data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data.set([seed&255,(seed>>>8)&255,(seed>>>16)&255,255],i);}
    const {data:bytes}=encodeJpeg({data,width,height},quality);
    assert.ok(bytes instanceof Uint8Array);
    const clean=sanitizeJpeg(bytes,kind);
    assert.equal(clean.width,width);assert.equal(clean.height,height);
    const decoded=await sharp(clean.bytes).raw().toBuffer({resolveWithObject:true});
    assert.equal(decoded.info.width,width);assert.equal(decoded.info.height,height);
  }
});
