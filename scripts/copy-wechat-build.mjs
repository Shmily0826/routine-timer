import {cp, mkdir, rm} from 'node:fs/promises';
await mkdir('miniprogram', {recursive:true});
await cp('.wechat-build', 'miniprogram', {recursive:true,force:true});
await rm('.wechat-build', {recursive:true,force:true});
