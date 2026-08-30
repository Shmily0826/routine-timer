export interface Routine { id:string; name:string; rounds:{name:string;workSec:number;restSec:number}[]; createdAt:number; updatedAt:number; lastUsedAt?:number; }
export const ACTIVE_ROUNDS_KEY='active-rounds';
export const SESSION_KEY='group-timer-session';
export const ROUTINES_KEY='group-timer-routines';
export const PREFS_KEY='group-timer-prefs';
export const HISTORY_KEY='group-timer-history';
export function parseRoutines(raw:unknown):Routine[]{if(!Array.isArray(raw))return [];return raw.filter((x:any)=>x&&typeof x==='object'&&typeof x.id==='string'&&typeof x.name==='string'&&Array.isArray(x.rounds)).map((x:any)=>({...x,rounds:x.rounds.filter((r:any)=>r&&typeof r==='object').map((r:any)=>({name:typeof r.name==='string'?r.name:'',workSec:Number.isFinite(Number(r.workSec))?Math.max(0,Math.floor(Number(r.workSec))):30,restSec:Number.isFinite(Number(r.restSec))?Math.max(0,Math.floor(Number(r.restSec))):0}) )}));}
export function parseSession(raw:unknown):any|null{if(!raw||typeof raw!=='object')return null;const x=raw as any;if(!['running','paused','completed'].includes(x.status)||!['work','rest'].includes(x.phase)||!Array.isArray(x.rounds))return null;return x}
export function loadRoutines(storage:{getStorageSync(k:string):unknown}):Routine[]{try{return parseRoutines(storage.getStorageSync(ROUTINES_KEY))}catch{return []}}
// Numbering by max existing "Routine N" suffix, not list length: after deletes,
// length-based names collide (two "Routine 2").
export function nextRoutineName(list:Routine[]|any[]):string{let max=0;for(const r of list as any[]){if(r&&typeof r.name==='string'){const m=r.name.match(/^Routine (\d+)$/);if(m)max=Math.max(max,Number(m[1]))}}return `Routine ${max+1}`}
