import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const listeners=new Map(),notifications=[],navigation=[];
let closed=false,focused=false;
const existing={url:"https://smf.test/viaggio",async navigate(url){navigation.push(url);this.url=url;return this;},async focus(){focused=true;return this;}};
const self={
  location:{origin:"https://smf.test"},
  clients:{claim:async()=>{},matchAll:async()=>[existing],openWindow:async(url)=>navigation.push(url)},
  registration:{showNotification:async(title,options)=>notifications.push({title,options})},
  addEventListener(type,handler){listeners.set(type,handler);},skipWaiting:async()=>{},
};
const inertCaches={open:async()=>({addAll:async()=>{},keys:async()=>[],match:async()=>null,put:async()=>{},delete:async()=>{}}),keys:async()=>[],delete:async()=>{},match:async()=>null};
const context=vm.createContext({self,caches:inertCaches,fetch:async()=>new Response(),Request,Response,Headers,URL,Date,Promise,Map,Set,console});
vm.runInContext(await readFile("public/sw.js","utf8"),context,{filename:"public/sw.js"});
async function dispatch(type,event){let pending=Promise.resolve();listeners.get(type)({...event,waitUntil(value){pending=Promise.resolve(value);}});await pending;}
await dispatch("push",{data:{json:()=>({title:"Programma aggiornato",body:"Il transfer cambia orario",url:"/viaggio?tab=programma",tag:"disruption-departure-1"})}});
assert.equal(notifications.length,1);
assert.equal(notifications[0].title,"Programma aggiornato");
assert.equal(notifications[0].options.body,"Il transfer cambia orario");
assert.equal(notifications[0].options.data.url,"/viaggio?tab=programma");
assert.equal(notifications[0].options.actions[0].action,"open");
await dispatch("notificationclick",{notification:{data:{url:"/viaggio?tab=programma"},close(){closed=true;}}});
assert.equal(closed,true);assert.equal(focused,true);
assert.deepEqual(navigation,["https://smf.test/viaggio?tab=programma"]);
const companion=await readFile("components/pwa-companion.tsx","utf8");
assert.match(companion,/Notification\.requestPermission\(\)/);
assert.match(companion,/pushManager\.subscribe/);
assert.match(companion,/\/api\/traveler\/push-subscriptions/);
console.log(JSON.stringify({status:"passed",backgroundNotification:true,deepLink:true,existingWindowFocused:true,permissionFlow:true,subscriptionEndpoint:true}));
