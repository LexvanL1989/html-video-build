import {createServer} from 'node:http';
import {readFileSync,writeFileSync,copyFileSync,existsSync,statSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

// Generic static HTML export. Brand sources and results stay in encrypted archives.
export async function renderCarousel({job,out,config}){
 const w=config.width,h=config.height,count=config.slides;
 if(!Number.isInteger(count)||count<1||count>10||w!==1080||h!==1350)throw Error('Invalid carousel export dimensions/count');
 const selected=config.renderSlides||Array.from({length:count},(_,i)=>i+1);
 if(!Array.isArray(selected)||!selected.length||selected.some(n=>!Number.isInteger(n)||n<1||n>count))throw Error('Invalid selected slides');
 const prior=config.reuseVerification?JSON.parse(readFileSync(resolve(job,config.reuseVerification))):null;
 const chrome=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(existsSync);
 if(!chrome)throw Error('Runner Chrome is unavailable');
 const mime={'.html':'text/html; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.json':'application/json'};
 const server=createServer((req,res)=>{
  const p=resolve(job,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!p.startsWith(job+sep)||!existsSync(p)||!statSync(p).isFile()){res.writeHead(404).end();return}
  res.setHeader('Content-Type',mime[extname(p)]||'application/octet-stream');res.end(readFileSync(p));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try{
  browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage();await page.setViewport({width:w,height:h,deviceScaleFactor:1});
  const failures=[];page.on('pageerror',e=>failures.push(e.message));
  await page.setRequestInterception(true);
  page.on('request',r=>r.url().startsWith('http://127.0.0.1:')||r.url().startsWith('data:')?r.continue():r.abort());
  const files=[],checks=[];
  for(let n=1;n<=count;n++){
   if(!selected.includes(n)){
    const file=prior?.files[n-1],check=prior?.checks.find(c=>c.slide===n);
    if(!prior?.passed||!file||!check||check.text!==config.texts?.[n-1])throw Error(`Slide ${n} has no matching prior check`);
    const source=resolve(job,'exports',file.file),buf=readFileSync(source);
    if(createHash('sha256').update(buf).digest('hex')!==file.sha256)throw Error(`Slide ${n} reuse hash mismatch`);
    copyFileSync(source,resolve(out,file.file));files.push(file);checks.push({...check,reused_unchanged:true});continue;
   }
   await page.goto(`http://127.0.0.1:${server.address().port}/${config.entry||'slides.html'}?slide=${n}`,{waitUntil:'networkidle0'});
   const ready=await page.evaluate(()=>window.slideReady);
   const layout=await page.evaluate(()=>{
    const h=document.querySelector('h1'),b=h.getBoundingClientRect(),foot=document.querySelector('.footer').getBoundingClientRect();
    return{pageWidth:document.documentElement.scrollWidth,pageHeight:document.documentElement.scrollHeight,heading:{x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom},headingFont:getComputedStyle(h).fontFamily,headingColor:getComputedStyle(h).color,text:h.innerText.replace(/\n/g,' '),footerText:document.querySelector('.footer').innerText,imageCount:document.images.length,imagesComplete:Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0),lineOverflow:Array.from(h.children).some(i=>i.scrollWidth>i.clientWidth),footerBottom:foot.bottom};
   });
   if(!ready.fontLoaded||!layout.imagesComplete||layout.lineOverflow||layout.pageWidth!==w||layout.pageHeight!==h||layout.heading.bottom>515||layout.footerBottom>h||failures.length)throw Error(`Slide ${n} failed font/image/layout/runtime check`);
   if(config.texts&&layout.text!==config.texts[n-1])throw Error(`Slide ${n} text mismatch`);
   const name=`komdan-wat-trek-jij-aan-${String(n).padStart(2,'0')}.png`,path=resolve(out,name);
   await page.screenshot({path,type:'png',fullPage:false});
   const meta=await sharp(path).metadata();if(meta.width!==w||meta.height!==h)throw Error('PNG size mismatch');
   const buf=readFileSync(path);files.push({file:name,width:meta.width,height:meta.height,format:meta.format,bytes:buf.length,sha256:createHash('sha256').update(buf).digest('hex')});checks.push({slide:n,...ready,...layout});
  }
  const thumbs=await Promise.all(files.map(async(f,i)=>({input:await sharp(resolve(out,f.file)).resize(324,405).toBuffer(),left:i*324,top:0})));
  await sharp({create:{width:count*324,height:405,channels:3,background:'#0C0C16'}}).composite(thumbs).png().toFile(resolve(out,'carousel-overview.png'));
  writeFileSync(resolve(out,'carousel-verification.json'),JSON.stringify({passed:true,browser:await browser.version(),rendered_slides:selected,reused_slides:checks.filter(c=>c.reused_unchanged).map(c=>c.slide),files,checks,runtime_errors:failures,visual_review_pending:true},null,2));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}
}
