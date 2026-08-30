import {HISTORY_KEY} from '../../domain/storage';

function fmtDur(s:number):string{const m=Math.floor(s/60);const r=s%60;return m?`${m}分${r?r+'秒':''}`:`${r}秒`;}
function fmtDate(ts:number):string{const d=new Date(ts);const p=(n:number)=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;}

interface HistoryRecord { id:string; ts:number; rounds:number; totalWorkSec:number; totalRestSec:number; label:string; }

Page({
  data:{items:[] as any[]},
  onShow(){this.load()},
  load(){
    try{
      const x=wx.getStorageSync(HISTORY_KEY);
      this.setData({items:Array.isArray(x)?x.slice().sort((a:any,b:any)=>b.ts-a.ts).map((r:HistoryRecord)=>({
        id:r.id,
        label:r.label,
        rounds:r.rounds,
        work:fmtDur(r.totalWorkSec||0),
        rest:fmtDur(r.totalRestSec||0),
        total:fmtDur((r.totalWorkSec||0)+(r.totalRestSec||0)),
        date:fmtDate(r.ts)
      })):[]});
    }catch{this.setData({items:[]})}
  },
  clear(){
    wx.showModal({title:'清空历史',content:'确定清空全部训练记录？此操作不可恢复。',success:(r:any)=>{if(r.confirm){wx.removeStorageSync(HISTORY_KEY);this.load();}}});
  },
  remove(e:any){
    const i=e.currentTarget.dataset.index;
    const list=this.data.items.slice();
    list.splice(i,1);
    wx.setStorageSync(HISTORY_KEY,list);
    this.load();
  }
});
