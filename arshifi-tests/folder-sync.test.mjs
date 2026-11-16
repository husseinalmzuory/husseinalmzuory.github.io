import {verifiedMove,sourceKey,committedRecord} from '../arshifi/folder-sync-core.mjs';
const results=await(async()=>{
const assert=(value,message)=>{if(!value)throw Error(message)};
const missing=()=>Object.assign(Error('missing'),{name:'NotFoundError'});
const file=data=>({data,size:data.length});
function directory(initial={},options={}){
 const files=new Map(Object.entries(initial));let removed=0;
 return {files,get removed(){return removed},async getFileHandle(name,opt={}){
  if(!files.has(name)){if(!opt.create)throw missing();files.set(name,'')}
  return {async getFile(){if(!files.has(name))throw missing();return file(files.get(name))},
   async createWritable(){let next;return {async write(f){if(options.writeError)throw Error('write failed');next=f.data;if(options.onWrite)options.onWrite()},
    async close(){files.set(name,options.corrupt?'corrupt':next)},async abort(){}}}
  }
 },async removeEntry(name){if(options.removeError)throw Error('remove denied');files.delete(name);removed++}}
}
const digest=async f=>f.data;
const results=[];
function item(){return {name:'a.pdf',sha256:'original'}}
async function throws(fn,pattern){let caught=false;try{await fn()}catch(e){caught=true;if(pattern)assert(e.message.includes(pattern),'unexpected error: '+e.message)}assert(caught,'expected failure')}
{
 const src=directory({'a.pdf':'original'}),dst=directory();const name=await verifiedMove(item(),src,dst,digest);
 assert(name==='a.pdf'&&!src.files.has('a.pdf')&&dst.files.get(name)==='original','success copy/remove');results.push('verified copy then remove');
}
{
 const src=directory({'a.pdf':'original'}),dst=directory({}, {writeError:true});
 await throws(()=>verifiedMove(item(),src,dst,digest));assert(src.files.get('a.pdf')==='original'&&src.removed===0,'write failure removed source');results.push('write failure preserves source');
}
{
 const src=directory({'a.pdf':'original'}),dst=directory({'a.pdf':'other'});
 const name=await verifiedMove(item(),src,dst,digest);assert(name!=='a.pdf'&&dst.files.get('a.pdf')==='other'&&dst.files.get(name)==='original','collision overwrite');results.push('name collision never overwrites other contents');
}
{
 const src=directory({'a.pdf':'changed'}),dst=directory();
 await throws(()=>verifiedMove(item(),src,dst,digest));assert(src.removed===0,'changed source removed');results.push('changed original stays');
}
{
 const src=directory({'a.pdf':'original'}),dst=directory({}, {onWrite(){src.files.set('a.pdf','changed')}});
 await throws(()=>verifiedMove(item(),src,dst,digest));assert(src.files.get('a.pdf')==='changed','concurrent source change lost');results.push('change during copy prevents deletion');
}
{
 const src=directory({'a.pdf':'original'}),dst=directory({}, {corrupt:true});
 await throws(()=>verifiedMove(item(),src,dst,digest));assert(src.removed===0,'bad copy removed source');results.push('copy integrity checked before deletion');
}
{
 const options={removeError:true},src=directory({'a.pdf':'original'},options),dst=directory(),p=item();
 await throws(()=>verifiedMove(p,src,dst,digest,async n=>p.destination=n));
 options.removeError=false;await verifiedMove(p,src,dst,digest);
 assert(dst.files.size===1&&src.removed===1,'retry duplicates');await verifiedMove(p,src,dst,digest);assert(src.removed===1,'repeat delete');results.push('retry after partial move and already moved recovery');
}
{
 const src=directory(),dst=directory({'a.pdf':'wrong'}),p={...item(),destination:'a.pdf'};
 await throws(()=>verifiedMove(p,src,dst,digest));results.push('missing-source recovery validates saved destination');
}
assert(sourceKey('a','hash')!==sourceKey('b','hash'),'source name ignored');
assert(committedRecord([{id:'x',syncSources:[{key:'k'}]}],'k').id==='x','commit lookup');
return results;
})();
console.log('PASS:',results.join('; '));
