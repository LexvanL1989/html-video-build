import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {encrypt,decrypt} from './crypto.mjs';

const phase=process.argv[2];
if(!['review','render'].includes(phase))throw Error('Unsupported phase');
const base=process.cwd(),job=resolve('job'),out=resolve('result');
mkdirSync(job,{recursive:true});mkdirSync(out,{recursive:true});
const key=Buffer.from(process.env.RENDER_KEY||'','base64');
if(key.length!==32)throw Error('Missing build key');
const env={...process.env,CI:'1',DO_NOT_TRACK:'1',HYPERFRAMES_TELEMETRY_DISABLED:'1'};
delete env.RENDER_KEY;
let seq=0;
function run(cmd,args,{cwd=job,name,allowFailure=false}={}){
 const r=spawnSync(cmd,args,{cwd,env,encoding:'utf8',timeout:1200000,maxBuffer:32*1024*1024});
 const stem=name||`command-${++seq}`;
 writeFileSync(resolve(out,stem+'.stdout'),r.stdout||'');
 writeFileSync(resolve(out,stem+'.stderr'),r.stderr||'');
 if(r.status!==0&&!allowFailure)throw Error(`Build step ${stem} failed (${r.status})`);
 return r;
}
const hf=resolve('node_modules/.bin/hyperframes');
async function board(files,name){
 const width=270,height=480,columns=4,rows=Math.ceil(files.length/columns);
 const images=await Promise.all(files.map(async(f,i)=>({input:await sharp(f).resize(width,height).toBuffer(),left:(i%columns)*width,top:Math.floor(i/columns)*height})));
 await sharp({create:{width:width*columns,height:height*rows,channels:3,background:'#171522'}}).composite(images).jpeg({quality:92}).toFile(resolve(out,name));
}
try{
 writeFileSync(resolve(job,'input.tar.gz'),decrypt(readFileSync('input.enc'),key),{mode:0o600});
 run('tar',['-xzf','input.tar.gz'],{name:'unpack'});
 const fp=JSON.parse(readFileSync(resolve(job,'check-final-source-fingerprint.json'))).source_hashes_sha256;
 for(const [file,hash] of Object.entries(fp)){
  if(createHash('sha256').update(readFileSync(resolve(job,file))).digest('hex')!==hash)throw Error('Source fingerprint mismatch');
 }
 writeFileSync(resolve(out,'fingerprint-verification.json'),JSON.stringify({matches:true,files:Object.keys(fp).length}));
 console.log('Verified encrypted source; build phase started.');
 if(phase==='review'){
  const r=run(hf,['snapshot','--range','3:8','--frames','8','--describe','false','--json'],{name:'motion-snapshot'});
  const data=JSON.parse(r.stdout);
  if(!data.ok)throw Error('Snapshot did not pass');
  const images=data.frames.map(f=>f.path);
  for(const f of images)copyFileSync(f,resolve(out,basename(f)));
  await board(images,'motion-review.jpg');
 }else{
  const r=run(hf,['preview','--background','--port','3002','--json'],{name:'editable-preview'});
  const response=await fetch('http://127.0.0.1:3002/');
  writeFileSync(resolve(out,'preview-http.json'),JSON.stringify({status:response.status,url:'http://127.0.0.1:3002/#project/job',editable:true,location:'remote build runner'}));
  if(response.status!==200)throw Error('Preview unavailable');
  run(hf,['preview','--stop'],{name:'preview-stop'});
  run(hf,['render','--quality','delivery','--fps','30','--output',resolve(out,'final.mp4'),'--workers','1','--low-memory-mode'],{name:'render'});
  const video=resolve(out,'final.mp4');
  const p=run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',video],{name:'ffprobe'});
  const probe=JSON.parse(p.stdout),v=probe.streams.find(s=>s.codec_type==='video'),a=probe.streams.find(s=>s.codec_type==='audio');
  if(!v||v.width!==1080||v.height!==1920||v.codec_name!=='h264'||v.avg_frame_rate!=='30/1'||Math.abs(Number(probe.format.duration)-18)>.1||!a)throw Error('Media contract failed');
  run('ffmpeg',['-threads','1','-v','error','-i',video,'-f','null','-'],{name:'full-decode'});
  run('ffmpeg',['-hide_banner','-i',video,'-af','loudnorm=I=-14:TP=-1:LRA=11:print_format=json','-f','null','-'],{name:'audio-loudness'});
  const times=[0,0.3,1.5,2.9,3,3.3,4.5,5.9,6,6.3,8,9.9,10,10.3,12,13.9,14,14.3,16,17.9];
  const frames=[];
  for(let i=0;i<times.length;i++){
   const path=resolve(out,`decoded-${String(i).padStart(2,'0')}-${times[i]}s.png`);
   run('ffmpeg',['-v','error','-ss',String(times[i]),'-i',video,'-frames:v','1',path],{name:`decode-${i}`});frames.push(path);
  }
  await board(frames,'decoded-review.jpg');
  const hash=createHash('sha256').update(readFileSync(video)).digest('hex');
  writeFileSync(resolve(out,'verification.json'),JSON.stringify({passed:true,sha256:hash,width:v.width,height:v.height,duration:Number(probe.format.duration),fps:v.avg_frame_rate,frames:v.nb_frames,video_codec:v.codec_name,audio_codec:a.codec_name,audio_channels:a.channels,audio_sample_rate:a.sample_rate,full_decode_errors:false,source_fingerprint_matches:true,sound_human_listened:false,decoded_frame_times:times,visual_review_pending:true},null,2));
 }
 writeFileSync(resolve(out,'build-status.json'),JSON.stringify({ok:true,phase}));
 console.log('Build completed; returning encrypted evidence.');
}catch(e){
 writeFileSync(resolve(out,'build-status.json'),JSON.stringify({ok:false,phase,error:e.message}));
 console.error('Build did not complete; diagnostic details are encrypted.');process.exitCode=1;
}finally{
 if(existsSync(hf))run(hf,['preview','--stop'],{name:'cleanup-preview',allowFailure:true});
 run('tar',['-czf',resolve(base,'result.tar.gz'),'-C',out,'.'],{cwd:base,name:'pack-result'});
 writeFileSync(resolve(base,'output.enc'),encrypt(readFileSync(resolve(base,'result.tar.gz')),key));
}
