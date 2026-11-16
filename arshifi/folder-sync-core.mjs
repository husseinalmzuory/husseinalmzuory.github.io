export function sourceKey(name,sha256){return sha256+':'+name}
export function committedRecord(records,key){return records.find(r=>(r.syncSources||[]).some(s=>s.key===key))}
export async function verifiedMove(item,inbox,sent,digest,onDestination=async()=>{}){
 let source;
 try{source=await inbox.getFileHandle(item.name)}
 catch(e){if(e.name!=='NotFoundError')throw e;if(!item.destination)throw Error('الملف غير موجود في الإرسال ولم تُسجل نسخة مؤكدة منه');const existing=await sent.getFileHandle(item.destination);const copy=await existing.getFile();if(await digest(copy)!==item.sha256)throw Error('تعذر تأكيد سلامة النسخة في تم الإرسال');return item.destination}
 const original=await source.getFile();
 if(await digest(original)!==item.sha256)throw Error('تغيّر الملف الأصلي؛ بقي في الإرسال للمراجعة');
 const dot=item.name.lastIndexOf('.'),stem=dot>0?item.name.slice(0,dot):item.name,ext=dot>0?item.name.slice(dot):'';
 let target=null,destination=item.destination||item.name;
 for(let n=0;n<1000;n++){
  try{const h=await sent.getFileHandle(destination);const f=await h.getFile();if(await digest(f)===item.sha256){target=h;break}destination=stem+'_'+item.sha256.slice(0,10)+(n?'_'+n:'')+ext}
  catch(e){if(e.name!=='NotFoundError')throw e;target=await sent.getFileHandle(destination,{create:true});break}
 }
 if(!target)throw Error('تعذر إنشاء اسم غير متكرر في تم الإرسال');
 // Record the destination before copying; a failed copy leaves the source untouched.
 await onDestination(destination);
 const writable=await target.createWritable();
 try{await writable.write(original);await writable.close()}catch(e){try{await writable.abort()}catch{}throw e}
 const copy=await target.getFile();
 if(copy.size!==original.size||await digest(copy)!==item.sha256)throw Error('لم تُؤكّد سلامة النسخة؛ بقي الملف الأصلي');
 const latest=await source.getFile();
 if(await digest(latest)!==item.sha256)throw Error('تغيّر الملف أثناء النقل؛ لم يُحذف الأصل');
 await inbox.removeEntry(item.name);
 return destination;
}
