const {chromium}=require('playwright');const fs=require('fs');const {spawn}=require('child_process');
const EXE=process.env.EXE;const mode=process.argv[2];
(async()=>{
 const b=await chromium.launch({executablePath:EXE});const pg=await b.newPage({viewport:{width:1920,height:1080}});
 await pg.goto('file://'+__dirname+'/prototype.html');await pg.waitForTimeout(500);
 const durs=JSON.parse(fs.readFileSync(__dirname+'/audio_durs.json'));
 const nar=Object.fromEntries(JSON.parse(fs.readFileSync(__dirname+'/narration.json')));
 const total=await pg.evaluate(([d,n])=>{setNar(n);return setDurs(d)},[durs,nar]);
 const starts=await pg.evaluate(()=>Object.fromEntries(SC.map(s=>[s.k,[s.st,s.dur]])));
 fs.writeFileSync(__dirname+'/starts.json',JSON.stringify({total,starts}));
 if(mode==='preview'){
  const list=process.argv.slice(3);fs.mkdirSync(__dirname+'/prev',{recursive:true});
  for(const it of list){const [k,f]=it.split(':');const [st,du]=starts[k];const t=st+du*parseFloat(f);
   await pg.evaluate(t=>render(t),t);await pg.screenshot({path:`${__dirname}/prev/${k}_${f}.png`});}
 } else {
  const fps=30;const N=Math.ceil(total*fps);
  const ff=spawn('ffmpeg',['-y','-loglevel','error','-f','image2pipe','-framerate',String(fps),'-c:v','mjpeg','-i','-','-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-preset','medium',__dirname+'/video_noaudio.mp4']);
  ff.stderr.on('data',d=>process.stderr.write(d));
  for(let i=0;i<N;i++){await pg.evaluate(t=>render(t),i/fps);const buf=await pg.screenshot({type:'jpeg',quality:93});
   if(!ff.stdin.write(buf))await new Promise(r=>ff.stdin.once('drain',r));if(i%300===0)console.log('frame',i,'/',N);}
  ff.stdin.end();await new Promise(r=>ff.on('close',r));console.log('done',N);
 }
 await b.close();
})();
