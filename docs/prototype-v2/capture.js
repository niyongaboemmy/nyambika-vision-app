const {chromium}=require('playwright');const fs=require('fs');const {spawn}=require('child_process');
const EXE=process.env.EXE;const mode=process.argv[2];
(async()=>{
 const b=await chromium.launch({executablePath:EXE});
 const pg=await b.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:mode==='screens'?2:1});
 await pg.goto('file://'+__dirname+'/prototype-v2.html');await pg.waitForTimeout(500);
 const durs=JSON.parse(fs.readFileSync(__dirname+'/audio_durs.json'));const nar=Object.fromEntries(JSON.parse(fs.readFileSync(__dirname+'/narration.json')));
 const total=await pg.evaluate(([d,n])=>setDurs(d,n),[durs,nar]);
 const starts=await pg.evaluate(()=>Object.fromEntries(SC.map(s=>[s.k,[s.st,s.dur]])));
 fs.writeFileSync(__dirname+'/starts.json',JSON.stringify({total,starts}));
 const at=async(k,f)=>{const [st,du]=starts[k];await pg.evaluate(t=>render(t),st+du*f);};
 if(mode==='preview'||mode==='screens'){
  const out=process.argv[3];fs.mkdirSync(out,{recursive:true});
  for(const it of process.argv.slice(4)){const [k,f,name]=it.split(':');await at(k,parseFloat(f));
   if(mode==='screens'){const el=(name&&name.startsWith('full'))?null:await pg.$('#phone');
     if(el){await pg.evaluate(()=>{document.getElementById('callouts').style.display='none'});}if(el)await el.screenshot({path:`${out}/${name}.png`,omitBackground:true});else await pg.screenshot({path:`${out}/${name}.png`});}
   else await pg.screenshot({path:`${out}/${k}_${f}.png`});}
 } else {
  const fps=30;const N=Math.ceil(total*fps);
  const ff=spawn('ffmpeg',['-y','-loglevel','error','-f','image2pipe','-framerate',String(fps),'-c:v','mjpeg','-i','-','-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-preset','medium',__dirname+'/video_noaudio.mp4']);
  for(let i=0;i<N;i++){await pg.evaluate(t=>render(t),i/fps);const buf=await pg.screenshot({type:'jpeg',quality:93});
   if(!ff.stdin.write(buf))await new Promise(r=>ff.stdin.once('drain',r));if(i%300===0)console.log('frame',i,'/',N);}
  ff.stdin.end();await new Promise(r=>ff.on('close',r));console.log('done',N);
 }
 await b.close();})();
