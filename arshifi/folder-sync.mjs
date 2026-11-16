import {sourceKey,committedRecord,verifiedMove} from './folder-sync-core.mjs?v=2.2.0';
export function createFolderSync(api){
 const $=s=>document.querySelector(s),esc=api.escape;
 let root=null,rootAccount='',inbox=null,sent=null,items=[],context=null,working=false,dbPromise=null;
 const supported=typeof window.showDirectoryPicker==='function'&&!!window.indexedDB;
 function accountKey(){const s=api.state();if(!s.ready||!s.account)throw Error('اربط حساب Google وانتظر تحميل الأرشيف');return s.account}
 function db(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const req=indexedDB.open('arshifi-folder-sync',1);req.onupgradeneeded=()=>{req.result.createObjectStore('state')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>{dbPromise=null;reject(Error('تعذر فتح سجل المزامنة المحلي'))}});return dbPromise}
 async function read(key){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('state','readonly'),r=t.objectStore('state').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
 async function write(key,value){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('state','readwrite');t.objectStore('state').put(value,key);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error)})}
 const journalKey=(account,key)=>'journal:'+account+':'+key;
 function message(text){$('#syncMessage').textContent=text}
 async function folders(){const account=accountKey();if(rootAccount!==account){root=null;inbox=null;sent=null;rootAccount=account}if(!root){root=await read('root:'+account);if(!root)throw Error('اختَر مجلد مزامنة أرشيفي أولًا')}const options={mode:'readwrite'};if(await root.queryPermission(options)!=='granted'&&await root.requestPermission(options)!=='granted')throw Error('يلزم السماح بقراءة مجلد المزامنة والكتابة فيه');inbox=await root.getDirectoryHandle('الإرسال',{create:true});sent=await root.getDirectoryHandle('تم الإرسال',{create:true});$('#syncRootName').textContent=root.name}
 function render(){
  const selected=items.filter(x=>x.selected&&!x.committed);
  $('#syncReview').disabled=working||!selected.length;$('#syncScan').disabled=working||!supported;$('#syncChoose').disabled=working||!supported;$('#syncRetry').disabled=working||!items.some(x=>x.committed&&x.status!=='تم الإرسال');
  const current=api.state(),previousTarget=$('#syncTarget').value;$('#syncTarget').innerHTML='<option value="">إنشاء سجل جديد</option>'+current.records.filter(r=>!r.deleted).map(r=>'<option value="'+esc(r.id)+'">'+esc(r.title)+'</option>').join('');$('#syncTarget').value=previousTarget;$('#syncSelectAll').checked=items.some(x=>!x.committed)&&items.filter(x=>!x.committed).every(x=>x.selected);$('#syncSelectAll').indeterminate=selected.length>0&&!$('#syncSelectAll').checked;
  $('#syncRows').innerHTML=items.map((x,i)=>'<tr><td><input type="checkbox" data-sync-select="'+i+'" '+(x.selected?'checked':'')+' '+(working||x.committed?'disabled':'')+' aria-label="تحديد '+esc(x.name)+'"></td><td>'+esc(x.name)+'</td><td>'+esc(x.status)+'</td><td>'+esc(x.detail||'')+'</td></tr>').join('');
  $('#syncEmpty').hidden=!!items.length;
 }
 async function guarded(fn){if(working)return;working=true;render();try{await api.exclusive(fn)}catch(e){message(e.message)}finally{working=false;render()}}
 async function scan(){
  if(context)throw Error('أكمل أو أغلق مسودة المزامنة الحالية أولًا');
  const account=accountKey();await folders();await api.refresh();
  items=[];message('جارٍ فحص ملفات الإرسال وحساب بصماتها…');
  for await(const [name,handle] of inbox.entries()){
   if(handle.kind!=='file')continue;
   const file=await handle.getFile(),sha256=await api.digest(file),key=sourceKey(name,sha256);
   let saved=committedRecord(api.state().records,key);const journal=await read(journalKey(account,key));if(!saved&&journal?.reservedDriveId){try{const remote=await api.readRecord(journal.reservedDriveId);if((remote.syncSources||[]).some(s=>s.key===key)){api.rememberRemote(remote,journal.reservedDriveId);saved={...remote,driveId:journal.reservedDriveId}}}catch(e){if(e.status!==404)throw e}}
   const committed=!!saved;
   items.push({key,name,sha256,file,size:file.size,account,selected:false,committed,recordId:saved?.id||journal?.recordId,destination:journal?.destination||'',status:committed?'تم الحفظ — النقل معلّق':journal?.recordId?'يحتاج تحققًا من حفظ سابق':'جاهز للمراجعة',detail:saved?.deleted?'السجل محفوظ في سلة الأرشيف':''});
  }
  message(items.length?'اختر ملفًا واحدًا للمراجعة، أو عدة ملفات لجمعها في سجل واحد. يمكنك تخطي أي ملف بتركه دون تحديد.':'مجلد الإرسال فارغ. ضع الملفات داخله ثم اضغط مزامنة.');
 }
 async function move(item,record){
  if(accountKey()!==item.account)throw Error('تغيّر الحساب؛ أعد المزامنة بالحساب الأصلي');
  const remote=await api.readRecord(record.driveId);
  if(!(remote.syncSources||[]).some(s=>s.key===item.key)||!remote.attachments.some(p=>p.sha256===item.sha256))throw Error('لم يُؤكّد حفظ السجل ومرفقه في Drive؛ لم يُنقل الأصل');
  const journal={recordId:record.id,driveId:record.driveId,reservedDriveId:record.driveId,name:item.name,sha256:item.sha256,destination:item.destination||'',status:'saved'};
  await write(journalKey(item.account,item.key),journal);
  const destination=await verifiedMove(item,inbox,sent,api.digest,async name=>{item.destination=name;journal.destination=name;await write(journalKey(item.account,item.key),journal)});
  item.destination=destination;item.status='تم الإرسال';item.detail='حُفظ في الأرشيف ونُقل إلى '+destination;item.selected=false;
  await write(journalKey(item.account,item.key),{...journal,destination,status:'moved'});
 }
 async function transfer(record,list){
  let done=0;for(const item of list){item.committed=true;item.recordId=record.id;item.status='تم الحفظ — النقل معلّق';try{await move(item,record);done++}catch(e){item.detail=e.message}}
  render();return done===list.length?'تم الحفظ ونقل الملفات إلى تم الإرسال':'تم الحفظ — تعذّر نقل بعض الملفات. افتح مزامنة المجلد ثم أعد محاولة النقل.';
 }
 async function review(){
  if(working)return;
  const selected=items.filter(x=>x.selected&&!x.committed);if(!selected.length)return;const previousPlans=[];
  const account=accountKey(),target=$('#syncTarget').value;working=true;render();
  try{
   await folders();await api.refresh();
   for(const item of selected){
    if(item.account!==account)throw Error('تغيّر الحساب؛ اضغط مزامنة لإعادة فحص الملفات');
    if(committedRecord(api.state().records,item.key))throw Error('يوجد حفظ سابق لهذا الملف؛ اضغط مزامنة ثم إعادة النقل');
    if(await api.digest(await(await inbox.getFileHandle(item.name)).getFile())!==item.sha256)throw Error('تغيّر الملف '+item.name+'؛ أعد الفحص');
    const old=await read(journalKey(account,item.key));
    if(old?.recordId&&api.state().records.some(r=>r.id===old.recordId)&&target!==old.recordId)throw Error('يوجد سجل سابق مرتبط بهذه المحاولة؛ اختره من الوجهة لإلحاق الملفات به');if(old)previousPlans.push(old);
   }
   const existing=target?api.state().records.find(r=>r.id===target&&!r.deleted):null;if(target&&!existing)throw Error('السجل المختار لم يعد متاحًا');
   const reusable=!existing&&previousPlans.length===selected.length&&previousPlans.every(p=>p.recordId===previousPlans[0].recordId&&p.reservedDriveId===previousPlans[0].reservedDriveId);context={account,items:selected,recordId:existing?.id||(reusable?previousPlans[0].recordId:crypto.randomUUID()),reservedDriveId:reusable?previousPlans[0].reservedDriveId:null,existing:!!existing};
   if(navigator.locks){const plan=context;await new Promise((resolve,reject)=>{navigator.locks.request('arshifi-folder-sync:'+account,{ifAvailable:true},async lock=>{if(!lock){reject(Error('توجد مسودة مزامنة مفتوحة في تبويب آخر'));return}await new Promise(release=>{plan.release=release;resolve()})}).catch(reject)})}
   $('#folderSyncDialog').close();
   await api.openDraft(selected,existing);
  }catch(e){context?.release?.();context=null;message(e.message);api.notify(e.message);if(!$('#folderSyncDialog').open&&!$('#editor').open)$('#folderSyncDialog').showModal()}
  finally{working=false;render()}
 }
 async function beforeSave(draft,attachments){
  if(!context)return;
  if(accountKey()!==context.account)throw Error('تغيّر الحساب؛ أعد فتح مسودة المزامنة');
  const included=context.items.filter(x=>attachments.some(p=>p.syncKey===x.key));
  if(!included.length)throw Error('أُزيلت جميع ملفات المزامنة من المسودة. أغلقها أو أعد إرفاق الملفات من المزامنة.');
  draft.id=context.recordId;
  if(!context.existing){if(!context.reservedDriveId)context.reservedDriveId=await api.reserve();draft.reservedDriveId=context.reservedDriveId}
  for(const x of included){
   if(await api.digest(await(await inbox.getFileHandle(x.name)).getFile())!==x.sha256)throw Error('تغيّر الملف الأصلي '+x.name+'؛ أعد المزامنة قبل الحفظ');
   await write(journalKey(x.account,x.key),{recordId:draft.id,reservedDriveId:context.reservedDriveId||null,name:x.name,sha256:x.sha256,status:'awaiting-save',destination:x.destination||''});
  }
  draft.syncSources=[...(draft.syncSources||[]),...included.map(x=>({key:x.key,name:x.name,sha256:x.sha256}))].filter((x,i,a)=>a.findIndex(y=>y.key===x.key)===i);
  context.included=included;
 }
 async function reconcile(){
  if(!context)return false;
  if(accountKey()!==context.account)throw Error('تغيّر الحساب؛ أعد فتح مسودة المزامنة');
  await api.refresh();
  let existing=api.state().records.find(r=>r.id===context.recordId);if(!existing&&context.reservedDriveId){try{const r=await api.readRecord(context.reservedDriveId);api.rememberRemote(r,context.reservedDriveId);existing={...r,driveId:context.reservedDriveId}}catch(e){if(e.status!==404)throw e}}
  const wanted=context.items.filter(x=>api.parts().some(p=>p.syncKey===x.key));
  if(existing&&wanted.length&&wanted.every(x=>(existing.syncSources||[]).some(s=>s.key===x.key))){api.notify(await transfer(existing,wanted));context?.release?.();context=null;return true}
  return false;
 }
 async function afterSave(record){if(!context)return '';const plan=context,list=plan.included||[];context=null;try{return await transfer(record,list)}finally{plan.release?.()}}
 function cancelDraft(){context?.release?.();context=null}
 async function retry(){await folders();await api.refresh();for(const item of items.filter(x=>x.committed&&x.status!=='تم الإرسال')){const r=committedRecord(api.state().records,item.key);if(!r){item.detail='تعذر العثور على السجل؛ لم يُنقل الأصل';continue}await transfer(r,[item])}message('اكتملت محاولة النقل. الملفات المتعثرة تبقى في الإرسال.')}
 async function open(){if(api.state().busy)return;let a;try{a=accountKey()}catch(e){api.notify(e.message);return}if(items.some(x=>x.account!==a))items=[];$('#syncRootName').textContent='لم يُحدّد';$('#folderSyncDialog').showModal();message(supported?'اختر المجلد الرئيسي الذي يحتوي الإرسال وتم الإرسال، ثم اضغط مزامنة.':'هذه الميزة تتطلب Chrome أو Edge داعمًا على الحاسوب. يمكنك استخدام الرفع العادي من الموبايل.');render();if(!supported)return;try{const h=await read('root:'+a);if(h)$('#syncRootName').textContent=h.name}catch(e){message(e.message)}}
 $('#syncChoose').onclick=async()=>{
  if(working||!supported)return;
  // Call picker directly in the user's click, before any asynchronous database work.
  let chosen,chosenAccount;try{chosenAccount=accountKey();chosen=await window.showDirectoryPicker({id:'arshifi-sync',mode:'readwrite'})}catch(e){if(e.name!=='AbortError')message(e.message);return}
  await guarded(async()=>{if(context)throw Error('أغلق مسودة المزامنة قبل تغيير المجلد');if(accountKey()!==chosenAccount)throw Error('تغيّر الحساب؛ أعد اختيار المجلد');root=chosen;rootAccount=chosenAccount;await folders();await write('root:'+chosenAccount,root);items=[];message('تم ربط المجلد. ضع الملفات في الإرسال ثم اضغط مزامنة.');});
 };
 $('#syncScan').onclick=()=>guarded(scan);$('#syncReview').onclick=review;$('#syncRetry').onclick=()=>guarded(retry);
 $('#syncRows').onchange=e=>{const i=e.target.dataset.syncSelect;if(i!==undefined){items[+i].selected=e.target.checked;render()}};
 $('#syncSelectAll').onchange=e=>{items.filter(x=>!x.committed).forEach(x=>x.selected=e.target.checked);render()};
 return {open,beforeSave,afterSave,reconcile,cancelDraft};
}
