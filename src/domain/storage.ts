export interface Routine { id:string; name:string; defaultDurationSec:number; defaultRestSec:number; groups:{id:string;name:string;durationSec:number;restSec:number}[]; createdAt:number; updatedAt:number; }
export const ROUTINES_KEY='group-practice-routines';
export function parseRoutines(raw: unknown): Routine[] { if(!Array.isArray(raw)) return []; return raw.filter(x=>x && typeof x==='object' && typeof (x as Routine).id==='string') as Routine[]; }
export function loadRoutines(storage: {getStorageSync(key:string):unknown}): Routine[] { try{return parseRoutines(storage.getStorageSync(ROUTINES_KEY));}catch{return [];} }
