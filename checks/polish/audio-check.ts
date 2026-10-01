import { GameAudio } from '../../src/audio';
import { nukeProfile, DEFAULT_DESTRUCTION } from '../../src/destruction-settings';
(window as any).audioCheck = async () => {
  const Real = window.AudioContext;
  const ctx = new OfflineAudioContext(2, 48000*15, 48000);
  (ctx as any).resume = async () => {};
  (window as any).AudioContext = function(){ return ctx; };
  try {
    const a = new GameAudio(); await a.start(); a.setVolume(1);
    a.update(120,[0,10,0],[0,0,1],true);
    for(let i=0;i<100;i++) a.contact({type:'contactSound',p:[0,10,0],material:i%2?'stone':'wood',energy:2,action:'impact'});
    const capped = a.stats;
    for(let i=0;i<8;i++)a.explosion({type:'explosion',p:[0,10,0],water:false,power:1,seed:i,kind:'nuke',yield:'valley',profile:nukeProfile('valley',DEFAULT_DESTRUCTION)});
    const overlap=a.stats;
    const b=await ctx.startRendering(); let peak=0,sum=0;
    for(let c=0;c<b.numberOfChannels;c++)for(const x of b.getChannelData(c)){peak=Math.max(peak,Math.abs(x));sum+=x*x;}
    return {capped,overlap,after:a.stats,peak,rms:Math.sqrt(sum/(b.length*b.numberOfChannels))};
  } finally { window.AudioContext = Real; }
};
