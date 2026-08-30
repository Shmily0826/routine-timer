import {reconcile} from '../../domain/timer';
import {SESSION_KEY,PREFS_KEY,ROUTINES_KEY,ACTIVE_ROUNDS_KEY} from '../../domain/storage';

function clamp(n:number, min:number, max:number, fallback:number):number{
  const v=Number(n);
  return Number.isFinite(v)?Math.min(max,Math.max(min,v)):fallback;
}

Page({
  data:{groups:8,duration:30,rest:10,expanded:false,items:[] as any[],recovery:null as any,editId:null as any},

  onLoad(options:any){
    const prefs=this.readPrefs();
    if(prefs){
      this.setData({groups:prefs.groups,duration:prefs.duration,rest:prefs.rest,items:prefs.items});
    }else{
      this.setData({items:Array.from({length:8},(_,i)=>({name:`动作 ${i+1}`,work:30,rest:10,ow:false,or:false}))});
    }
    if(options&&options.edit){this.loadRoutineForEdit(String(options.edit));}
  },

  readPrefs(){
    try{
      const p=wx.getStorageSync(PREFS_KEY);
      if(p&&Array.isArray(p.items)&&p.items.length){
        return {
          groups:clamp(p.groups,1,50,p.items.length),
          duration:clamp(p.duration,1,3600,30),
          rest:clamp(p.rest,0,3600,0),
          items:p.items.slice(0,50).map((x:any,i:number)=>({
            name:typeof x.name==='string'?x.name:`动作 ${i+1}`,
            work:clamp(x.work,1,3600,30),
            rest:clamp(x.rest,0,3600,0),
            ow:false,or:false
          }))
        };
      }
    }catch{}
    return null;
  },

  persistPrefs(){
    try{
      wx.setStorageSync(PREFS_KEY,{
        groups:this.data.groups,
        duration:this.data.duration,
        rest:this.data.rest,
        items:this.data.items.map((x:any)=>({name:x.name||'',work:x.work,rest:x.rest}))
      });
    }catch{}
  },

  loadRoutineForEdit(id:string){
    try{
      const list=wx.getStorageSync(ROUTINES_KEY)||[];
      const r=list.find((x:any)=>x&&x.id===id);
      if(r&&Array.isArray(r.rounds)&&r.rounds.length){
        const items=r.rounds.map((x:any,i:number)=>({
          name:typeof x.name==='string'?x.name:`动作 ${i+1}`,
          work:clamp(x.workSec,1,3600,30),
          rest:clamp(x.restSec,0,3600,0),
          ow:true,or:true
        }));
        this.setData({editId:id,groups:items.length,duration:items[0].work,rest:items[0].rest,items});
      }
    }catch{}
  },

  saveRoutine(){
    const rounds=this.data.items.map((x:any)=>({
      name:x.name||'',
      workSec:x.work||this.data.duration,
      restSec:x.rest===undefined?this.data.rest:x.rest
    }));
    if(!rounds.length)return;
    const now=Date.now();
    const list=wx.getStorageSync(ROUTINES_KEY)||[];
    if(this.data.editId){
      const i=list.findIndex((x:any)=>x&&x.id===this.data.editId);
      if(i>=0){list[i]={...list[i],rounds,updatedAt:now};}
      else{list.push({id:this.data.editId,name:`Routine ${list.length+1}`,rounds,createdAt:now,updatedAt:now});}
    }else{
      list.push({id:String(now),name:`Routine ${list.length+1}`,rounds,createdAt:now,updatedAt:now});
    }
    wx.setStorageSync(ROUTINES_KEY,list);
    this.setData({editId:null});
    wx.reLaunch({url:'/pages/routines/routines'});
  },

  onShow(){
    try{
      const s=wx.getStorageSync(SESSION_KEY);
      if(s){
        const r=reconcile(s,Date.now()).session;
        if(r.status==='completed'){wx.removeStorageSync(SESSION_KEY);this.setData({recovery:null});}
        else{wx.setStorageSync(SESSION_KEY,r);this.setData({recovery:{round:r.currentRoundIndex+1,name:r.rounds[r.currentRoundIndex]?.name||''}});}
      }
    }catch{}
  },

  discard(){wx.removeStorageSync(SESSION_KEY);this.setData({recovery:null});},
  continue(){wx.navigateTo({url:'/pages/timer/timer'});},

  onGroups(e:any){
    const n=clamp(e.detail.value,1,50,1);
    this.setData({groups:n,items:Array.from({length:n},(_,i)=>this.data.items[i]||{name:`动作 ${i+1}`,work:this.data.duration,rest:this.data.rest,ow:false,or:false})});
    this.persistPrefs();
  },
  onDuration(e:any){
    const d=clamp(e.detail.value,1,3600,30);
    this.setData({duration:d,items:this.data.items.map((x:any)=>x.ow?x:Object.assign({},x,{work:d}))});
    this.persistPrefs();
  },
  onRest(e:any){
    const r=clamp(e.detail.value,0,3600,0);
    this.setData({rest:r,items:this.data.items.map((x:any)=>x.or?x:Object.assign({},x,{rest:r}))});
    this.persistPrefs();
  },
  toggleDetail(){this.setData({expanded:!this.data.expanded});},
  onName(e:any){this.setData({[`items[${e.currentTarget.dataset.index}].name`]:e.detail.value});this.persistPrefs();},
  onItemWork(e:any){
    const i=e.currentTarget.dataset.index;
    this.setData({[`items[${i}].work`]:clamp(e.detail.value,1,3600,this.data.duration),[`items[${i}].ow`]:true});
    this.persistPrefs();
  },
  onItemRest(e:any){
    const i=e.currentTarget.dataset.index;
    this.setData({[`items[${i}].rest`]:clamp(e.detail.value,0,3600,0),[`items[${i}].or`]:true});
    this.persistPrefs();
  },

  start(){
    wx.setStorageSync(ACTIVE_ROUNDS_KEY,this.data.items.map((x:any)=>({name:x.name||'',workSec:x.work||this.data.duration,restSec:x.rest===undefined?this.data.rest:x.rest})));
    this.persistPrefs();
    wx.removeStorageSync(SESSION_KEY);
    wx.navigateTo({url:'/pages/timer/timer'});
  },
  routines(){wx.navigateTo({url:'/pages/routines/routines'});},
  history(){wx.navigateTo({url:'/pages/history/history'});}
})
