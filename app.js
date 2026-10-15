/* EliteVolt Systems Business Manager */
const CLIENT_ID = "963866679895-pjiipqqa4imbkmfs1uvm73eavp9d8am9.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file";
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";
const APP_FOLDER = "EliteVolt Systems Data";
const DATA_FILE = "elitevolt-data.json";
const LOCAL_DATA_KEY = "evs-flow-local-workspace-v1";
const LOCAL_DB_NAME = "evs-flow-local-workspace";
const LOCAL_DB_STORE = "workspace";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const CURRENCY_SYMBOLS = {GHS:"GH₵", USD:"$", EUR:"€", NGN:"₦", "GH₵":"GH₵"};
const money = (n, currency=state.settings.currency || "GHS") => `${CURRENCY_SYMBOLS[currency] || currency || "GH₵"} ${Number(round2(n || 0)).toLocaleString(currency==="USD"?"en-US":"en-GH",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const round2 = n => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const uid = (p="id") => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const today = () => new Date().toISOString().slice(0,10);

// Automatically creates a readable, unique SKU such as SOL-SOLARPANEL-001
// or INV-DEYE6KW-001. Existing SKUs are never overwritten when editing.
function makeSku(category, productName){
  const clean = (v="") => String(v).toUpperCase().replace(/[^A-Z0-9]+/g,"").slice(0,10);
  const cat = clean(category).slice(0,3) || "GEN";
  const name = clean(productName).slice(0,10) || "ITEM";
  const base = `${cat}-${name}`;
  const used = new Set(state.products.map(p => String(p.sku || "").toUpperCase()));
  let n = 1;
  let sku = `${base}-${String(n).padStart(3,"0")}`;
  while(used.has(sku)){ n++; sku = `${base}-${String(n).padStart(3,"0")}`; }
  return sku;
}
const esc = (s="") => String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const businessLogoSource = () => esc(state.settings.logoData || "assets/elitevolt-logo.png");
const printLogoWatermark = () => `<img class="print-logo-watermark" src="${businessLogoSource()}" alt="" aria-hidden="true">`;

let state = defaultState();
let charts = {};
let tokenClient = null;
let driveFileId = null;
let driveFolderId = null;
let saveTimer = null;
let driveReady = false;
let driveWorkspaceLoaded = false;
let driveSavePromise = null;
let driveSaveQueued = false;
let localDbPromise = null;
let localWritePromise = Promise.resolve();
let authAttempt = 0;
let authTimeout = null;
let activeActionMenu = null;
let activeActionList = null;
let activeActionButton = null;

function defaultState(){
  return {
    version: 4,
    products: [],
    customers: [],
    invoices: [],
    estimates: [],
    proformas: [],
    suppliers: [],
    purchaseOrders: [],
    purchaseInvoices: [],
    waybills: [],
    receipts: [],
    creditNotes: [],
    expenses: [],
    auditLog: [],
    transactions: [],
    settings: {
      name:"EliteVolt Systems",
      phone:"",
      email:"",
      address:"",
      tax:"",
      prefix:"EVS",
      currency:"GHS",
      footer:"Thank you for doing business with EliteVolt Systems.",
      companyReg:"",
      taxCategories:"NHIL 2.5%, GETFund 2.5%, VAT 12.5%",
      defaultTaxRate:0,
      salesContract:"",
      documentNotes:"",
      paymentTerms:"Payment due as stated on the document.",
      bankDetails:"",
      documentValidityDays:7,
      role:"Super Admin",
      taxEnabled:true
    }
  };
}
function mergeState(raw){
  const base=defaultState();
  return {
    ...base,...raw,
    version:4,
    products:Array.isArray(raw?.products)?raw.products.map(p=>({...p,description:p.description||""})):[],
    customers:Array.isArray(raw?.customers)?raw.customers:[],
    invoices:Array.isArray(raw?.invoices)?raw.invoices.map(i=>({...i,currency:i.currency||"GHS",dueDate:i.dueDate||addDays(i.date||today(),30),items:Array.isArray(i.items)?i.items.map(x=>({...x,lineId:x.lineId||uid("line")})):[],stockDeducted:i.stockDeducted??false,paid:Number(i.paid||0),delivered:!!i.delivered,reserved:i.reserved??(Number(i.paid||0)>0&&!i.delivered)})):[],
    estimates:Array.isArray(raw?.estimates)?raw.estimates.map(i=>({...i,currency:i.currency||"GHS",items:Array.isArray(i.items)?i.items.map(x=>({...x,lineId:x.lineId||uid("line")})):[]})):[],
    proformas:Array.isArray(raw?.proformas)?raw.proformas.map(i=>({...i,currency:i.currency||"GHS",items:Array.isArray(i.items)?i.items.map(x=>({...x,lineId:x.lineId||uid("line")})):[]})):[],
    suppliers:Array.isArray(raw?.suppliers)?raw.suppliers:[],
    purchaseOrders:Array.isArray(raw?.purchaseOrders)?raw.purchaseOrders.map(i=>({...i,currency:i.currency||"GHS",items:Array.isArray(i.items)?i.items.map(x=>({...x,lineId:x.lineId||uid("pline"),receivedQty:Number(x.receivedQty||0)})):[]})):[],
    purchaseInvoices:Array.isArray(raw?.purchaseInvoices)?raw.purchaseInvoices.map(i=>({...i,currency:i.currency||"GHS",items:Array.isArray(i.items)?i.items.map(x=>({...x,lineId:x.lineId||uid("pline"),receivedQty:Number(x.receivedQty||0)})):[]})):[],
    waybills:Array.isArray(raw?.waybills)?raw.waybills.map(w=>({...w,items:Array.isArray(w.items)?w.items.map(x=>({...x,handledQty:Number(x.handledQty||0)})):[]})):[],
    receipts:Array.isArray(raw?.receipts)?raw.receipts.map(r=>({...r,currency:r.currency||"GHS"})):[],
    creditNotes:Array.isArray(raw?.creditNotes)?raw.creditNotes:[],
    expenses:Array.isArray(raw?.expenses)?raw.expenses.map(x=>({...x,currency:x.currency||"GHS"})):[],
    auditLog:Array.isArray(raw?.auditLog)?raw.auditLog:[],
    transactions:Array.isArray(raw?.transactions)?raw.transactions.map(x=>({...x,currency:x.currency||"GHS"})):[],
    settings:{...base.settings,...(raw?.settings||{}),currency:raw?.settings?.currency==="GH₵"?"GHS":(raw?.settings?.currency||base.settings.currency),taxCategories:raw?.settings?.taxCategories==="NHIL 2.5%, GETFund 2.5%, VAT 15%"?base.settings.taxCategories:(raw?.settings?.taxCategories||base.settings.taxCategories)}
  };
}
function toast(msg,type="success"){
  const el=$("#toast");
  if(type==="success"&&/^(could not|cannot|can't|failed|error|enter |select |add |choose |no |not enough|invalid|required|only )/i.test(String(msg).trim()))type="error";
  el.dataset.type=type;el.textContent=msg;el.classList.add("show");el.setAttribute("role",type==="error"?"alert":"status");
  clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove("show"),3200);
}
function setDriveStatus(text,ok=false){$("#driveStatus").textContent=`Drive: ${text}`;$("#driveStatus").style.background=ok?"rgba(121,201,0,.18)":"rgba(255,255,255,.1)"}
function showApp(){ $("#authScreen").classList.add("hidden"); $("#app").classList.remove("hidden"); renderAll(); }
function showAuth(){ $("#authScreen").classList.remove("hidden"); $("#app").classList.add("hidden"); }
function setAuthLoading(loading){
  const button=$("#connectDriveBtn"),state=$("#authLoadingState");
  state?.classList.toggle("hidden",!loading);button.disabled=loading||!window.gapiInited||!window.gisInited;
  button.textContent=loading?"Connecting to Google Drive…":"Connect Google Drive";
}

async function init(){
  window.gapiLoaded=()=>gapi.load("client",initGapi);
  window.gisLoaded=()=>initGIS();
  if(window.gapi) window.gapiLoaded();
  if(window.google) window.gisLoaded();
}
async function initGapi(){
  try{await gapi.client.init({discoveryDocs:[DISCOVERY_DOC]}); window.gapiInited=true; maybeAuthReady();}
  catch(e){$("#authStatus").textContent="Google API could not initialize. Check your internet connection."}
}
function initGIS(){
  try{
    tokenClient=google.accounts.oauth2.initTokenClient({
      client_id:CLIENT_ID,scope:SCOPES,callback:""
    });
    window.gisInited=true; maybeAuthReady();
  }catch(e){$("#authStatus").textContent="Google sign-in could not initialize."}
}
function maybeAuthReady(){
  if(window.gapiInited && window.gisInited){
    $("#authStatus").textContent="Ready. Connect your Google Drive.";
    $("#connectDriveBtn").disabled=false;
  }
}
async function connectDrive(){
  if(!tokenClient){toast("Google sign-in is not ready yet.","error");return}
  const attempt=++authAttempt;
  clearTimeout(authTimeout);
  setAuthLoading(true);$("#authStatus").textContent="Connecting securely to Google Drive…";
  authTimeout=setTimeout(()=>{
    if(attempt!==authAttempt)return;
    authAttempt++;authTimeout=null;driveReady=false;setDriveStatus("Offline");setAuthLoading(false);
    $("#authStatus").textContent="Google sign-in is taking longer than expected. Allow pop-ups for this site, then try again.";
    $("#connectDriveBtn").textContent="Try again";
    toast("Google did not respond. Check pop-up permissions and try again.","error");
  },60000);
  tokenClient.callback=async(resp)=>{
    if(attempt!==authAttempt)return;
    if(resp.error){clearTimeout(authTimeout);authTimeout=null;authAttempt++;driveReady=false;setDriveStatus("Offline");setAuthLoading(false);$("#authStatus").textContent="Google Drive connection was cancelled or could not be completed. You can try again.";$("#connectDriveBtn").textContent="Try again";toast("Google authorization failed.","error");return}
    try{
      driveReady=true; setDriveStatus("Connected",true);
      $("#authStatus").textContent="Google account connected. Loading your Drive workspace…";
      driveWorkspaceLoaded=false;
      await loadFromDrive();
      if(attempt!==authAttempt)return;
      clearTimeout(authTimeout);authTimeout=null;
      setAuthLoading(false);
      showApp();
      toast("Google Drive connected.");
    }catch(e){
      if(attempt!==authAttempt)return;
      console.error(e);clearTimeout(authTimeout);authTimeout=null;authAttempt++;setAuthLoading(false);
      const local=await readLocalWorkspace();if(local)state=mergeState(local.state);else{state=defaultState();await saveLocalWorkspace()}
      driveWorkspaceLoaded=false;driveFileId=null;driveFolderId=null;
      $("#authStatus").textContent="Google Drive is temporarily unavailable. You can keep working from this device; changes are saved locally.";
      $("#connectDriveBtn").textContent="Try again";setDriveStatus("Local mode",true);$("#driveDetails").textContent="Local workspace active. Drive sync will resume when the connection is available.";
      showApp();toast("Drive could not load. Your local workspace is ready and will sync when available.","info");
    }
  };
  try{const existing=gapi.client.getToken();tokenClient.requestAccessToken({prompt:existing?"":"consent"})}catch(e){if(attempt!==authAttempt)return;clearTimeout(authTimeout);authTimeout=null;authAttempt++;driveReady=false;setAuthLoading(false);$("#authStatus").textContent="Google Drive could not be opened. Please try again.";$("#connectDriveBtn").textContent="Try again";toast("Google authorization failed.","error")}
}
async function loadFromDrive(){
  const local=await readLocalWorkspace();
  const qFolder=`name='${APP_FOLDER.replace(/'/g,"\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const folders=await gapi.client.drive.files.list({q:qFolder,fields:"files(id,name)",pageSize:10});
  if(folders.result.files?.length) driveFolderId=folders.result.files[0].id;
  else{
    const r=await gapi.client.drive.files.create({resource:{name:APP_FOLDER,mimeType:"application/vnd.google-apps.folder"},fields:"id,name"});
    driveFolderId=r.result.id;
  }
  const qFile=`name='${DATA_FILE}' and '${driveFolderId}' in parents and trashed=false`;
  const files=await gapi.client.drive.files.list({q:qFile,fields:"files(id,name,modifiedTime)",pageSize:10});
  let shouldSync=false;
  if(files.result.files?.length){
    driveFileId=files.result.files[0].id;
    const r=await gapi.client.drive.files.get({fileId:driveFileId,alt:"media"});
    const cloudState=typeof r.body==="string"?JSON.parse(r.body):r.body;
    const hasUnsyncedLocal=local&&Number(local.savedAt||0)>Number(local.syncedAt||0);
    state=mergeState(hasUnsyncedLocal?local.state:cloudState);
    shouldSync=!!hasUnsyncedLocal;
    if(!hasUnsyncedLocal)await saveLocalWorkspace(true);
  }else{
    state=local?mergeState(local.state):defaultState();
    shouldSync=true;
  }
  driveWorkspaceLoaded=true;
  if(shouldSync)await saveToDrive(true);
  $("#driveDetails").textContent=`Folder: ${APP_FOLDER} • Data file: ${DATA_FILE}`;
}
function openLocalWorkspaceDb(){
  if(!window.indexedDB)return Promise.reject(new Error("IndexedDB is unavailable"));
  if(!localDbPromise)localDbPromise=new Promise((resolve,reject)=>{
    const request=window.indexedDB.open(LOCAL_DB_NAME,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(LOCAL_DB_STORE))request.result.createObjectStore(LOCAL_DB_STORE)};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error("Local database could not be opened"));
  });
  return localDbPromise;
}
function readLocalStorageWorkspace(){
  try{const parsed=JSON.parse(localStorage.getItem(LOCAL_DATA_KEY)||"null");return parsed?.state&&typeof parsed.state==="object"?parsed:null}
  catch(e){console.warn("Local workspace backup could not be read.",e);return null}
}
async function readLocalWorkspace(){
  try{
    const db=await openLocalWorkspaceDb();
    const saved=await new Promise((resolve,reject)=>{const request=db.transaction(LOCAL_DB_STORE,"readonly").objectStore(LOCAL_DB_STORE).get("primary");request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error)});
    if(saved?.state&&typeof saved.state==="object")return saved;
  }catch(e){console.warn("Indexed local workspace backup could not be read; checking browser storage.",e)}
  return readLocalStorageWorkspace();
}
function saveLocalWorkspace(markSynced=false,syncedBody=""){
  const snapshot=JSON.parse(JSON.stringify(state));
  const write=async()=>{
    try{
      const previous=await readLocalWorkspace(),now=Date.now(),matchesCloud=!syncedBody||JSON.stringify(snapshot,null,2)===syncedBody;
      const saved={savedAt:now,syncedAt:markSynced&&matchesCloud?now:Number(previous?.syncedAt||0),state:snapshot};
      try{
        const db=await openLocalWorkspaceDb();
        await new Promise((resolve,reject)=>{const transaction=db.transaction(LOCAL_DB_STORE,"readwrite");transaction.objectStore(LOCAL_DB_STORE).put(saved,"primary");transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||new Error("Local backup transaction was aborted"))});
      }catch(e){localStorage.setItem(LOCAL_DATA_KEY,JSON.stringify(saved))}
      return true;
    }catch(e){console.warn("Local workspace backup could not be saved.",e);return false}
  };
  localWritePromise=localWritePromise.then(write,write);
  return localWritePromise;
}
async function saveToDrive(silent=false){
  const localSaved=await saveLocalWorkspace();
  if(!driveReady||!driveWorkspaceLoaded){setDriveStatus(localSaved?"Saved locally":"Local save error",localSaved);if(!localSaved&&!silent)toast("This browser could not save the local workspace.","error");return false}
  if(driveSavePromise){driveSaveQueued=true;return driveSavePromise}
  driveSavePromise=(async()=>{
    do{
      driveSaveQueued=false;
      const body=JSON.stringify(state,null,2);
      try{
        setDriveStatus("Syncing…",true);
        if(!driveFileId){
          const boundary="----EliteVoltBoundary"+Date.now();
          const metadata={name:DATA_FILE,mimeType:"application/json",parents:[driveFolderId]};
          const payload=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
          const token=gapi.client.getToken().access_token;
          const r=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name",{
            method:"POST",headers:{"Authorization":`Bearer ${token}`,"Content-Type":`multipart/related; boundary=${boundary}`},body:payload
          });
          if(!r.ok) throw new Error(await r.text());
          const data=await r.json();driveFileId=data.id;
        }else{
          const token=gapi.client.getToken().access_token;
          const r=await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`,{
            method:"PATCH",headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json"},body
          });
          if(!r.ok) throw new Error(await r.text());
        }
        if(body!==JSON.stringify(state,null,2)){driveSaveQueued=true;await saveLocalWorkspace();continue}
        await saveLocalWorkspace(true,body);setDriveStatus("Synced",true);
        if(!silent)toast("Saved to Google Drive.");
      }catch(e){console.error(e);const backedUp=await saveLocalWorkspace();setDriveStatus(backedUp?"Sync pending · local saved":"Sync error · local save failed",backedUp);if(!silent)toast(backedUp?"Drive sync is unavailable. Your changes are saved on this device.":"Drive and local backup both failed.",backedUp?"info":"error");return false}
    }while(driveSaveQueued&&driveReady);
    return true;
  })();
  try{return await driveSavePromise}
  finally{driveSavePromise=null;if(driveSaveQueued&&driveReady){driveSaveQueued=false;saveToDrive(true)}}
}
async function retryDriveSync(silent=false){
  if(!driveReady){setDriveStatus("Saved locally",true);return false}
  if(!driveWorkspaceLoaded){try{await loadFromDrive();return driveWorkspaceLoaded}catch(e){console.warn("Drive sync will retry when available.",e);setDriveStatus("Sync pending · local saved");if(!silent)toast("Drive is still unavailable. Your changes remain saved locally.","info");return false}}
  return saveToDrive(silent);
}
function scheduleSave(){
  const localSave=saveLocalWorkspace();
  clearTimeout(saveTimer);
  setDriveStatus(driveReady?"Syncing…":"Saving locally…",true);
  localSave.then(saved=>{if(!saved){setDriveStatus("Local save error");toast("This browser could not save the local workspace.","error")}else if(!driveReady)setDriveStatus("Saved locally",true)});
  saveTimer=setTimeout(()=>saveToDrive(true),700);
}
function audit(action,record="",details=""){
  state.auditLog=Array.isArray(state.auditLog)?state.auditLog:[];
  state.auditLog.unshift({id:uid("audit"),date:new Date().toISOString(),user:state.settings.role||"Super Admin",action,record,details});
  state.auditLog=state.auditLog.slice(0,500);
}
function mutate(fn,action="Updated business data",record="",details=""){
  fn();audit(action,record,details);renderAll();scheduleSave();
  toast(action==="Updated business data"?"Changes saved.":`${action}.`);
}

function renderAll(){
  refreshInvoiceStatuses();renderDashboard();renderStock();renderSales();renderPurchases();renderWaybills();renderCashflow();renderExpenses();renderFinanceDocs();renderCustomers();renderReports();renderAudit();renderSettings();enhanceTables();
}
function switchView(view){
  $$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $$(".view").forEach(v=>v.classList.toggle("active",v.id===view));
  if(view==="dashboard") renderDashboard();
  enhanceTables();
}
$$(".nav-item").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
$$("[data-view-link]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.viewLink)));

function monthKey(d){return d.slice(0,7)}
function monthLabel(k){const [y,m]=k.split("-");return new Date(+y,+m-1,1).toLocaleString("en",{month:"short",year:"numeric"})}
function lastMonths(n=6){
  const out=[];const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-n+1);
  for(let i=0;i<n;i++){out.push(d.toISOString().slice(0,7));d.setMonth(d.getMonth()+1)}
  return out;
}
function salesTotal(){return state.invoices.reduce((s,i)=>s+Number(i.total||0),0)}
function paidTotal(){return state.invoices.reduce((s,i)=>s+Number(i.paid||0),0)}
function stockValue(){return state.products.reduce((s,p)=>s+Number(p.qty||0)*Number(p.cost||0),0)}
function orderTaxCategories(categories){
  const rank=(name)=>{const n=String(name||"").toLowerCase().replace(/[^a-z]/g,"");if(n.includes("nhil"))return 1;if(n.includes("getfund")||n.includes("getfundlevy"))return 2;if(n.includes("vat"))return 3;return 10;};
  return [...categories].sort((a,b)=>rank(a.name)-rank(b.name));
}
function parseTaxCategories(raw){
  return String(raw||"").split(/[,\n]+/).map(x=>x.trim()).filter(Boolean).map(label=>{
    const m=label.match(/^(.*?)[\s:=-]*([0-9]+(?:\.[0-9]+)?)\s*%?$/);
    return {label, name:(m?.[1]||label).trim(), rate:m?Number(m[2]):0};
  }).filter(x=>x.rate>0);
}
function taxBreakdown(base, raw){
  const categories=parseTaxCategories(raw);
  return orderTaxCategories(categories).map(x=>({...x,amount:round2(base*x.rate/100)}));
}
function documentTaxBase(doc){return round2(Math.max(0,Number(doc.subtotal||0)-Number(doc.discount||0)+Number(doc.deliveryCharge||0)+Number(doc.laborCharge||0)))}
function invoiceCreditTotal(id){return round2(state.creditNotes.filter(c=>c.invoiceId===id&&!c.voidedAt).reduce((n,c)=>n+Number(c.amount||0),0))}
function invoiceBalance(inv){if(inv.status==="Void"||inv.voidedAt)return 0;return round2(Math.max(0,Number(inv.total||0)-Number(inv.paid||0)-invoiceCreditTotal(inv.id)))}
function effectiveSalesDocStatus(doc){if(doc.convertedToNumber||doc.status==="Converted")return "Converted";if(doc.acceptedAt||doc.status==="Accepted")return "Accepted";if(doc.validUntil&&doc.validUntil<today()&&(doc.sentAt||doc.status==="Sent"))return "Expired";if(doc.status==="Approved")return "Approved";return doc.sentAt||doc.status==="Sent"?"Sent":"Draft"}
function effectiveInvoiceStatus(inv){
  if(inv.status==="Void"||inv.voidedAt)return "Void";
  if(invoiceBalance(inv)<=0)return Number(inv.paid||0)>=Number(inv.total||0)?"Paid":"Credited";
  if(inv.dueDate&&inv.dueDate<today()&&inv.status!=="Draft")return "Overdue";
  if(Number(inv.paid||0)>0)return "Partially Paid";
  return inv.status||"Draft";
}
function statusClass(status){return status==="Paid"||status==="Credited"||status==="Delivered"||status==="Accepted"||status==="Approved"?"paid":status==="Partially Paid"||status==="Part-paid"||status==="Overdue"||status==="Expired"?"part":status==="Void"?"void":"unpaid"}
function refreshInvoiceStatuses(){state.invoices.forEach(inv=>{if(inv.status!=="Void"&&!inv.voidedAt){const next=effectiveInvoiceStatus(inv);if(next!=="Credited")inv.status=next;}})}
function reservedQty(productId, excludeId=""){
  return state.invoices.filter(i=>i.id!==excludeId&&!i.delivered&&!i.stockDeducted&&Number(i.paid||0)>0)
    .reduce((sum,i)=>sum+i.items.filter(x=>x.productId===productId).reduce((a,x)=>a+Math.max(0,Number(x.qty||0)-Number(x.deliveredQty||0)),0),0);
}
function availableQty(productId, excludeId=""){
  const p=state.products.find(x=>x.id===productId);return Math.max(0,Number(p?.qty||0)-reservedQty(productId,excludeId));
}
function stockAvailabilityWarnings(items, excludeId=""){
  const totals={};
  items.forEach(x=>{if(x?.productId) totals[x.productId]=(totals[x.productId]||0)+Number(x.qty||0);});
  return Object.entries(totals).map(([productId,requested])=>{
    const p=state.products.find(p=>p.id===productId);const available=availableQty(productId,excludeId);
    return p&&requested>available?`${p.name}: ${available} available (${reservedQty(productId,excludeId)} reserved), ${requested} requested.`:null;
  }).filter(Boolean);
}
function taxesForDoc(doc){return state.settings.taxEnabled===false?[]:taxBreakdown(documentTaxBase(doc),state.settings.taxCategories)}
function taxTotal(doc){return taxesForDoc(doc).reduce((s,x)=>s+x.amount,0)}
function recalcDocument(doc){
  doc.subtotal=round2(doc.items.reduce((s,x)=>s+Number(x.qty||0)*Number(x.price||0),0));
  doc.taxBase=documentTaxBase(doc);
  doc.taxLines=state.settings.taxEnabled===false?[]:taxBreakdown(doc.taxBase,state.settings.taxCategories);
  doc.taxTotal=doc.taxLines.reduce((s,x)=>s+x.amount,0);
  doc.total=round2(Math.max(0,doc.taxBase+doc.taxTotal));
  return doc;
}
function reservedValue(){return state.invoices.reduce((s,i)=>s+(!i.delivered&&!i.stockDeducted&&Number(i.paid||0)>0?Number(i.total||0):0),0)}

function renderDashboard(){
  const currency=state.settings.currency||"GHS",month=today().slice(0,7);
  const invoices=state.invoices.filter(i=>(i.currency||currency)===currency&&!i.voidedAt&&i.status!=="Void");
  const monthInvoices=invoices.filter(i=>String(i.date||"").startsWith(month));
  const open=invoices.filter(i=>invoiceBalance(i)>0),overdue=open.filter(i=>effectiveInvoiceStatus(i)==="Overdue");
  const low=state.products.filter(p=>Number(p.qty||0)-reservedQty(p.id)<=Number(p.minQty||0));
  $("#mRevenue").textContent=money(monthInvoices.reduce((s,i)=>s+Number(i.total||0),0),currency);
  $("#mRevenueTrend").textContent=`${monthInvoices.length} invoices issued · ${currency}`;
  $("#mOutstanding").textContent=money(open.reduce((s,i)=>s+invoiceBalance(i),0),currency);
  $("#mOverdue").textContent=String(overdue.length);$("#mOverdueValue").textContent=`${money(overdue.reduce((s,i)=>s+invoiceBalance(i),0),currency)} overdue`;
  $("#mLowStock").textContent=String(low.length);$("#mCustomers").textContent=String(state.customers.filter(c=>!c.deletedAt).length);
  $("#trendLabel").textContent=currency;renderRevenueChart(currency);renderProductSalesChart(monthInvoices);renderPaymentChart(month);
  $("#lowStockList").innerHTML=low.length?low.slice(0,8).map(p=>`<div class="list-row"><div><strong>${esc(p.name)}</strong><small>${esc(p.sku||"No SKU")}</small></div><span class="badge ${p.qty<=0?"out":"part"}">${p.qty} left</span></div>`).join(""):`<div class="dashboard-empty"><strong>Stock levels look good</strong><span>Items at or below their reorder point will show up here.</span></div>`;
  const recent=[...state.invoices].filter(i=>!i.deletedAt).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))).slice(0,8);
  $("#recentInvoicesTable").innerHTML=recent.length?recent.map(i=>`<tr><td><strong>${esc(i.number)}</strong></td><td>${esc(i.customerName||"Customer missing")}</td><td>${esc(i.date||"—")}</td><td>${esc(i.dueDate||"—")}</td><td>${money(i.total,i.currency||currency)}</td><td>${money(invoiceBalance(i),i.currency||currency)}</td><td><span class="badge ${statusClass(effectiveInvoiceStatus(i))}">${esc(effectiveInvoiceStatus(i))}</span></td></tr>`).join(""):`<tr><td colspan="7" class="empty">Create your first invoice to see recent billing activity.</td></tr>`;
}
function positionActionMenu(){
  const list=activeActionList,button=activeActionButton;if(!list||!button)return;
  if(!button.isConnected||!list.isConnected){closeActionMenus();return}
  const pad=8,gap=6,viewportWidth=Math.min(window.innerWidth,document.documentElement.clientWidth||window.innerWidth),viewportHeight=window.innerHeight;
  list.style.minWidth=`${Math.max(1,Math.min(190,viewportWidth-pad*2))}px`;
  list.style.maxWidth=`${Math.max(1,viewportWidth-pad*2)}px`;list.style.maxHeight="";list.style.overflowY="";
  const anchor=button.getBoundingClientRect();let box=list.getBoundingClientRect();
  const below=Math.max(0,viewportHeight-pad-anchor.bottom-gap),above=Math.max(0,anchor.top-pad-gap);
  let top;
  if(box.height<=below)top=anchor.bottom+gap;
  else if(box.height<=above)top=anchor.top-box.height-gap;
  else{const openBelow=below>=above,available=Math.max(96,Math.max(below,above));list.style.maxHeight=`${available}px`;list.style.overflowY="auto";box=list.getBoundingClientRect();top=openBelow?anchor.bottom+gap:anchor.top-box.height-gap}
  const left=Math.max(pad,Math.min(anchor.right-box.width,viewportWidth-box.width-pad));
  list.style.top=`${Math.max(pad,Math.min(top,viewportHeight-box.height-pad))}px`;list.style.left=`${left}px`;list.style.right="auto";list.style.bottom="auto";
}
function closeActionMenus(){
  const opened=[...document.querySelectorAll(".action-menu.open")];if(activeActionMenu&&!opened.includes(activeActionMenu))opened.push(activeActionMenu);
  opened.forEach(menu=>{
    menu.classList.remove("open");const button=menu.querySelector(".action-menu-toggle")||activeActionButton;button?.setAttribute("aria-expanded","false");
    const list=(activeActionMenu===menu?activeActionList:null)||menu.querySelector(".action-menu-list");
    if(list){if(list._actionMenuHome)list._actionMenuHome.appendChild(list);["position","display","flexDirection","visibility","top","left","right","bottom","minWidth","maxWidth","maxHeight","overflowY","zIndex"].forEach(key=>list.style[key]="")}
  });
  activeActionMenu=null;activeActionList=null;activeActionButton=null;
}
function openActionMenu(button){
  const menu=button.closest(".action-menu"),wasOpen=activeActionMenu===menu||menu.classList.contains("open");closeActionMenus();if(wasOpen)return;
  const list=menu.querySelector(".action-menu-list");if(!list)return;
  activeActionMenu=menu;activeActionList=list;activeActionButton=button;list._actionMenuHome=menu;menu.classList.add("open");button.setAttribute("aria-expanded","true");
  list.style.position="fixed";list.style.visibility="hidden";list.style.display="flex";list.style.flexDirection="column";list.style.zIndex="1001";
  document.body.appendChild(list);positionActionMenu();list.style.visibility="visible";
}
document.addEventListener("click",e=>{
  const target=e.target instanceof Element?e.target:null;
  if(target?.closest(".action-menu-toggle"))return;
  if(target?.closest(".action-menu-list")){if(target.closest(".action-menu-list button"))closeActionMenus();return}
  closeActionMenus();
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&activeActionMenu){const button=activeActionButton;closeActionMenus();button?.focus()}});
window.addEventListener("resize",positionActionMenu);
window.addEventListener("scroll",positionActionMenu,{passive:true});
function destroyChart(k){if(charts[k]){charts[k].destroy();charts[k]=null}}
function renderRevenueChart(currency){
  destroyChart("revenue30");const dates=Array.from({length:30},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(29-i));return d.toISOString().slice(0,10)});
  const values=dates.map(d=>state.invoices.filter(i=>String(i.date||"")===d&&(i.currency||currency)===currency&&i.status!=="Void"&&!i.voidedAt).reduce((s,i)=>s+Number(i.total||0),0));
  charts.revenue30=new Chart($("#revenue30Chart"),{type:"line",data:{labels:dates.map(d=>new Date(`${d}T00:00:00`).toLocaleDateString("en-GH",{day:"numeric",month:"short"})),datasets:[{label:`Revenue (${currency})`,data:values,borderColor:"#447a0a",backgroundColor:"rgba(121,201,0,.14)",fill:true,tension:.35,pointRadius:0,pointHoverRadius:4,borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>money(c.raw,currency)}}},scales:{x:{grid:{display:false},ticks:{maxTicksLimit:7}},y:{beginAtZero:true,grid:{color:"#eef2f5"},ticks:{callback:v=>`${CURRENCY_SYMBOLS[currency]||currency} ${Number(v).toLocaleString("en-GH")}`}}}}});
}
function renderProductSalesChart(invoices){
  destroyChart("productSales");const totals={};invoices.forEach(i=>i.items.forEach(line=>{const product=state.products.find(p=>p.id===line.productId);const name=product?.name||"Removed product";totals[name]=(totals[name]||0)+Number(line.qty||0)*Number(line.price||0)}));const rows=Object.entries(totals).sort((a,b)=>b[1]-a[1]).slice(0,5);
  charts.productSales=new Chart($("#productSalesChart"),{type:"bar",data:{labels:rows.length?rows.map(x=>x[0]):["No sales yet"],datasets:[{data:rows.length?rows.map(x=>round2(x[1])):[0],backgroundColor:["#43780b","#78a940","#a6cd75","#c7dfaa","#dcebcf"],borderRadius:7,maxBarThickness:30}]},options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>money(c.raw)}}},scales:{x:{beginAtZero:true,grid:{color:"#eef2f5"}},y:{grid:{display:false}}}}});
}
function renderPaymentChart(month){
  destroyChart("payment");const currency=state.settings.currency||"GHS",totals={};state.receipts.filter(r=>String(r.date||"").startsWith(month)&&(r.currency||currency)===currency).forEach(r=>{const key=displayPaymentMethod(r.paymentMethod)||"Other";totals[key]=(totals[key]||0)+Number(r.amount||0)});const rows=Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  charts.payment=new Chart($("#paymentChart"),{type:"doughnut",data:{labels:rows.length?rows.map(x=>x[0]):["No payments yet"],datasets:[{data:rows.length?rows.map(x=>x[1]):[1],backgroundColor:["#447a0a","#78a940","#b3d783","#e2edcf","#96a5b3"],borderWidth:0,hoverOffset:5}]},options:{responsive:true,maintainAspectRatio:false,cutout:"68%",plugins:{legend:{position:"bottom",labels:{boxWidth:10,usePointStyle:true}},tooltip:{callbacks:{label:c=>rows.length?`${c.label}: ${money(c.raw)}`:"No payments recorded"}}}}});
}

function renderStock(){
  const q=(document.querySelector("#stockSearch")?.value||"").toLowerCase(),f=document.querySelector("#stockFilter")?.value||"";
  const rows=state.products.filter(p=>!p.deletedAt&&`${p.name} ${p.sku||""} ${p.category||""}`.toLowerCase().includes(q)).filter(p=>{
    const avail=availableQty(p.id);return f==="low"?avail<=Number(p.minQty||0):f==="out"?avail<=0:true;
  });
  $("#stockTable").innerHTML=rows.length?rows.map(p=>{
    const reserved=reservedQty(p.id),avail=Math.max(0,Number(p.qty||0)-reserved);
    const badge=avail<=0?"out":avail<=Number(p.minQty||0)?"part":"ok";
    const menu=`<button class="icon-btn" data-edit-product="${p.id}">Edit</button><button class="icon-btn" data-adjust-product="${p.id}">Adjust</button><button class="icon-btn danger-action" data-delete-product="${p.id}">Archive</button>`;
    return `<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.sku||"—")}</td><td>${esc(p.category||"—")}</td><td><span class="badge ${badge}">${p.qty} on hand</span><small class="table-sub">${reserved} reserved • ${avail} available</small></td><td>${money(p.cost)}</td><td>${money(p.price)}</td><td>${money(p.qty*p.cost)}</td><td><div class="action-menu"><button class="action-menu-toggle" type="button" aria-expanded="false">Actions <span>▾</span></button><div class="action-menu-list">${menu}</div></div></td></tr>`;
  }).join(""):`<tr><td colspan="8" class="empty">No products found.</td></tr>`;
  $$('[data-edit-product]').forEach(b=>b.onclick=()=>openProduct(b.dataset.editProduct));
  $$('[data-adjust-product]').forEach(b=>b.onclick=()=>openAdjust(b.dataset.adjustProduct));
  $$('[data-delete-product]').forEach(b=>b.onclick=()=>{closeActionMenus();deleteProduct(b.dataset.deleteProduct)});
  $$('#stockTable .action-menu-toggle').forEach(b=>b.onclick=e=>{e.stopPropagation();openActionMenu(b)});
}
function allDocuments(){
  return [
    ...state.estimates.filter(d=>!d.deletedAt&&!d.convertedToNumber).map(d=>({...d,docType:"Estimate",status:effectiveSalesDocStatus(d)})),
    ...state.proformas.filter(d=>!d.deletedAt&&!d.convertedToNumber).map(d=>({...d,docType:"Proforma Invoice",status:effectiveSalesDocStatus(d)})),
    ...state.invoices.filter(d=>!d.deletedAt).map(d=>({...d,docType:"Invoice",status:effectiveInvoiceStatus(d)}))
  ].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
}
function renderSales(){
  const q=($t("#salesSearch")?.value||"").toLowerCase(),f=$t("#salesStatus")?.value||"";
  const rows=allDocuments().filter(d=>`${d.number} ${d.customerName||""}`.toLowerCase().includes(q)).filter(d=>!f||d.docType===f||d.status===f);
  $("#salesTable").innerHTML=rows.length?rows.map(d=>{
    const isInv=d.docType==="Invoice", paid=Number(d.paid||0), balance=isInv?invoiceBalance(d):Math.max(0,Number(d.total||0)-paid);
    const reserved=isInv&&!d.delivered&&!d.stockDeducted&&paid>0;
    let badge=isInv?effectiveInvoiceStatus(d):d.status||"Draft"; if(reserved) badge="Reserved / Awaiting delivery";
    const cls=reserved?"part":statusClass(badge);
     let menu=`<button class="icon-btn" data-print-doc="${d.id}">Print</button><button class="icon-btn" data-copy-doc="${d.id}">Copy as quote</button>`;
     if(d.docType==="Estimate"){menu+=`<button class="icon-btn" data-edit-doc="${d.id}">Edit</button>${badge==="Draft"?`<button class="icon-btn" data-approve-sales-doc="estimate:${d.id}">Approve for client</button>`:""}${badge==="Approved"?`<button class="icon-btn" data-send-sales-doc="estimate:${d.id}">Mark sent</button>`:""}${badge==="Sent"?`<button class="icon-btn" data-accept-sales-doc="estimate:${d.id}">Mark accepted</button>`:""}<button class="icon-btn" data-email-doc="${d.id}">Send email</button><button class="icon-btn" data-whatsapp-doc="${d.id}">WhatsApp</button><button class="icon-btn" data-convert-pro="${d.id}">To Proforma</button><button class="icon-btn" data-convert-inv="${d.id}">To Invoice</button>`;
     } else if(d.docType==="Proforma Invoice"){menu+=`<button class="icon-btn" data-edit-doc="${d.id}">Edit</button>${badge==="Draft"?`<button class="icon-btn" data-approve-sales-doc="proforma:${d.id}">Approve for client</button>`:""}${badge==="Approved"?`<button class="icon-btn" data-send-sales-doc="proforma:${d.id}">Mark sent</button>`:""}${badge==="Sent"?`<button class="icon-btn" data-accept-sales-doc="proforma:${d.id}">Mark accepted</button>`:""}<button class="icon-btn" data-email-doc="${d.id}">Send email</button><button class="icon-btn" data-whatsapp-doc="${d.id}">WhatsApp</button><button class="icon-btn" data-convert-inv="${d.id}">To Invoice</button>`;
     } else if(badge!=="Void") menu+=`${balance>0?`<button class="icon-btn" data-payment="${d.id}">Record payment</button>`:""}<button class="icon-btn" data-send-invoice="${d.id}">Mark sent</button><button class="icon-btn" data-email-doc="${d.id}">Send email</button><button class="icon-btn" data-whatsapp-doc="${d.id}">WhatsApp</button>${!d.delivered?`<button class="icon-btn" data-create-waybill="invoice:${d.id}">Create waybill</button>`:""}<button class="icon-btn" data-delivery="${d.id}">${d.delivered?"Delivered":"Confirm delivery"}</button>${state.receipts.some(r=>r.invoiceId===d.id)?`<button class="icon-btn" data-receipt="${d.id}">Latest receipt</button>`:""}<button class="icon-btn" data-void-doc="${d.id}">Void invoice</button>`;
    if(!isInv)menu+=`<button class="icon-btn danger-action" data-delete-doc="${d.docType}:${d.id}">Archive</button>`;
     return `<tr><td><button type="button" class="document-number-link" data-print-doc="${d.id}" title="Open printable document" aria-label="Open or print ${esc(d.number)}"><strong>${esc(d.number)}</strong></button><small class="table-sub">${d.docType==="Estimate"?"Quote / Estimate":esc(d.docType)}</small></td><td>${esc(d.date||"")}</td><td>${esc(d.customerName||"Customer missing")}</td><td>${money(d.total,d.currency||state.settings.currency)}</td><td>${isInv?money(paid,d.currency||state.settings.currency):"—"}</td><td>${isInv?money(balance,d.currency||state.settings.currency):"—"}</td><td><span class="badge ${cls}">${esc(badge)}</span></td><td><div class="action-menu"><button class="action-menu-toggle" type="button" aria-expanded="false">Actions <span>▾</span></button><div class="action-menu-list">${menu}</div></div></td></tr>`;
  }).join(""):`<tr><td colspan="8" class="empty">No documents found.</td></tr>`;
  $$('[data-print-doc]').forEach(b=>b.onclick=()=>printDocument(b.dataset.printDoc));
  $$('[data-copy-doc]').forEach(b=>b.onclick=()=>openCopyQuotation(b.dataset.copyDoc));
  $$('[data-edit-doc]').forEach(b=>b.onclick=()=>openSale(b.dataset.editDoc,false));
  $$('[data-receipt]').forEach(b=>b.onclick=()=>printInvoice(b.dataset.receipt,true));
  $$('[data-payment]').forEach(b=>b.onclick=()=>recordPayment(b.dataset.payment));
  $$('[data-delivery]').forEach(b=>b.onclick=()=>confirmDelivery(b.dataset.delivery));
  $$('[data-send-invoice]').forEach(b=>b.onclick=()=>markInvoiceSent(b.dataset.sendInvoice));
  $$('[data-void-doc]').forEach(b=>b.onclick=()=>voidInvoice(b.dataset.voidDoc));
  $$('[data-email-doc]').forEach(b=>b.onclick=()=>sendDocumentLink(b.dataset.emailDoc,"email"));
  $$('[data-whatsapp-doc]').forEach(b=>b.onclick=()=>sendDocumentLink(b.dataset.whatsappDoc,"whatsapp"));
  $$('[data-convert-pro]').forEach(b=>b.onclick=()=>convertToProforma(b.dataset.convertPro));
  $$('[data-convert-inv]').forEach(b=>b.onclick=()=>convertToInvoice(b.dataset.convertInv));
  $$('[data-send-sales-doc]').forEach(b=>b.onclick=()=>updateSalesDocStatus(...b.dataset.sendSalesDoc.split(":"),"Sent"));
  $$('[data-accept-sales-doc]').forEach(b=>b.onclick=()=>updateSalesDocStatus(...b.dataset.acceptSalesDoc.split(":"),"Accepted"));
  $$('[data-approve-sales-doc]').forEach(b=>b.onclick=()=>updateSalesDocStatus(...b.dataset.approveSalesDoc.split(":"),"Approved"));
  $$('[data-create-waybill]').forEach(b=>b.onclick=()=>{const [type,id]=b.dataset.createWaybill.split(":");openWaybill(type,id)});
  $$('.action-menu-toggle').forEach(b=>b.onclick=e=>{e.stopPropagation();openActionMenu(b)});
  $$('[data-delete-doc]').forEach(b=>{const [type,id]=b.dataset.deleteDoc.split(":");b.onclick=()=>{closeActionMenus();deleteDocument(type,id)}});
}
function $t(sel){return document.querySelector(sel)}

function renderPurchases(){
  const currency=state.settings.currency||"GHS",month=today().slice(0,7),monthInvoices=state.purchaseInvoices.filter(x=>String(x.date||"").startsWith(month)&&(x.currency||"GHS")===currency);
  const openOrders=state.purchaseOrders.filter(x=>x.status!=="Received"&&x.status!=="Cancelled");
  const outstanding=state.purchaseInvoices.filter(x=>(x.currency||"GHS")===currency).reduce((n,x)=>n+Math.max(0,Number(x.total||0)-Number(x.paid||0)),0);
  $("#mOpenPO").textContent=openOrders.length;
  $("#mPurchaseInvoices").textContent=state.purchaseInvoices.length;
  $("#mPurchaseBalance").textContent=`${money(outstanding)} outstanding`;
  $("#mPurchases").textContent=money(monthInvoices.reduce((n,x)=>n+Number(x.total||0),0));
  $("#purchaseOrdersTable").innerHTML=state.purchaseOrders.length?state.purchaseOrders.slice().sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))).map(p=>{
    const received=p.items.reduce((n,x)=>n+Number(x.receivedQty||0),0),qty=p.items.reduce((n,x)=>n+Number(x.qty||0),0),pending=received<qty;
    const linkedInvoice=state.purchaseInvoices.some(x=>x.sourceOrderId===p.id);
    return `<tr><td><strong>${esc(p.number)}</strong></td><td>${esc(p.date||"")}</td><td>${esc(p.supplierName||"Supplier")}</td><td>${money(p.total,p.currency||"GHS")}</td><td>${received} / ${qty}</td><td><span class="badge ${p.status==="Received"?"paid":p.status==="Partially received"?"part":"unpaid"}">${esc(p.status||"Ordered")}</span></td><td><div class="actions"><button class="icon-btn" data-print-purchase="order:${p.id}">Print</button>${pending?`<button class="icon-btn" data-create-waybill="purchaseOrder:${p.id}">Waybill</button>`:""}${!linkedInvoice?`<button class="icon-btn" data-convert-purchase="${p.id}">Create invoice</button>`:""}</div></td></tr>`;
  }).join(""):`<tr><td colspan="7" class="empty">No purchase orders yet. Create one to plan your next supplier order.</td></tr>`;
  $("#purchaseInvoicesTable").innerHTML=state.purchaseInvoices.length?state.purchaseInvoices.slice().sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))).map(p=>{
    const balance=Math.max(0,Number(p.total||0)-Number(p.paid||0)),received=p.items.reduce((n,x)=>n+Number(x.receivedQty||0),0),qty=p.items.reduce((n,x)=>n+Number(x.qty||0),0);
    return `<tr><td><strong>${esc(p.number)}</strong><small class="table-sub">${esc(p.reference||"")}</small></td><td>${esc(p.date||"")}</td><td>${esc(p.supplierName||"Supplier")}</td><td>${money(p.total,p.currency||"GHS")}</td><td>${money(p.paid||0,p.currency||"GHS")}</td><td>${money(balance,p.currency||"GHS")}</td><td>${received} / ${qty}</td><td><div class="actions"><button class="icon-btn" data-print-purchase="invoice:${p.id}">Print</button>${received<qty?`<button class="icon-btn" data-create-waybill="purchaseInvoice:${p.id}">Waybill</button>`:""}${balance>0?`<button class="icon-btn" data-purchase-payment="${p.id}">Payment</button>`:""}${received<qty?`<button class="icon-btn" data-receive-purchase="${p.id}">Receive stock</button>`:""}</div></td></tr>`;
  }).join(""):`<tr><td colspan="8" class="empty">Supplier invoices will appear here.</td></tr>`;
  const suppliers=state.suppliers.filter(s=>!s.deletedAt);$("#suppliersTable").innerHTML=suppliers.length?suppliers.map(s=>{const orders=state.purchaseOrders.filter(x=>x.supplierId===s.id),bills=state.purchaseInvoices.filter(x=>x.supplierId===s.id),currencyBills=bills.filter(x=>(x.currency||"GHS")===currency),spend=currencyBills.reduce((n,x)=>n+Number(x.total||0),0),owed=currencyBills.reduce((n,x)=>n+Math.max(0,Number(x.total||0)-Number(x.paid||0)),0),docs=orders.length+bills.length;return `<tr><td><strong>${esc(s.name)}</strong><small class="table-sub">${esc(s.supplies||"")}</small></td><td>${esc(s.contactPerson||"—")}</td><td>${esc(s.phone||"—")}</td><td>${esc(s.email||"—")}</td><td>${money(spend,currency)}</td><td>${money(owed,currency)}</td><td>${docs} documents</td><td><div class="actions"><button class="icon-btn" data-edit-supplier="${s.id}">Edit</button><button class="icon-btn danger-action" data-delete-supplier="${s.id}">Archive</button></div></td></tr>`}).join(""):`<tr><td colspan="8" class="empty">Add your first supplier to start creating purchase orders.</td></tr>`;
  $$('[data-open-supplier]').forEach(b=>b.onclick=()=>openSupplier());
  $$('[data-open-purchase-order]').forEach(b=>b.onclick=()=>openPurchase("order"));
  $$('[data-open-purchase-invoice]').forEach(b=>b.onclick=()=>openPurchase("invoice"));
  $$('[data-print-purchase]').forEach(b=>{const [kind,id]=b.dataset.printPurchase.split(":");b.onclick=()=>printPurchase(kind,id)});
  $$('[data-convert-purchase]').forEach(b=>b.onclick=()=>openPurchase("invoice",b.dataset.convertPurchase));
  $$('[data-create-waybill]').forEach(b=>b.onclick=()=>{const [type,id]=b.dataset.createWaybill.split(":");openWaybill(type,id)});
  $$('[data-purchase-payment]').forEach(b=>b.onclick=()=>recordPurchasePayment(b.dataset.purchasePayment));
  $$('[data-receive-purchase]').forEach(b=>b.onclick=()=>openReceivePurchase(b.dataset.receivePurchase));
  $$('[data-edit-supplier]').forEach(b=>b.onclick=()=>openSupplier(b.dataset.editSupplier));
  $$('[data-delete-supplier]').forEach(b=>b.onclick=()=>deleteSupplier(b.dataset.deleteSupplier));
}

function renderWaybills(){
  const query=( $("#waybillSearch")?.value||"").toLowerCase(),direction=$("#waybillDirection")?.value||"";
  const rows=state.waybills.filter(w=>`${w.number} ${w.partyName||""} ${w.sourceNumber||""}`.toLowerCase().includes(query)).filter(w=>!direction||w.direction===direction).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  $("#waybillsTable").innerHTML=rows.length?rows.map(w=>`<tr><td><strong>${esc(w.number)}</strong></td><td>${esc(w.date||"")}</td><td>${w.direction==="incoming"?"Incoming / received":"Outgoing / dispatch"}</td><td>${esc(w.partyName||"—")}</td><td>${esc(w.sourceNumber||"Standalone")}</td><td>${w.items.reduce((n,x)=>n+Number(x.qty||0),0)} units</td><td><span class="badge ${w.status==="Completed"?"paid":w.status==="Partially completed"?"part":"unpaid"}">${esc(w.status||"Prepared")}</span></td><td><div class="actions"><button class="icon-btn" data-print-waybill="${w.id}">Print</button>${w.status!=="Completed"?`<button class="icon-btn" data-complete-waybill="${w.id}">${w.direction==="incoming"?"Receive goods":"Mark delivered"}</button>`:""}</div></td></tr>`).join(""):`<tr><td colspan="8" class="empty">No waybills yet. Create one from an invoice or purchase document.</td></tr>`;
  $$('[data-open-waybill]').forEach(b=>b.onclick=()=>openWaybill());
  $$('[data-print-waybill]').forEach(b=>b.onclick=()=>printWaybill(b.dataset.printWaybill));
  $$('[data-complete-waybill]').forEach(b=>b.onclick=()=>completeWaybill(b.dataset.completeWaybill));
}
function renderCashflow(){
  const currency=state.settings.currency||"GHS",allTransactions=state.transactions.filter(t=>!t.deletedAt),activeTransactions=allTransactions.filter(t=>(t.currency||currency)===currency);
  const ins=activeTransactions.filter(t=>t.type==="in").reduce((s,t)=>s+Number(t.amount||0),0),outs=activeTransactions.filter(t=>t.type==="out").reduce((s,t)=>s+Number(t.amount||0),0);
  $("#cfIn").textContent=money(ins);$("#cfOut").textContent=money(outs);$("#cfNet").textContent=money(ins-outs);
  $("#cashTable").innerHTML=[...allTransactions].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))).map(t=>`<tr><td>${esc(t.date)}</td><td><span class="badge ${t.type==="in"?"paid":"unpaid"}">${t.type==="in"?"Cash in":"Cash out"}</span></td><td>${esc(t.category||"—")}</td><td>${esc(t.description||"")}</td><td>${money(t.amount,t.currency||state.settings.currency)}</td><td>${esc(t.reference||"—")}</td><td>${esc(displayPaymentMethod(t.paymentMethod))}</td><td><button class="icon-btn" data-delete-cash="${t.id}">Archive</button></td></tr>`).join("")||`<tr><td colspan="8" class="empty">No transactions.</td></tr>`;
  $$("[data-delete-cash]").forEach(b=>b.onclick=()=>deleteCash(b.dataset.deleteCash));
  destroyChart("monthly");const months=lastMonths(12);const vals=months.map(m=>{const ts=activeTransactions.filter(t=>t.date.startsWith(m));return {label:monthLabel(m),v:ts.filter(t=>t.type==="in").reduce((s,t)=>s+Number(t.amount||0),0)-ts.filter(t=>t.type==="out").reduce((s,t)=>s+Number(t.amount||0),0)}});
  charts.monthly=new Chart($("#monthlyCashChart"),{type:"bar",data:{labels:vals.map(x=>x.label),datasets:[{label:"Net cash flow",data:vals.map(x=>x.v)}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});
}
function renderExpenses(){
  const active=state.expenses.filter(x=>!x.deletedAt),month=today().slice(0,7),search=($("#expenseSearch")?.value||"").toLowerCase(),category=$("#expenseCategoryFilter")?.value||"";
  const currency=state.settings.currency||"GHS",sameCurrency=active.filter(x=>(x.currency||currency)===currency),monthly=sameCurrency.filter(x=>String(x.date||"").startsWith(month)),total=sameCurrency.reduce((n,x)=>n+Number(x.amount||0),0),monthTotal=monthly.reduce((n,x)=>n+Number(x.amount||0),0),categories={};sameCurrency.forEach(x=>categories[x.category||"Other"]=(categories[x.category||"Other"]||0)+Number(x.amount||0));
  $("#expenseMonthTotal").textContent=money(monthTotal);$("#expenseTotal").textContent=money(total);$("#expenseCount").textContent=`${active.length} expense entries`;$("#expenseTopCategory").textContent=Object.entries(categories).sort((a,b)=>b[1]-a[1])[0]?.[0]||"—";
  const select=$("#expenseCategoryFilter"),selected=select.value;select.innerHTML=`<option value="">All categories</option>${Object.keys(categories).sort().map(x=>`<option ${selected===x?"selected":""}>${esc(x)}</option>`).join("")}`;
  const rows=active.filter(x=>`${x.vendor||""} ${x.category||""} ${x.reference||""} ${x.description||""}`.toLowerCase().includes(search)).filter(x=>!category||x.category===category).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  $("#expensesTable").innerHTML=rows.length?rows.map(x=>`<tr><td>${esc(x.date||"")}</td><td>${esc(x.category||"—")}</td><td>${esc(x.vendor||"—")}</td><td>${esc(displayPaymentMethod(x.paymentMethod))}</td><td>${esc(x.reference||"—")}</td><td>${money(x.amount,x.currency||state.settings.currency)}</td><td>${x.receiptData?`<a class="link-btn" href="${x.receiptData}" download="${esc(x.receiptName||"expense-receipt")}">View receipt</a>`:esc(x.receiptName||"—")}</td><td><button class="icon-btn danger-action" data-archive-expense="${x.id}">Archive</button></td></tr>`).join(""):`<tr><td colspan="8" class="empty">No expenses recorded yet.</td></tr>`;
  $("#addExpenseBtn").onclick=openExpense;
  $$('[data-archive-expense]').forEach(b=>b.onclick=()=>{const x=state.expenses.find(e=>e.id===b.dataset.archiveExpense);if(x)confirmAction({title:"Archive this expense?",message:`${x.category||"This expense"}${x.vendor?` from ${x.vendor}`:""} will be hidden from active expense totals. Its record and receipt will be retained.`,confirmLabel:"Archive expense",onConfirm:()=>mutate(()=>x.deletedAt=new Date().toISOString(),"Archived expense",x.reference||x.id,x.category||"")})});
}
function renderFinanceDocs(){
  const receipts=[...state.receipts].filter(x=>!x.deletedAt).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  $("#receiptsTable").innerHTML=receipts.length?receipts.map(r=>`<tr><td><strong>${esc(r.number)}</strong></td><td>${esc(r.date||"")}</td><td>${esc(r.customerName||"")}</td><td>${esc(r.invoiceNumber||"")}</td><td>${esc(displayPaymentMethod(r.paymentMethod||"Cash"))}</td><td>${money(r.amount,r.currency||state.settings.currency)}</td><td>${money(r.balanceAfter,r.currency||state.settings.currency)}</td><td><button class="icon-btn" data-print-receipt="${r.id}">Print receipt</button></td></tr>`).join(""):`<tr><td colspan="8" class="empty">Receipts will appear here as customer payments are recorded.</td></tr>`;
  const credits=[...state.creditNotes].filter(x=>!x.voidedAt).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  $("#creditNotesTable").innerHTML=credits.length?credits.map(c=>`<tr><td><strong>${esc(c.number)}</strong></td><td>${esc(c.date||"")}</td><td>${esc(c.customerName||"")}</td><td>${esc(c.invoiceNumber||"")}</td><td>${esc(c.reason||"")}</td><td>${money(c.amount,c.currency||state.settings.currency)}</td><td><button class="icon-btn" data-print-credit="${c.id}">Print</button></td></tr>`).join(""):`<tr><td colspan="7" class="empty">No credit notes have been issued.</td></tr>`;
  $("#createCreditNoteBtn").onclick=openCreditNote;$$('[data-print-receipt]').forEach(b=>b.onclick=()=>printReceipt(b.dataset.printReceipt));$$('[data-print-credit]').forEach(b=>b.onclick=()=>printCreditNote(b.dataset.printCredit));
}
function openExpense(){
  let receiptData="",receiptName="";
  modal(`<div class="modal-head"><div><div class="eyebrow">MONEY OUT</div><h3>Record an expense</h3></div><button class="close" data-close-modal>×</button></div><div class="form-grid"><label>Date<input id="expenseDate" class="input" type="date" value="${today()}"></label><label>Category<input id="expenseCategory" class="input" placeholder="Transport, rent, utilities…"></label><label>Vendor<input id="expenseVendor" class="input" placeholder="Business or supplier"></label><label>Amount<input id="expenseAmount" class="input" type="number" min="0.01" step=".01" placeholder="0.00"></label><label>Currency<select id="expenseCurrency" class="input">${["GHS","USD","EUR","NGN"].map(c=>`<option value="${c}" ${c===(state.settings.currency||"GHS")?"selected":""}>${c}</option>`).join("")}</select></label><label>Payment method<select id="expenseMethod" class="input">${paymentMethodOptions()}</select></label><label>Reference<input id="expenseReference" class="input" placeholder="Receipt or transaction number"></label><label>Attach receipt (PDF or image)<input id="expenseReceipt" class="input" type="file" accept="image/*,application/pdf"><small class="muted">Files up to 2 MB are stored with the Drive workspace backup.</small></label><label>Description<textarea id="expenseDescription" class="input" rows="2"></textarea></label></div><div id="expenseReceiptName" class="muted"></div><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="saveExpense">Save expense</button></div>`);
  $("#expenseReceipt").onchange=()=>{const file=$("#expenseReceipt").files?.[0];if(!file)return;if(file.size>2*1024*1024){toast("Receipt files must be 2 MB or less.");$("#expenseReceipt").value="";return}receiptName=file.name;const reader=new FileReader();reader.onload=()=>{receiptData=String(reader.result||"");$("#expenseReceiptName").textContent=`Attached: ${receiptName}`};reader.readAsDataURL(file)};
  $("#saveExpense").onclick=()=>{const amount=round2(+$("#expenseAmount").value||0),category=$("#expenseCategory").value.trim(),vendor=$("#expenseVendor").value.trim();if(amount<=0||!category)return toast("Enter an expense category and a valid amount.");const date=$("#expenseDate").value||today(),currency=$("#expenseCurrency").value||"GHS",expense={id:uid("expense"),number:nextFinanceNumber("EXP",state.expenses),date,category,vendor,amount,currency,paymentMethod:$("#expenseMethod").value,reference:$("#expenseReference").value.trim()||nextFinanceNumber("EXP",state.expenses),description:$("#expenseDescription").value.trim(),receiptName,receiptData};mutate(()=>{state.expenses.unshift(expense);state.transactions.push({id:uid("tx"),date,type:"out",category,description:`${vendor||category}${expense.description?` — ${expense.description}`:""}`,amount,reference:expense.reference,paymentMethod:expense.paymentMethod,currency,expenseId:expense.id})},"Recorded expense",expense.reference,`${vendor||category} · ${money(amount,currency)}`);closeModal();toast("Expense recorded.")};
}
function openCreditNote(){
  const invoices=state.invoices.filter(i=>i.status!=="Void"&&invoiceBalance(i)>0);
  if(!invoices.length)return toast("There are no open invoices to credit.");
  modal(`<div class="modal-head"><div><div class="eyebrow">SALES ADJUSTMENT</div><h3>Create credit note</h3></div><button class="close" data-close-modal>×</button></div><div class="form-stack"><label>Invoice<select id="creditInvoice" class="input">${invoices.map(i=>`<option value="${i.id}">${esc(i.number)} · ${esc(i.customerName)} · ${money(invoiceBalance(i),i.currency||state.settings.currency)} due</option>`).join("")}</select></label><label>Credit amount<input id="creditAmount" type="number" min=".01" step=".01" class="input"></label><label>Reason<textarea id="creditReason" class="input" rows="3" placeholder="Reason for adjustment"></textarea></label><p class="muted" id="creditBalanceHint"></p></div><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="saveCreditNote">Issue credit note</button></div>`);
  const update=()=>{const inv=invoices.find(x=>x.id===$("#creditInvoice").value);if(!inv)return;const balance=invoiceBalance(inv);$("#creditAmount").max=balance;$("#creditAmount").value=Math.min(Number($("#creditAmount").value||balance),balance)||balance;$("#creditBalanceHint").textContent=`Open balance: ${money(balance,inv.currency||state.settings.currency)}. A credit note reduces the receivable; it does not erase the original invoice.`};$("#creditInvoice").onchange=update;update();
  $("#saveCreditNote").onclick=()=>{const inv=invoices.find(x=>x.id===$("#creditInvoice").value),reason=$("#creditReason").value.trim(),amount=round2(+$("#creditAmount").value||0);if(!inv||amount<=0||amount>invoiceBalance(inv))return toast("Enter a valid credit amount within the invoice balance.");if(!reason)return toast("Add a reason for this credit note.");const note={id:uid("credit"),number:nextFinanceNumber("CN",state.creditNotes),date:today(),invoiceId:inv.id,invoiceNumber:inv.number,customerName:inv.customerName,reason,amount,currency:inv.currency||state.settings.currency};mutate(()=>state.creditNotes.unshift(note),"Issued credit note",note.number,`${note.invoiceNumber} · ${money(amount,note.currency)}`);closeModal();toast(`${note.number} issued.`)};
}
function renderAudit(){
  const q=($("#auditSearch")?.value||"").toLowerCase(),rows=state.auditLog.filter(x=>`${x.user||""} ${x.action||""} ${x.record||""} ${x.details||""}`.toLowerCase().includes(q));
  $("#auditTable").innerHTML=rows.length?rows.map(x=>`<tr><td>${new Date(x.date).toLocaleString("en-GH")}</td><td>${esc(x.user||"Super Admin")}</td><td><strong>${esc(x.action||"Updated business data")}</strong></td><td>${esc(x.record||"—")}</td><td>${esc(x.details||"—")}</td></tr>`).join(""):`<tr><td colspan="5" class="empty">Activity will appear here when you create or update business records.</td></tr>`;
}
function csvEscape(value){const s=String(value??"");return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function downloadCSV(name,rows){const csv=rows.map(row=>row.map(csvEscape).join(",")).join("\r\n"),blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function parseCSV(text){const rows=[];let row=[],field="",quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++}else if(c==='"')quoted=false;else field+=c}else if(c==='"')quoted=true;else if(c===","){row.push(field);field=""}else if(c==="\n"){row.push(field.replace(/\r$/,""));rows.push(row);row=[];field=""}else field+=c}if(field.length||row.length){row.push(field.replace(/\r$/,""));rows.push(row)}return rows}
function exportCustomersCSV(){const fields=["name","contactPerson","phone","email","billingAddress","shippingAddress","taxId","creditLimit","notes"],labels=["Company","Contact Person","Phone","Email","Billing Address","Shipping Address","TIN","Credit Limit","Notes"];downloadCSV("evs-flow-customers.csv",[labels,...state.customers.filter(c=>!c.deletedAt).map(c=>fields.map(f=>c[f]||""))])}
function importCustomersCSV(file){const reader=new FileReader();reader.onload=()=>{try{const rows=parseCSV(String(reader.result||""));if(rows.length<2)return toast("The CSV has no customer rows.");const keys=rows.shift().map(x=>x.trim().toLowerCase().replace(/[^a-z0-9]/g,"")),col=(item,...names)=>{const index=keys.findIndex(k=>names.includes(k));return index<0?"":String(item[index]||"").trim()};const imported=rows.map(r=>({id:uid("cust"),name:col(r,"company","name","customer","customername"),contactPerson:col(r,"contactperson","contact"),phone:col(r,"phone","telephone"),email:col(r,"email"),billingAddress:col(r,"billingaddress","address"),shippingAddress:col(r,"shippingaddress"),address:col(r,"billingaddress","address"),taxId:col(r,"tin","taxid","vatnumber"),creditLimit:round2(Number(col(r,"creditlimit"))||0),notes:col(r,"notes")})).filter(x=>x.name);if(!imported.length)return toast("No customer names were found. Include a Company or Name column.");let count=0;mutate(()=>imported.forEach(c=>{const duplicate=state.customers.some(x=>!x.deletedAt&&(x.email&&x.email.toLowerCase()===c.email.toLowerCase()||x.name.toLowerCase()===c.name.toLowerCase()));if(!duplicate){state.customers.push(c);count++}}),"Imported customers","CSV","Duplicate names/emails skipped");toast(`${count} customers imported. Duplicate names or emails were skipped.`)}catch(e){toast("Could not read this CSV file.")}};reader.readAsText(file)}
function exportReportsCSV(){
  const currency=state.settings.currency||"GHS",from=$("#reportFrom").value||"0000-01-01",to=$("#reportTo").value||today(),invoices=state.invoices.filter(i=>!i.deletedAt&&!i.voidedAt&&i.status!=="Void"&&i.date>=from&&i.date<=to&&(i.currency||currency)===currency),expenses=state.expenses.filter(x=>!x.deletedAt&&x.date>=from&&x.date<=to&&(x.currency||currency)===currency),purchases=state.purchaseInvoices.filter(x=>!x.deletedAt&&x.date>=from&&x.date<=to&&(x.currency||currency)===currency),revenue=invoices.reduce((n,x)=>n+Number(x.total||0),0),cogs=invoices.reduce((n,i)=>n+i.items.reduce((sum,x)=>sum+Number(x.qty||0)*Number(state.products.find(p=>p.id===x.productId)?.cost||0),0),0),expenseTotal=expenses.reduce((n,x)=>n+Number(x.amount||0),0),tax=invoices.reduce((n,x)=>n+Number(x.taxTotal||0),0),debtors=invoices.reduce((n,x)=>n+invoiceBalance(x),0),creditors=purchases.reduce((n,x)=>n+Math.max(0,Number(x.total||0)-Number(x.paid||0)),0),rows=[["Section","Date","Reference","Party / item","Status / category","Amount","Currency"],...[ ["Summary",`${from} to ${to}`,"Sales revenue","", "",revenue,currency],["Summary",`${from} to ${to}`,"Estimated cost of goods","", "",cogs,currency],["Summary",`${from} to ${to}`,"Operating expenses","", "",expenseTotal,currency],["Summary",`${from} to ${to}`,"Estimated profit","", "",revenue-cogs-expenseTotal,currency],["Summary",`${from} to ${to}`,"Debtors","", "",debtors,currency],["Summary",`${from} to ${to}`,"Creditors","", "",creditors,currency],["Summary",`${from} to ${to}`,"VAT and levies","", "",tax,currency],["Summary",today(),"Stock value at cost","", "",stockValue(),currency] ],...invoices.map(i=>["Sales",i.date,i.number,i.customerName,effectiveInvoiceStatus(i),i.total,i.currency||currency]),...expenses.map(x=>["Expense",x.date,x.reference,x.vendor,x.category,x.amount,x.currency||currency]),...purchases.map(x=>["Purchase",x.date,x.number,x.supplierName,x.status,Number(x.total||0),x.currency||currency]),...state.products.filter(x=>!x.deletedAt).map(x=>["Stock",today(),x.sku,x.name,x.category,Number(x.qty||0)*Number(x.cost||0),currency])];
  downloadCSV("evs-flow-business-report.csv",rows);
}
function exportAuditCSV(){downloadCSV("evs-flow-audit-log.csv",[["Timestamp","User","Activity","Record","Details"],...state.auditLog.map(x=>[x.date,x.user,x.action,x.record,x.details])])}
async function loadDemoData(){
  if(state.demoSeeded)return toast("Ghana sample records have already been loaded in this workspace.");
  if(!confirm("Add realistic Ghana sample records (clients, invoices, inventory, supplier documents, receipts and expenses) to this workspace?"))return;
  try{const response=await fetch("sample-data.json");if(!response.ok)throw new Error("Sample data could not be loaded.");const sample=mergeState(await response.json()),collections=["products","customers","invoices","estimates","proformas","suppliers","purchaseOrders","purchaseInvoices","waybills","receipts","creditNotes","expenses","transactions"];mutate(()=>{collections.forEach(key=>{const existing=new Set(state[key].map(x=>x.id));sample[key].forEach(x=>{if(!existing.has(x.id))state[key].push(x)})});if(!state.settings.phone)Object.assign(state.settings,Object.fromEntries(Object.entries(sample.settings).filter(([k])=>["phone","email","address","tax","companyReg","bankDetails"].includes(k))));state.demoSeeded=true},"Loaded Ghana demo dataset","SAMPLE-2026","Kwame Enterprises, Accra · invoices, stock and payments");toast("Ghana sample workspace loaded and synced.")}catch(e){toast("Could not load the sample data. Confirm sample-data.json is deployed with the app.")}
}
function renderCustomers(){
  const q=($("#customerSearch")?.value||"").toLowerCase();
  const rows=state.customers.filter(c=>!c.deletedAt&&`${c.name} ${c.phone||""} ${c.email||""}`.toLowerCase().includes(q));
  const fmtCurrencyMap=map=>Object.entries(map).map(([currency,value])=>money(value,currency)).join(" · ")||"—";
  $("#customersTable").innerHTML=rows.length?rows.map(c=>{const docs=state.invoices.filter(i=>i.customerId===c.id&&!i.deletedAt&&i.status!=="Void"),spent={},owed={};docs.forEach(i=>{const currency=i.currency||state.settings.currency||"GHS";spent[currency]=(spent[currency]||0)+Number(i.total||0);owed[currency]=(owed[currency]||0)+invoiceBalance(i)});return `<tr><td><strong>${esc(c.name)}</strong><small class="table-sub">TIN ${esc(c.taxId||"—")} · Limit ${money(c.creditLimit||0,state.settings.currency)}</small></td><td>${esc(c.contactPerson||"—")}</td><td>${esc(c.phone||"—")}</td><td>${esc(c.email||"—")}</td><td>${esc(c.billingAddress||c.address||"—")}</td><td>${docs.length}</td><td>${fmtCurrencyMap(spent)}</td><td>${fmtCurrencyMap(owed)}</td><td><div class="actions"><button class="icon-btn" data-statement-customer="${c.id}">Statement</button><button class="icon-btn" data-edit-customer="${c.id}">Edit</button><button class="icon-btn danger-action" data-delete-customer="${c.id}">Archive</button></div></td></tr>`}).join(""):`<tr><td colspan="9" class="empty">No customers found.</td></tr>`;
  $$("[data-statement-customer]").forEach(b=>b.onclick=()=>viewCustomerStatement(b.dataset.statementCustomer));
  $$("[data-edit-customer]").forEach(b=>b.onclick=()=>openCustomer(b.dataset.editCustomer));
  $$("[data-delete-customer]").forEach(b=>b.onclick=()=>deleteCustomer(b.dataset.deleteCustomer));
}
function viewCustomerStatement(id){
  const c=state.customers.find(x=>x.id===id);if(!c)return;const invoices=state.invoices.filter(i=>i.customerId===id&&!i.deletedAt).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  const rows=invoices.map(i=>`<tr><td>${esc(i.number)}</td><td>${esc(i.date||"")}</td><td>${esc(i.dueDate||"—")}</td><td>${money(i.total,i.currency||"GHS")}</td><td>${money(i.paid||0,i.currency||"GHS")}</td><td>${money(invoiceBalance(i),i.currency||"GHS")}</td><td>${esc(effectiveInvoiceStatus(i))}</td></tr>`).join("");
  modal(`<div class="modal-head"><div><div class="eyebrow">CUSTOMER ACCOUNT</div><h3>${esc(c.name)} · Statement</h3></div><button class="close" data-close-modal>×</button></div><p class="muted">${esc(c.billingAddress||c.address||"")} ${c.taxId?`· TIN ${esc(c.taxId)}`:""}</p><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Issue date</th><th>Due date</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${rows||`<tr><td colspan="7" class="empty">No invoices recorded for this customer.</td></tr>`}</tbody></table></div><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Close</button><button class="btn btn-primary" id="printCustomerStatement">Print statement</button></div>`);
  $("#printCustomerStatement").onclick=()=>{const s=state.settings;$("#printArea").innerHTML=`<div class="print-document modern-document"><div class="modern-print-head"><div class="modern-company"><img src="${businessLogoSource()}"><div><h1>${esc(s.name)}</h1><p>${esc(s.address||"")}</p><p>${esc(s.phone||"")} · ${esc(s.email||"")}</p></div></div><div class="modern-doc-ref"><span>STATEMENT OF ACCOUNT</span><strong>${esc(c.name)}</strong><small>Generated ${today()}</small></div></div><div class="modern-accent"></div><div class="modern-address"><strong>${esc(c.name)}</strong><span>${esc(c.billingAddress||c.address||"")}</span>${c.taxId?`<span>TIN: ${esc(c.taxId)}</span>`:""}</div><table class="print-table modern-table"><thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${rows||`<tr><td colspan="7">No invoices recorded.</td></tr>`}</tbody></table><div class="print-footer"><span>${esc(s.footer)}</span><span>${esc(s.name)} · Customer statement</span></div></div>`;waitForPrintAssets().then(()=>window.print())};
}
function renderReports(){
  const from=$("#reportFrom")?.value||"0000-01-01",to=$("#reportTo")?.value||"9999-12-31",currency=state.settings.currency||"GHS",invoices=state.invoices.filter(i=>i.date>=from&&i.date<=to&&i.status!=="Void"&&!i.voidedAt),expenses=state.expenses.filter(x=>!x.deletedAt&&x.date>=from&&x.date<=to&&(x.currency||currency)===currency);
  $("#rProducts").textContent=state.products.filter(p=>!p.deletedAt).length;$("#rUnits").textContent=state.products.filter(p=>!p.deletedAt).reduce((s,p)=>s+Number(p.qty||0),0);$("#rInvoices").textContent=invoices.length;$("#rCustomers").textContent=state.customers.filter(c=>!c.deletedAt).length;
  const sold={};invoices.forEach(i=>i.items.forEach(x=>{const key=x.productId||`custom:${x.itemName||x.name||"Service"}`;sold[key]=(sold[key]||0)+Number(x.qty||0)}));
  $("#topProducts").innerHTML=Object.entries(sold).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([id,q])=>{const p=state.products.find(p=>p.id===id),name=p?.name||id.replace(/^custom:/,"");return `<div class="list-row"><div><strong>${esc(name||"Deleted product")}</strong><small>${q} units sold</small></div></div>`}).join("")||`<div class="dashboard-empty"><strong>No product sales yet</strong><span>Sales by product will appear after your first invoice.</span><button type="button" class="link-btn" data-empty-action="invoice">Create an invoice</button></div>`;
  const cat={};state.products.filter(p=>!p.deletedAt).forEach(p=>cat[p.category||"Other"]=(cat[p.category||"Other"]||0)+Number(p.qty||0));$("#categorySummary").innerHTML=Object.entries(cat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="list-row"><strong>${esc(k)}</strong><span>${v} units</span></div>`).join("")||`<div class="dashboard-empty"><strong>No inventory categories</strong><span>Add products to organize stock and monitor value.</span><button type="button" class="link-btn" data-empty-action="product">Add a product</button></div>`;
  const sameCurrency=invoices.filter(i=>(i.currency||currency)===currency),revenue=sameCurrency.reduce((n,i)=>n+Number(i.total||0),0),cogs=sameCurrency.reduce((n,i)=>n+i.items.reduce((sum,x)=>sum+Number(x.qty||0)*Number(state.products.find(p=>p.id===x.productId)?.cost||0),0),0),expenseTotal=expenses.reduce((n,x)=>n+Number(x.amount||0),0),tax=sameCurrency.reduce((n,i)=>n+Number(i.taxTotal||0),0),debtors=sameCurrency.reduce((n,i)=>n+invoiceBalance(i),0),creditors=state.purchaseInvoices.filter(p=>(p.currency||currency)===currency).reduce((n,p)=>n+Math.max(0,Number(p.total||0)-Number(p.paid||0)),0),stock=state.products.filter(p=>!p.deletedAt).reduce((n,p)=>n+Number(p.qty||0)*Number(p.cost||0),0);
  $("#reportSalesTotal").textContent=money(revenue,currency);$("#reportCogs").textContent=money(cogs,currency);$("#reportExpenses").textContent=money(expenseTotal,currency);$("#reportProfit").textContent=money(revenue-cogs-expenseTotal,currency);$("#reportDebtors").textContent=money(debtors,currency);$("#reportCreditors").textContent=money(creditors,currency);$("#reportTax").textContent=money(tax,currency);$("#reportStockValue").textContent=money(stock,currency);
}
function renderSettings(){
  const s=state.settings;$("#setName").value=s.name;$("#setPhone").value=s.phone;$("#setEmail").value=s.email;$("#setAddress").value=s.address;$("#setTax").value=s.tax;$("#setPrefix").value=s.prefix;$("#setCurrency").value=s.currency==="GH₵"?"GHS":s.currency;$("#setFooter").value=s.footer;$("#setCompanyReg").value=s.companyReg||"";$("#setTaxCategories").value=s.taxCategories||"";$("#setDefaultTaxRate").value=s.defaultTaxRate??0;$("#setSalesContract").value=s.salesContract||"";$("#setDocumentNotes").value=s.documentNotes||"";$("#setPaymentTerms").value=s.paymentTerms||"";$("#setBankDetails").value=s.bankDetails||"";$("#setValidityDays").value=s.documentValidityDays??7;$("#setTaxEnabled").checked=s.taxEnabled!==false;$("#setRole").value=s.role||"Super Admin";const preview=$("#setLogoPreview");if(preview)preview.src=s.logoData||"assets/elitevolt-logo.png";
}

const EDITOR_SESSION_PREFIX="evs-flow-editor-session-v1:";
let editorTabSession=null;
const editorTabWindows=new Map();
async function writeEditorSession(id,session){
  const key=`editor:${id}`;
  try{const db=await openLocalWorkspaceDb();await new Promise((resolve,reject)=>{const tx=db.transaction(LOCAL_DB_STORE,"readwrite");tx.objectStore(LOCAL_DB_STORE).put(session,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("Editor session could not be saved"))})}
  catch(e){localStorage.setItem(`${EDITOR_SESSION_PREFIX}${id}`,JSON.stringify(session))}
}
async function readEditorSession(id){
  try{const db=await openLocalWorkspaceDb();const saved=await new Promise((resolve,reject)=>{const request=db.transaction(LOCAL_DB_STORE,"readonly").objectStore(LOCAL_DB_STORE).get(`editor:${id}`);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error)});if(saved)return saved}catch(e){console.warn("Editor tab session could not be read from local storage.",e)}
  try{return JSON.parse(localStorage.getItem(`${EDITOR_SESSION_PREFIX}${id}`)||"null")}catch(e){return null}
}
function openEditorTab(kind,options={}){
  const id=uid("editor"),tab=window.open("about:blank","_blank");
  if(!tab){toast("Allow pop-ups for this site to open an editor in a new tab.","error");return false}
  editorTabWindows.set(id,tab);
  const session={id,kind,options,state:JSON.parse(JSON.stringify(state)),createdAt:Date.now()};
  writeEditorSession(id,session).then(()=>{if(tab.closed)return;const url=new URL(location.href);url.searchParams.set("editorSession",id);tab.location.replace(url.href)}).catch(e=>{console.error(e);if(!tab.closed)tab.close();editorTabWindows.delete(id);toast("The editor tab could not be prepared. Try again.","error")});
  return true;
}
function mergeEditorChanges(currentState,baselineState,updatedState){
  const merged=mergeState(currentState),baseline=baselineState||{};
  Object.keys(merged).filter(key=>Array.isArray(merged[key])&&Array.isArray(updatedState?.[key])).forEach(key=>{
    const before=new Map((baseline[key]||[]).filter(x=>x?.id).map(x=>[x.id,x])),target=merged[key];
    updatedState[key].forEach(item=>{
      if(!item?.id)return;const original=before.get(item.id),changed=!original||JSON.stringify(original)!==JSON.stringify(item);if(!changed)return;
      const index=target.findIndex(x=>x.id===item.id);if(index<0)target.push(item);else target[index]=item;
    });
    if(key==="auditLog")target.sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))).splice(500);
  });
  return merged;
}
function notifyEditorTabSaved(){
  if(!editorTabSession||!window.opener||window.opener.closed)return;
  try{window.opener.postMessage({type:"evs-flow-editor-saved",sessionId:editorTabSession.id,state:JSON.parse(JSON.stringify(state))},location.origin)}catch(e){console.warn("The original workspace tab could not be notified.",e)}
}
window.addEventListener("message",async event=>{
  const message=event.data;if(event.origin!==location.origin||message?.type!=="evs-flow-editor-saved")return;
  const tab=editorTabWindows.get(message.sessionId);if(!tab||event.source!==tab||!message.state)return;
  const session=await readEditorSession(message.sessionId);if(!session?.state)return;
  state=mergeEditorChanges(state,session.state,message.state);renderAll();scheduleSave();
  toast("Saved from the editor tab to your workspace.");
});
function presentEditorAsPage(){
  if(!editorTabSession)return;
  document.body.classList.add("editor-page-mode");
  const card=$("#modalCard"),content=document.createElement("main"),header=document.createElement("header");content.className="editor-page-content";
  while(card.firstChild)content.appendChild(card.firstChild);
  const title=editorTabSession.kind==="product"?"Inventory editor":editorTabSession.kind==="purchase"?"Purchasing editor":"Sales document editor";
  document.title=`${title} | ${state.settings.name||"EliteVolt Systems"}`;
  header.className="editor-page-brand";header.innerHTML=`<div class="editor-page-brand-main"><img src="${businessLogoSource()}" alt=""><div><strong>${esc(state.settings.name||"EliteVolt Systems")}</strong><span>${esc(title)} <i>·</i> Saved changes return to your workspace</span></div></div><span class="editor-page-indicator"><b></b> WORKSPACE EDITOR</span>`;
  card.append(header,content);
}
function modal(content){$("#modalCard").innerHTML=content;$("#modal").classList.remove("hidden")}
function closeModal(){if(document.body.classList.contains("editor-page-mode")){setTimeout(()=>{window.close();setTimeout(()=>{if(!window.closed){document.body.classList.remove("editor-page-mode");$("#modal").classList.add("hidden");$("#modalCard").innerHTML=""}},100)},100);return}$("#modal").classList.add("hidden");$("#modalCard").innerHTML=""}
document.addEventListener("click",e=>{if(e.target.matches("[data-close-modal]"))closeModal()});
function confirmAction({title="Confirm action",message="Continue with this action?",confirmLabel="Confirm",reasonLabel="",reasonPlaceholder="",onConfirm}){
  modal(`<div class="confirm-dialog"><div class="confirm-icon">!</div><div class="modal-head"><div><div class="eyebrow">PLEASE CONFIRM</div><h3>${esc(title)}</h3></div><button class="close" data-close-modal aria-label="Close">×</button></div><p class="confirm-copy">${esc(message)}</p>${reasonLabel?`<label class="confirm-reason">${esc(reasonLabel)}<textarea id="confirmActionReason" class="input" rows="3" placeholder="${esc(reasonPlaceholder)}" required></textarea></label>`:""}<div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-danger" id="confirmActionBtn">${esc(confirmLabel)}</button></div></div>`);
  $("#confirmActionBtn").onclick=()=>{const reason=$("#confirmActionReason")?.value.trim()||"";if(reasonLabel&&!reason){toast("Enter a reason to continue.","error");$("#confirmActionReason")?.focus();return}closeModal();onConfirm?.(reason)};
}

const tablePreferences=new WeakMap();
const tableEmptyStates={
  stockTable:{icon:"▣",title:"Build your product catalogue",copy:"Add the products and services you sell to track availability, cost and price.",action:"product",button:"Add a product"},
  salesTable:{icon:"▤",title:"Your sales documents will appear here",copy:"Create a quotation, estimate or invoice to start tracking customer sales.",action:"invoice",button:"Create an invoice"},
  recentInvoicesTable:{icon:"◷",title:"No invoices yet",copy:"Invoices you create will appear here with their payment status."},
  purchaseOrdersTable:{icon:"▧",title:"No purchase orders yet",copy:"Prepare an order for a supplier and track goods as they arrive.",action:"purchaseOrder",button:"Create a purchase order"},
  purchaseInvoicesTable:{icon:"▤",title:"No supplier invoices yet",copy:"Record supplier bills here and link each one to a purchase order.",action:"purchaseInvoice",button:"Record a purchase invoice"},
  suppliersTable:{icon:"♧",title:"Add your first supplier",copy:"Keep supplier contacts and purchase history together in one place.",action:"supplier",button:"Add a supplier"},
  waybillsTable:{icon:"⇄",title:"No waybills recorded",copy:"Create a waybill to document goods dispatched to a customer or received from a supplier.",action:"waybill",button:"Create a waybill"},
  cashTable:{icon:"₵",title:"Your cash log is ready",copy:"Record a cash movement to keep incoming and outgoing payments visible.",action:"cash",button:"Record a transaction"},
  expensesTable:{icon:"↘",title:"No expenses recorded",copy:"Add an operating expense and attach a receipt for a complete audit trail.",action:"expense",button:"Record an expense"},
  receiptsTable:{icon:"✓",title:"No receipts yet",copy:"Receipts are created automatically whenever you record a customer payment."},
  creditNotesTable:{icon:"↶",title:"No credit notes issued",copy:"Credit notes stay linked to the source invoice and remain in your financial history."},
  customersTable:{icon:"♙",title:"Add your first customer",copy:"Store billing details once, then reuse them across quotes, invoices and statements.",action:"customer",button:"Add a customer"},
  auditTable:{icon:"◷",title:"No activity recorded yet",copy:"Workspace changes and financial actions will appear here as an audit trail."}
};
function emptyStateMarkup(config,filtered=false){
  if(filtered)return `<div class="table-empty-state"><span class="empty-state-icon">⌕</span><strong>No matching records</strong><span>Try a different search term or clear the table search.</span></div>`;
  return `<div class="table-empty-state"><span class="empty-state-icon">${esc(config?.icon||"◦")}</span><strong>${esc(config?.title||"Nothing to show yet")}</strong><span>${esc(config?.copy||"Records will appear here when you add them.")}</span>${config?.action?`<button type="button" class="btn btn-outline" data-empty-action="${esc(config.action)}">${esc(config.button||"Get started")}</button>`:""}</div>`;
}
function tableHasSourceRecords(id){
  const active=items=>(items||[]).some(x=>!x.deletedAt&&!x.voidedAt);
  return ({stockTable:()=>active(state.products),salesTable:()=>allDocuments().length>0,recentInvoicesTable:()=>active(state.invoices),purchaseOrdersTable:()=>active(state.purchaseOrders),purchaseInvoicesTable:()=>active(state.purchaseInvoices),suppliersTable:()=>active(state.suppliers),waybillsTable:()=>active(state.waybills),cashTable:()=>active(state.transactions),expensesTable:()=>active(state.expenses),receiptsTable:()=>active(state.receipts),creditNotesTable:()=>active(state.creditNotes),customersTable:()=>active(state.customers),auditTable:()=>state.auditLog.length>0})[id]?.()||false;
}
document.addEventListener("click",e=>{
  const action=e.target.closest("[data-empty-action]")?.dataset.emptyAction;if(!action)return;
  ({product:()=>openProduct(),invoice:()=>openSale(null,false,"invoice"),purchaseOrder:()=>openPurchase("order"),purchaseInvoice:()=>openPurchase("invoice"),supplier:()=>openSupplier(),waybill:()=>openWaybill(),cash:()=>openCash(),expense:()=>openExpense(),customer:()=>openCustomer()})[action]?.();
});
function enhanceTables(){
  document.querySelectorAll(".table-wrap").forEach(wrap=>{
    const table=wrap.querySelector("table"),body=table?.tBodies?.[0];if(!table||!body)return;
    let pref=tablePreferences.get(table);if(!pref){pref={query:"",page:0,pageSize:8,sort:-1,direction:1};tablePreferences.set(table,pref)}
    let controls=wrap.querySelector(":scope > .table-controls");
    if(!controls){controls=document.createElement("div");controls.className="table-controls";controls.innerHTML=`<label class="table-search">⌕ <input type="search" placeholder="Search in this table…" aria-label="Search in this table"></label><span class="table-count"></span><div class="table-page"><button type="button" class="icon-btn table-prev" aria-label="Previous page">‹</button><span></span><button type="button" class="icon-btn table-next" aria-label="Next page">›</button></div>`;wrap.appendChild(controls);controls.querySelector("input").oninput=e=>{pref.query=e.target.value.toLowerCase();pref.page=0;update()};controls.querySelector(".table-prev").onclick=()=>{pref.page=Math.max(0,pref.page-1);update()};controls.querySelector(".table-next").onclick=()=>{pref.page++;update()};table.querySelectorAll("thead th").forEach((th,index)=>{th.classList.add("sortable");th.title="Click to sort";th.onclick=()=>{if(pref.sort===index)pref.direction*=-1;else{pref.sort=index;pref.direction=1}pref.page=0;update()}})}
    const update=()=>{let rows=[...body.rows].filter(r=>!r.querySelector(".empty")),filtered=rows.filter(r=>r.textContent.toLowerCase().includes(pref.query));if(pref.sort>=0){const val=r=>r.cells[pref.sort]?.textContent.trim()||"";filtered.sort((a,b)=>{const aa=val(a),bb=val(b),na=Number(aa.replace(/[^\d.-]/g,"")),nb=Number(bb.replace(/[^\d.-]/g,""));return (Number.isFinite(na)&&Number.isFinite(nb)&&aa.match(/[\d]/)&&bb.match(/[\d]/)?na-nb:aa.localeCompare(bb,undefined,{numeric:true,sensitivity:"base"}))*pref.direction})}let emptyRow=[...body.rows].find(r=>r.querySelector(".empty"));if(!emptyRow){emptyRow=document.createElement("tr");emptyRow.innerHTML="<td class=\"empty\"></td>";body.appendChild(emptyRow)}const emptyCell=emptyRow.querySelector(".empty"),hasSource=tableHasSourceRecords(body.id);emptyCell.colSpan=Math.max(1,table.tHead?.rows?.[0]?.cells.length||1);emptyCell.innerHTML=emptyStateMarkup(tableEmptyStates[body.id],(rows.length>0&&filtered.length===0)||(rows.length===0&&hasSource));emptyRow.style.display=filtered.length?"none":"";const pages=Math.max(1,Math.ceil(filtered.length/pref.pageSize));pref.page=Math.min(pref.page,pages-1);const visible=new Set(filtered.slice(pref.page*pref.pageSize,(pref.page+1)*pref.pageSize));rows.forEach(r=>r.style.display=visible.has(r)?"":"none");controls.querySelector(".table-count").textContent=`${filtered.length} record${filtered.length===1?"":"s"}`;controls.querySelector(".table-page span").textContent=`${pref.page+1} / ${pages}`;controls.querySelector(".table-prev").disabled=pref.page===0;controls.querySelector(".table-next").disabled=pref.page>=pages-1};
    if(!controls.dataset.bound){controls.dataset.bound="1";table._tableUpdate=update}update();
  });
}
function globalSearchResults(query){
  const q=query.trim().toLowerCase();if(!q)return [];
  const found=[];
  const add=(type,id,title,meta,view)=>{if(`${title} ${meta}`.toLowerCase().includes(q))found.push({type,id,title,meta,view})};
  state.invoices.filter(x=>!x.deletedAt).forEach(x=>add("invoice",x.id,x.number,`${x.customerName} · ${effectiveInvoiceStatus(x)}`,"sales"));
  [...state.estimates,...state.proformas].filter(x=>!x.deletedAt&&!x.convertedToNumber).forEach(x=>add("sales",x.id,x.number,`${x.customerName} · ${x.status||"Quote"}`,"sales"));
  state.products.filter(x=>!x.deletedAt).forEach(x=>add("product",x.id,x.name,`${x.sku||""} · ${x.category||""}`,"stock"));
  state.customers.filter(x=>!x.deletedAt).forEach(x=>add("customer",x.id,x.name,`${x.phone||""} · ${x.email||""}`,"customers"));
  state.suppliers.filter(x=>!x.deletedAt).forEach(x=>add("supplier",x.id,x.name,`${x.phone||""} · Supplier`,"purchases"));
  [...state.purchaseOrders,...state.purchaseInvoices].forEach(x=>add("purchase",x.id,x.number,`${x.supplierName||"Supplier"} · Purchase document`,"purchases"));
  state.waybills.forEach(x=>add("waybill",x.id,x.number,`${x.partyName||""} · ${x.sourceNumber||"Waybill"}`,"waybills"));
  state.receipts.forEach(x=>add("receipt",x.id,x.number,`${x.customerName} · ${x.invoiceNumber}`,"financeDocs"));
  state.expenses.filter(x=>!x.deletedAt).forEach(x=>add("expense",x.id,x.reference||x.number,`${x.vendor||""} · ${x.category||"Expense"}`,"expenses"));
  return found.slice(0,20);
}
function openGlobalSearch(initial=""){
  modal(`<div class="global-search-modal"><div class="search-modal-head"><span>⌕</span><input id="globalSearchInput" placeholder="Search invoices, customers, products…" value="${esc(initial)}" autocomplete="off"><kbd>ESC</kbd></div><div class="search-shortcuts"><span>Quick actions</span><button data-search-action="invoice">New invoice</button><button data-search-action="quote">New quote</button><button data-search-action="expense">Record expense</button><button data-search-action="waybill">Create waybill</button></div><div id="globalSearchResults" class="global-search-results"></div><div class="search-modal-foot">Search customers, invoices, inventory, suppliers, waybills, receipts and expenses · Press <kbd>⌘ K</kbd> any time</div></div>`);
  const input=$("#globalSearchInput"),results=$("#globalSearchResults");
  const paint=()=>{const rows=globalSearchResults(input.value);results.innerHTML=rows.length?rows.map(x=>`<button class="search-result" data-search-kind="${x.type}" data-search-id="${x.id}" data-search-view="${x.view}"><span class="search-result-icon">${({invoice:"INV",sales:"DOC",product:"SKU",customer:"CRM",supplier:"SUP",purchase:"PO",waybill:"WB",receipt:"REC",expense:"EXP"})[x.type]}</span><span><strong>${esc(x.title)}</strong><small>${esc(x.meta)}</small></span><span>↵</span></button>`).join(""):`<div class="search-empty">${input.value.trim()?"No matching records found.":"Type to search across your workspace."}</div>`;results.querySelectorAll("[data-search-id]").forEach(b=>b.onclick=()=>{const type=b.dataset.searchKind,id=b.dataset.searchId,view=b.dataset.searchView;closeModal();switchView(view);if(type==="invoice"||type==="sales"){const doc=findDocument(id);if(doc)printDocument(id)}else if(type==="product")openProduct(id);else if(type==="customer")openCustomer(id);else if(type==="purchase"){const p=state.purchaseInvoices.find(x=>x.id===id);if(p)printPurchase("invoice",id);else printPurchase("order",id)}else if(type==="waybill")printWaybill(id);else if(type==="receipt")printReceipt(id);else if(type==="expense")switchView("expenses")});};
  input.oninput=paint;paint();input.focus();
  modalCardSearchActions();function modalCardSearchActions(){$$('[data-search-action]').forEach(b=>b.onclick=()=>{const action=b.dataset.searchAction;closeModal();if(action==="invoice")openSale(null,false,"invoice");else if(action==="quote")openSale();else if(action==="expense")openExpense();else openWaybill()})}
}
$("#globalSearchBtn").onclick=()=>openGlobalSearch();
window.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openGlobalSearch()}if(e.key==="Escape"&&!$("#modal").classList.contains("hidden"))closeModal()});

function openProduct(id=null,onSaved=null){if(onSaved){renderProductEditor(id,onSaved);return}openEditorTab("product",{id})}
function renderProductEditor(id=null,onSaved=null){
  const p=id?state.products.find(x=>x.id===id):null;
  const existingSku=p?.sku||"";
  modal(`<div class="modal-head"><h3>${p?"Edit":"Add"} Product</h3><button class="close" data-close-modal>×</button></div>
  <div class="form-grid">
  <label>Product name<input id="pName" class="input" value="${esc(p?.name||"")}" placeholder="e.g. Solar Panel 550W"></label>
  <label>SKU
    <input id="pSku" class="input" value="${esc(existingSku)}" ${p?"":"readonly"} placeholder="Auto-generated">
    <small style="display:block;margin-top:5px;color:#7a8793;font-weight:400">${p?"Existing SKU is retained when editing.":"SKU will be generated automatically from category and product name."}</small>
  </label>
  <label>Category<input id="pCat" class="input" value="${esc(p?.category||"Solar / Electrical")}" placeholder="e.g. Solar Panels"></label>
  <label class="product-description-field">Customer-facing description<textarea id="pDescription" class="input" rows="2" placeholder="What is included, key specifications, or service scope?">${esc(p?.description||"")}</textarea></label>
  <label>Unit<input id="pUnit" class="input" value="${esc(p?.unit||"pcs")}" placeholder="pcs, box, roll, set"></label>
  <label>Barcode<input id="pBarcode" class="input" value="${esc(p?.barcode||"")}" placeholder="Optional scanner code"></label>
  <label>Quantity<input id="pQty" type="number" min="0" class="input" value="${p?.qty??0}"></label>
  <label>Minimum stock<input id="pMin" type="number" min="0" class="input" value="${p?.minQty??2}"></label>
  <label>Cost price<input id="pCost" type="number" min="0" step=".01" class="input" value="${p?.cost??0}"></label>
  <label>Selling price<input id="pPrice" type="number" min="0" step=".01" class="input" value="${p?.price??0}"></label>
  </div><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="saveProductBtn">Save Product</button></div>`);

  const skuInput=$("#pSku");
  const updateAutoSku=()=>{
    if(!p) skuInput.value=makeSku($("#pCat").value,$("#pName").value);
  };
  $("#pName").addEventListener("input",updateAutoSku);
  $("#pCat").addEventListener("input",updateAutoSku);
  updateAutoSku();

  $("#saveProductBtn").onclick=()=>{
    const name=$("#pName").value.trim();
    const category=$("#pCat").value.trim();
    if(!name){toast("Product name is required.");return}
    if(!category){toast("Category is required.");return}

    const sku=p?.sku || makeSku(category,name);
    const duplicate=state.products.some(x=>x.id!==(p?.id||"") && String(x.sku||"").toUpperCase()===sku.toUpperCase());
    if(duplicate){toast("Generated SKU already exists. Please try again.");return}

    const obj={
      id:p?.id||uid("prod"),
      name,
      description:$("#pDescription").value.trim(),
      sku,
      category,
      unit:$("#pUnit").value.trim()||"pcs",
      barcode:$("#pBarcode").value.trim(),
      qty:+$("#pQty").value,
      minQty:+$("#pMin").value,
      cost:+$("#pCost").value,
      price:+$("#pPrice").value
    };
    mutate(()=>{if(p)Object.assign(p,obj);else state.products.push(obj)},p?"Updated inventory item":"Created inventory item",obj.sku,obj.name);
    closeModal();
    notifyEditorTabSaved();
    if(onSaved) onSaved(obj.id);
  };
}
function openAdjust(id){
  const p=state.products.find(x=>x.id===id);if(!p)return;
  modal(`<div class="modal-head"><h3>Adjust Stock — ${esc(p.name)}</h3><button class="close" data-close-modal>×</button></div>
  <div class="form-stack"><label>Adjustment quantity<input id="aQty" type="number" class="input" value="0"></label><label>Reason<select id="aReason" class="input"><option>Stock received</option><option>Stock damaged</option><option>Stock count correction</option><option>Other</option></select></label><label>Note<input id="aNote" class="input"></label></div>
  <div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="adjustBtn">Apply</button></div>`);
  $("#adjustBtn").onclick=()=>{const n=+$("#aQty").value;if(!n){toast("Enter an adjustment quantity.");return}if(Number(p.qty)+n<0)return toast("An adjustment cannot reduce stock below zero.");mutate(()=>{p.qty=Number(p.qty)+n;state.transactions.push({id:uid("tx"),date:today(),type:n>0?"in":"out",category:"Stock adjustment",description:`${$("#aReason").value}: ${$("#aNote").value}`,amount:0,reference:p.sku||p.id})},"Adjusted inventory",p.sku||p.name,`${n>0?"+":""}${n} units · ${$("#aReason").value}`);closeModal();};
}
function deleteProduct(id){
  const p=state.products.find(x=>x.id===id); if(!p)return;
  const referenced=[...allDocuments(),...state.purchaseOrders,...state.purchaseInvoices,...state.waybills].some(d=>d.items?.some(x=>x.productId===id));
  const reserved=reservedQty(id)>0;
  if(referenced){toast("This item is used in a sales, purchase or waybill record, so it cannot be archived. Existing documents remain linked to it.","error");return}
  if(reserved){toast("This item has stock reserved for a customer and cannot be archived yet.","error");return}
  confirmAction({title:`Archive ${p.name}?`,message:Number(p.qty||0)>0?`${p.qty} unit(s) are currently in stock. Archiving hides this item from active selection while retaining its inventory record.`:"This item will be hidden from active inventory. Its record will be retained.",confirmLabel:"Archive product",onConfirm:()=>mutate(()=>p.deletedAt=new Date().toISOString(),"Archived product",p.sku||p.name,"Product inventory record retained")});
}
function nextDocumentNumber(kind){
  const year=new Date().getFullYear();
  const map={estimate:state.estimates,proforma:state.proformas,invoice:state.invoices};
  const code={estimate:"QUO",proforma:"PRO",invoice:"INV"}[kind];
  const arr=map[kind]||[];
  const nums=arr.map(d=>d.number).filter(n=>String(n||"").includes(`${code}-${year}-`)).map(n=>+(String(n).split("-").pop())||0);
  return `${code}-${year}-${String(Math.max(0,...nums)+1).padStart(4,"0")}`;
}
function addDays(date,days){const d=new Date(date+"T00:00:00");d.setDate(d.getDate()+days);return d.toISOString().slice(0,10)}
function customerSnapshot(c){return {customerId:c?.id||"",customerName:c?.name||"",customerContactPerson:c?.contactPerson||"",customerPhone:c?.phone||"",customerEmail:c?.email||"",customerBillingAddress:c?.billingAddress||c?.address||"",customerShippingAddress:c?.shippingAddress||"",customerTaxId:c?.taxId||""}}
function customerSelectHtml(selected=""){
  return `<select id="sCustomer" class="input"><option value="">Select customer…</option>${state.customers.filter(c=>!c.deletedAt).map(c=>`<option value="${c.id}" ${c.id===selected?"selected":""}>${esc(c.name)}</option>`).join("")}</select><button type="button" class="btn btn-outline" id="addCustomerInline">+ Add customer</button>`;
}
function openSale(sourceId=null,copyMode=false,initialType="estimate"){openEditorTab("sale",{sourceId,copyMode,initialType})}
function renderSaleEditor(sourceId=null, copyMode=false, initialType="estimate"){
  const source=sourceId?findDocument(sourceId):null;
  const sourceKind=source?(state.proformas.some(x=>x.id===source.id)?"proforma":"estimate"):"estimate";
  const taxLabels=parseTaxCategories(state.settings.taxCategories);
  modal(`<div class="modal-head"><div><div class="eyebrow">SALES DOCUMENT</div><h3>${source && !copyMode ? "Edit " + esc(source.number) : "Create a document"}</h3></div><button class="close" data-close-modal>×</button></div>
  <div class="sale-composer"><div class="sale-fields">
  <p class="muted">Build a branded quote or invoice with accurate tax totals and a live print preview. Stock is deducted when an invoice is created.</p>
  <div class="two-col"><label>Document type<select id="sDocType" class="input" ${source&&!copyMode?"disabled":""}><option value="estimate" ${(initialType==="estimate"&&!source)||(source&&!copyMode&&sourceKind==="estimate")||copyMode?"selected":""}>Quote / Estimate</option><option value="invoice" ${initialType==="invoice"&&!source?"selected":""} ${source&&!copyMode?"disabled":""}>Sales invoice</option>${sourceKind==="proforma"&&!copyMode?`<option value="proforma" selected>Proforma invoice</option>`:""}</select></label><label>Currency<select id="sCurrency" class="input">${["GHS","USD","EUR","NGN"].map(c=>`<option value="${c}" ${(source?.currency||state.settings.currency||"GHS")===c?"selected":""}>${c}</option>`).join("")}</select></label></div>
  <div class="two-col" style="margin-top:12px"><label>Issue date<input id="sDate" type="date" class="input" value="${esc(source?.date||today())}"></label><label>Due date <span class="muted">(invoice)</span><input id="sDueDate" type="date" class="input" value="${esc(source?.dueDate||addDays(today(),30))}"></label></div>
  <div class="two-col" style="margin-top:12px"><div><label>Customer ${customerSelectHtml(source && !copyMode ? source.customerId : "")}</label></div><div><label>Customer details</label><div id="selectedCustomerInfo" class="selected-customer">Select a customer. Walk-in customers are not used for formal documents.</div></div></div>
  <div style="margin-top:15px"><div class="panel-head"><h3>Items</h3><span class="muted">Add a clear description for each quoted item.</span></div><div id="saleLines" class="line-items"></div><div class="line-add-actions"><button type="button" class="btn btn-outline" id="addLine">+ New item</button><button type="button" class="btn btn-outline" id="quickAddStock">+ Add new stock item</button></div><div id="stockWarning" class="stock-warning hidden"></div></div>
  <div class="form-grid" style="margin-top:14px"><label>Discount (%)<input id="sDiscount" type="number" min="0" max="100" step=".01" class="input" value="${source?.subtotal?round2(Number(source.discount||0)/Number(source.subtotal)*100):0}"><small class="muted">Discount amount: <span id="discountPct">${source?.subtotal?round2(Number(source.discount||0)/Number(source.subtotal)*100):0}%</span> of subtotal</small></label><label>Delivery charge<input id="sDelivery" type="number" min="0" step=".01" class="input" value="${source?.deliveryCharge||0}"></label><label>Installation / labour charge<input id="sLabor" type="number" min="0" step=".01" class="input" value="${source?.laborCharge||0}"></label></div>
  <div class="panel" style="margin-top:14px"><label style="display:flex;gap:8px;align-items:center"><input id="sTaxEnabled" type="checkbox" ${(source?.taxEnabled!==false && state.settings.taxEnabled!==false)?"checked":""}> Apply configured taxes</label><div class="muted" id="taxSummary" style="margin-top:5px"></div></div>
  <label id="sPurposeWrap" style="display:block;margin-top:12px">Comments — what is this quote / proforma about?<textarea id="sPurpose" class="input" rows="3" placeholder="Describe the project, request, or work covered by this proposal.">${esc(source?.purpose||"")}</textarea></label>
  <label style="display:block;margin-top:12px">Document note<textarea id="sNote" class="input" rows="2">${esc(source?.note||state.settings.documentNotes||"")}</textarea></label>
  <div class="sale-total">Total: <span id="saleTotal" style="margin-left:8px">${money(0)}</span></div>
  </div><aside class="sale-preview"><div class="preview-top"><span>LIVE PREVIEW</span><span class="preview-status" id="previewType">QUOTE</span></div><div class="preview-brand"><img src="${businessLogoSource()}" alt=""><div><strong id="previewCompany">${esc(state.settings.name||"EliteVolt Systems")}</strong><small>Customer document</small></div></div><div class="preview-document"><small id="previewNumber">DRAFT DOCUMENT</small><h3 id="previewTotal">${money(0)}</h3><div class="preview-line"><span>Items</span><strong id="previewItems">0</strong></div><div class="preview-line"><span>Subtotal</span><strong id="previewSubtotal">${money(0)}</strong></div><div class="preview-line"><span>Taxes</span><strong id="previewTaxes">${money(0)}</strong></div><div class="preview-party"><small>BILL TO</small><strong id="previewCustomer">Select a customer</strong><span id="previewDate">${today()}</span></div><div id="previewPurpose" class="preview-purpose hidden"></div><div class="preview-lines" id="previewLineItems"><span>No items added</span></div><div class="preview-note">${esc(state.settings.footer||"Thank you for your business.")}</div></div><p class="preview-hint">Your print-ready layout includes line descriptions, tax details, payment terms and business information.</p></aside></div>
  <div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="saveSaleBtn">Save document</button></div>`);

  function refreshCustomerInfo(){
    const c=state.customers.find(c=>c.id===$("#sCustomer").value);
    $("#selectedCustomerInfo").innerHTML=c?`<strong>${esc(c.name)}</strong><br>${esc(c.phone||"")} ${c.email?`• ${esc(c.email)}`:""}<br>${esc(c.billingAddress||"")}${c.shippingAddress?`<br>Ship: ${esc(c.shippingAddress)}`:""}`:"<span class='muted'>Select a customer. Walk-in customers are not used for formal documents.</span>";
  }
  $("#addCustomerInline").onclick=()=>openCustomerQuick(id=>{ $("#sCustomer").value=id; refreshCustomerInfo(); });
  $("#sCustomer").onchange=()=>{refreshCustomerInfo();updateTotal()};
  refreshCustomerInfo();

  const productOptions=()=>state.products.filter(p=>!p.deletedAt).map(p=>`<option value="${esc(p.name)}" label="${esc(`${p.sku||""} · ${availableQty(p.id)} available`)}"></option><option value="${esc(p.sku||"")}" label="${esc(p.name)}"></option>`).join("");
  const resolveLineProduct=value=>{const key=String(value||"").trim().toLowerCase();if(!key)return null;return state.products.find(p=>!p.deletedAt&&[p.name,p.sku,`${p.name} — ${p.sku}`].some(v=>String(v||"").trim().toLowerCase()===key))||null};
  const addLine=(selectedId="",qty=1,linePrice=0,lineId="",itemDescription="",customName="")=>{
    const row=document.createElement("div"),initialProduct=state.products.find(p=>p.id===selectedId),initialName=initialProduct?.name||customName||"";row.className="product-line";row.dataset.lineId=lineId||uid("line");row.dataset.productId=selectedId||"";row.dataset.itemName=initialName;
    const initialDescription=itemDescription||initialProduct?.description||"";
    row.innerHTML=`<label class="line-field"><span>Item</span><input class="input line-product" aria-label="Product or service" list="saleProductOptions" placeholder="Type a product, service, or SKU" value="${esc(initialName)}"></label><label class="line-field"><span>Quantity</span><input class="input line-qty" aria-label="Quantity" type="number" min="1" value="${qty}"></label><label class="line-field"><span>Unit price</span><input class="input line-price" aria-label="Unit price" type="number" min="0" step=".01" value="${linePrice}"></label><div class="line-sub-wrap"><small>Amount</small><span class="line-sub">${money(0)}</span></div><button class="icon-btn remove-line" type="button" aria-label="Remove item">×</button><textarea class="input line-description" rows="2" aria-label="Customer-facing item description" placeholder="Customer-facing description: scope, size, specification, or service included">${esc(initialDescription)}</textarea>`;
    $("#saleLines").appendChild(row);
    const input=row.querySelector(".line-product"),price=row.querySelector(".line-price"),description=row.querySelector(".line-description");
    if(selectedId&&!lineId&&!Number(linePrice))price.value=initialProduct?.price||0;
    const updateSelection=()=>{const p=resolveLineProduct(input.value),nextId=p?.id||"",nextName=p?.name||input.value.trim(),changed=nextId!==row.dataset.productId||nextName!==row.dataset.itemName;if(p&&input.value!==p.name)input.value=p.name;if(changed){if(p)price.value=p.price||0;else if(row.dataset.productId)price.value="";description.value=p?.description||"";description.dataset.autoDescription="true"}row.dataset.productId=nextId;row.dataset.itemName=nextName;updateTotal()};
    input.oninput=updateSelection;input.onchange=updateSelection;description.oninput=()=>{description.dataset.autoDescription="false";updateTotal()};row.oninput=updateTotal;row.querySelector(".remove-line").onclick=()=>{row.remove();updateTotal()};
    if(selectedId||customName)updateSelection();else updateTotal();
  };
  $("#saleLines").insertAdjacentHTML("beforebegin",`<datalist id="saleProductOptions">${productOptions()}</datalist>`);
  const refreshLineOptions=()=>{$("#saleProductOptions").innerHTML=productOptions()};
  const updateTotal=()=>{
    const rows=$$(".product-line");
    const items=rows.map(r=>{const selected=resolveLineProduct(r.querySelector('.line-product').value);return {productId:selected?.id||r.dataset.productId||"",itemName:selected?.name||r.querySelector('.line-product').value.trim(),qty:+r.querySelector('.line-qty').value||0,price:+r.querySelector('.line-price').value||0,description:r.querySelector('.line-description').value.trim()}}).filter(x=>x.itemName&&x.qty>0);
    rows.forEach(r=>{const q=+r.querySelector('.line-qty').value||0;r.querySelector('.line-sub').textContent=money(q*(+r.querySelector('.line-price').value||0));});
    const subtotal=round2(items.reduce((s,x)=>s+x.qty*x.price,0)),discountPercent=Math.min(100,Math.max(0,+$("#sDiscount").value||0)),discount=round2(Math.min(subtotal,subtotal*discountPercent/100)),delivery=+$("#sDelivery").value||0,labor=+$("#sLabor").value||0,base=Math.max(0,subtotal-discount+delivery+labor),tax=$("#sTaxEnabled").checked?taxBreakdown(base,state.settings.taxCategories).reduce((s,x)=>s+x.amount,0):0,currency=$("#sCurrency").value,total=round2(base+tax);
    $("#sDiscount").value=discountPercent; $("#discountPct").textContent=discountPercent.toFixed(2)+"%"; $("#taxSummary").textContent=$("#sTaxEnabled").checked?(taxLabels.length?taxLabels.map(x=>`${esc(x.name)} ${x.rate}%`).join(" + "):"No configured taxes"):"Taxes excluded";
    $("#saleTotal").textContent=money(total,currency);$("#previewTotal").textContent=money(total,currency);$("#previewSubtotal").textContent=money(subtotal,currency);$("#previewTaxes").textContent=money(tax,currency);$("#previewItems").textContent=String(items.reduce((n,x)=>n+x.qty,0));
    $("#previewType").textContent=$("#sDocType").selectedOptions[0]?.text.toUpperCase()||"QUOTE";$("#previewNumber").textContent=source&&!copyMode?`${source.number} · ${effectiveSalesDocStatus(source).toUpperCase()}`:$("#sDocType").value==="invoice"?"DRAFT INVOICE":"DRAFT QUOTATION";$("#previewDate").textContent=`${$("#sDate").value||today()} · Due ${$("#sDueDate").value||"—"}`;
    const customer=state.customers.find(x=>x.id===$("#sCustomer").value);$("#previewCustomer").textContent=customer?.name||"Select a customer";
    $("#previewLineItems").innerHTML=items.length?items.slice(0,5).map(x=>`<div><span>${esc(x.itemName||"Item")} <small>× ${x.qty}</small>${x.description?`<small class="preview-item-description">${esc(x.description)}</small>`:""}</span><strong>${money(x.qty*x.price,currency)}</strong></div>`).join("")+(items.length>5?`<small>+ ${items.length-5} more items</small>`:""):`<span>No items added</span>`;
    const purpose=$("#sPurpose").value.trim();$("#previewPurpose").textContent=purpose;$("#previewPurpose").classList.toggle("hidden",!purpose||$("#sDocType").value==="invoice");$("#sPurposeWrap").classList.toggle("hidden",$("#sDocType").value==="invoice");
    const warnings=stockAvailabilityWarnings(items);
    const box=$("#stockWarning");
    if(warnings.length){box.classList.remove("hidden");box.innerHTML=`<strong>Stock alert</strong><br>${warnings.map(esc).join("<br>")}`}else{box.classList.add("hidden");box.innerHTML=""}
  };
  $("#addLine").onclick=()=>addLine();
  $("#quickAddStock").onclick=()=>openQuickProduct((newId)=>{refreshLineOptions();addLine(newId);});
  $("#sDiscount").oninput=updateTotal;$("#sDelivery").oninput=updateTotal;$("#sLabor").oninput=updateTotal;$("#sPurpose").oninput=updateTotal;$("#sTaxEnabled").onchange=updateTotal;$("#sCurrency").onchange=updateTotal;$("#sDate").onchange=updateTotal;$("#sDueDate").onchange=updateTotal;
  $("#sDocType").onchange=()=>{$("#saveSaleBtn").textContent=$("#sDocType").value==="invoice"?"Create invoice":"Save quote / estimate";updateTotal()};
  if(source?.items?.length){source.items.forEach(x=>addLine(x.productId,x.qty,x.price,x.lineId,x.description,x.itemName||x.name||""));}else addLine();

  $("#saveSaleBtn").onclick=()=>{
    const c=state.customers.find(c=>c.id===$("#sCustomer").value);if(!c)return toast("Select or add a customer before saving the quotation.");
    const items=$$(".product-line").map(r=>{const product=resolveLineProduct(r.querySelector('.line-product').value);return {lineId:r.dataset.lineId,productId:product?.id||r.dataset.productId||"",itemName:product?.name||r.querySelector('.line-product').value.trim(),qty:+r.querySelector('.line-qty').value||0,price:+r.querySelector('.line-price').value||0,description:r.querySelector('.line-description').value.trim(),deliveredQty:Number((source?.items||[]).find(x=>x.lineId===r.dataset.lineId)?.deliveredQty||0)}}).filter(x=>x.itemName&&x.qty>0);
    if(!items.length)return toast("Add at least one item with a name and quantity.");
    const warnings=stockAvailabilityWarnings(items, source&&!copyMode?source.id:"");
    if(warnings.length && $("#sDocType").value!=="invoice" && !confirm(`Stock alert:

${warnings.join("\n")}

Save this quotation anyway?`)) return;
    const subtotal=round2(items.reduce((a,x)=>a+x.qty*x.price,0)),asInvoice=$("#sDocType").value==="invoice";
    if(source&&!copyMode&&asInvoice)return toast("Use the document’s Convert to Invoice action to create a new invoice number.");
    const discountPercent=Math.min(100,Math.max(0,+$("#sDiscount").value||0)),discount=round2(Math.min(subtotal,subtotal*discountPercent/100));
    const doc={...(source&&!copyMode?source:{}),id:source&&!copyMode?source.id:uid(asInvoice?"invoice":"estimate"),number:source&&!copyMode?source.number:nextDocumentNumber(asInvoice?"invoice":copyMode?"estimate":sourceKind),date:$("#sDate").value||today(),dueDate:asInvoice?($("#sDueDate").value||addDays(today(),30)):"",validUntil:!asInvoice?addDays($("#sDate").value||today(),Number(state.settings.documentValidityDays||7)):undefined,currency:$("#sCurrency").value||state.settings.currency||"GHS",items,discount,discountPercent,deliveryCharge:round2(+$("#sDelivery").value||0),laborCharge:round2(+$("#sLabor").value||0),paid:0,status:asInvoice?"Draft":(source&&!copyMode?(source.status||"Draft"):"Draft"),delivered:false,stockDeducted:false,stockDeductedAtInvoice:false,reserved:false,purpose:asInvoice?"":$("#sPurpose").value.trim(),note:$("#sNote").value.trim(),taxEnabled:$("#sTaxEnabled").checked,...customerSnapshot(c)};
    recalcDocument(doc);
    if(asInvoice){
      const shortages=stockAvailabilityWarnings(items,source&&!copyMode?source.id:"");
      if(shortages.length)return toast(`Invoice not created. Resolve stock shortages first: ${shortages.join(" ")}`);
    }
    mutate(()=>{
      if(asInvoice){deductStockOnInvoice(doc);state.invoices.push(doc);}
      else if(source&&!copyMode){
        if(sourceKind==="proforma") state.proformas=state.proformas.map(x=>x.id===source.id?doc:x);
        else state.estimates=state.estimates.map(x=>x.id===source.id?doc:x);
      } else state.estimates.push(doc);
    },asInvoice?"Created sales invoice":source&&!copyMode?"Updated sales document":"Created quotation",doc.number,`${doc.customerName} · ${money(doc.total,doc.currency)}`);
    closeModal();notifyEditorTabSaved();toast(asInvoice?`${doc.number} created. Stock has been deducted.`:source&&!copyMode?`${doc.number} updated.`:`${doc.number} saved.`);
  };
}
function openQuickProduct(onSaved){
  const wrap=document.createElement("div");wrap.className="submodal";wrap.innerHTML=`<div class="submodal-card"><div class="modal-head"><h3>Add Item to Stock</h3><button class="close" id="closeQuickProduct">×</button></div><div class="form-grid"><label>Product name<input id="qpName" class="input" placeholder="e.g. Solar Panel 550W"></label><label>Category<input id="qpCat" class="input" value="Solar / Electrical"></label><label class="product-description-field">Customer-facing description<textarea id="qpDescription" class="input" rows="2" placeholder="Key specifications or included service scope"></textarea></label><label>Unit<input id="qpUnit" class="input" value="pcs" placeholder="pcs, box, roll"></label><label>Barcode<input id="qpBarcode" class="input"></label><label>Opening quantity<input id="qpQty" type="number" min="0" class="input" value="0"></label><label>Minimum stock<input id="qpMin" type="number" min="0" class="input" value="2"></label><label>Cost price<input id="qpCost" type="number" min="0" step=".01" class="input" value="0"></label><label>Selling price<input id="qpPrice" type="number" min="0" step=".01" class="input" value="0"></label></div><div class="modal-footer"><button class="btn btn-outline" id="cancelQuickProduct">Cancel</button><button class="btn btn-primary" id="saveQuickProduct">Add Item</button></div></div>`;$("#modalCard").appendChild(wrap);
  const close=()=>wrap.remove();$("#closeQuickProduct").onclick=close;$("#cancelQuickProduct").onclick=close;
  $("#saveQuickProduct").onclick=()=>{const name=$("#qpName").value.trim(),category=$("#qpCat").value.trim();if(!name||!category)return toast("Product name and category are required.");const obj={id:uid("prod"),name,description:$("#qpDescription").value.trim(),sku:makeSku(category,name),category,unit:$("#qpUnit").value.trim()||"pcs",barcode:$("#qpBarcode").value.trim(),qty:+$("#qpQty").value||0,minQty:+$("#qpMin").value||0,cost:+$("#qpCost").value||0,price:+$("#qpPrice").value||0};mutate(()=>state.products.push(obj),"Created inventory item",obj.sku,obj.name);notifyEditorTabSaved();close();onSaved&&onSaved(obj.id);};
}
function deductDocumentStock(doc){
  if(doc.stockDeductedAtInvoice){doc.items.forEach(x=>x.deliveredQty=Number(x.qty||0));doc.delivered=true;doc.stockDeducted=true;doc.reserved=false;return;}
  if(doc.stockDeducted)return;
  const totals={};doc.items.forEach(x=>{if(x?.productId)totals[x.productId]=(totals[x.productId]||0)+Math.max(0,Number(x.qty||0)-Number(x.deliveredQty||0))});
  for(const [productId,remaining] of Object.entries(totals)){const p=state.products.find(p=>p.id===productId);if(!p||Number(p.qty)<remaining)throw new Error(`Insufficient physical stock for ${p?.name||"item"}.`)}
  doc.items.forEach(x=>{const remaining=Math.max(0,Number(x.qty||0)-Number(x.deliveredQty||0)),p=x.productId&&state.products.find(p=>p.id===x.productId);if(p)p.qty-=remaining;x.deliveredQty=Number(x.deliveredQty||0)+remaining});doc.stockDeducted=true;doc.delivered=true;doc.reserved=false;
}
function deductStockOnInvoice(doc){
  if(doc.stockDeductedAtInvoice)return;
  const totals={};doc.items.forEach(x=>{if(x?.productId)totals[x.productId]=(totals[x.productId]||0)+Number(x.qty||0)});
  for(const [productId,qty] of Object.entries(totals)){const p=state.products.find(x=>x.id===productId);if(!p||Number(p.qty||0)<qty)throw new Error(`Insufficient stock for ${p?.name||"this product"}.`)}
  Object.entries(totals).forEach(([productId,qty])=>{const p=state.products.find(x=>x.id===productId);p.qty-=qty});
  doc.stockDeducted=true;doc.stockDeductedAtInvoice=true;doc.reserved=false;doc.delivered=false;
}
function markInvoiceSent(id){const inv=state.invoices.find(x=>x.id===id);if(!inv||inv.status==="Void")return;mutate(()=>{inv.sentAt=today();inv.status=invoiceBalance(inv)<=0?"Paid":Number(inv.paid||0)>0?"Partially Paid":"Sent"},"Marked invoice as sent",inv.number,inv.customerName||"");toast(`${inv.number} marked as sent.`)}
function updateSalesDocStatus(type,id,status){const docs=type==="proforma"?state.proformas:state.estimates,doc=docs.find(x=>x.id===id);if(!doc)return;mutate(()=>{doc.status=status;if(status==="Sent")doc.sentAt=today();if(status==="Accepted")doc.acceptedAt=today()},status==="Sent"?"Marked sales document as sent":status==="Approved"?"Approved sales document":"Accepted sales document",doc.number,status);toast(`${doc.number} marked ${status.toLowerCase()}.`)}
function sendDocumentLink(id,channel){
  const invoice=state.invoices.find(x=>x.id===id),doc=invoice||findDocument(id);if(!doc)return;
  const isInvoice=!!invoice,kind=state.proformas.some(x=>x.id===id)?"proforma":"estimate",currency=doc.currency||state.settings.currency;
  if(channel==="email"&&!doc.customerEmail)return toast("This customer has no email address. Add one in Customers first.");
  if(channel!=="email"&&!doc.customerPhone)return toast("This customer has no phone number. Add one in Customers first.");
  if(invoice&&invoice.status==="Void")return toast("A void invoice cannot be sent.");
  if(!isInvoice&&!['Converted','Expired','Accepted'].includes(effectiveSalesDocStatus(doc))&&effectiveSalesDocStatus(doc)!=="Sent")updateSalesDocStatus(kind,id,"Sent");
  else if(invoice&&invoice.status==="Draft")markInvoiceSent(invoice.id);
  const label=isInvoice?"invoice":kind==="proforma"?"proforma invoice":"quotation",subject=`${label[0].toUpperCase()+label.slice(1)} ${doc.number} from ${state.settings.name}`;
  const dateLine=isInvoice?`Due date: ${doc.dueDate||"—"}.`:doc.validUntil?`Valid until: ${doc.validUntil}.`:"";
  const body=`Hello ${doc.customerName||""},\n\nPlease find ${label} ${doc.number} for ${money(doc.total,currency)}. ${dateLine}${doc.purpose?`\n\nAbout this proposal: ${doc.purpose}`:""}\n\nThank you, ${state.settings.name}.`;
  if(channel==="email")window.location.href=`mailto:${encodeURIComponent(doc.customerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  else{const phone=doc.customerPhone.replace(/[^0-9]/g,"");window.open(`https://wa.me/${phone}?text=${encodeURIComponent(body)}`,"_blank","noopener")}
}
function voidInvoice(id){
  const inv=state.invoices.find(x=>x.id===id);if(!inv||inv.status==="Void")return;
  confirmAction({title:`Void invoice ${inv.number}?`,message:"This invoice and its payment history will remain in your records. Any undelivered stock deducted for this invoice will be returned. Enter a reason to continue.",confirmLabel:"Void invoice",reasonLabel:"Reason for voiding",reasonPlaceholder:"Required for your records",onConfirm:reason=>{mutate(()=>{if(inv.stockDeductedAtInvoice&&!inv.delivered){inv.items.forEach(x=>{const p=state.products.find(y=>y.id===x.productId);if(p)p.qty+=Math.max(0,Number(x.qty||0)-Number(x.deliveredQty||0))})}inv.voidedAt=new Date().toISOString();inv.voidReason=reason;inv.status="Void";inv.reserved=false},"Voided invoice",inv.number,reason);toast(`${inv.number} voided. The record is retained.`,"success")}});
}
function paymentMethodOptions(selected="Cash"){
  const canonical=selected==="Mobile Money — MTN"?"MTN Mobile Money":selected;
  return ["Cash","MTN Mobile Money","Mobile Money — Telecel","Mobile Money — AirtelTigo","Bank Transfer"].map(m=>`<option ${m===canonical?"selected":""}>${m}</option>`).join("");
}
function displayPaymentMethod(method){return method==="Mobile Money — MTN"?"MTN Mobile Money":method||"—"}
function nextFinanceNumber(code,list){const year=new Date().getFullYear(),nums=list.map(x=>String(x.number||"")).filter(n=>n.includes(`${code}-${year}-`)).map(n=>Number(n.split("-").pop())||0);return `${code}-${year}-${String(Math.max(0,...nums)+1).padStart(4,"0")}`}
function createReceipt(inv,amount,paymentMethod="Cash",date=today()){
  const receipt={id:uid("receipt"),number:nextFinanceNumber("REC",state.receipts),date,invoiceId:inv.id,invoiceNumber:inv.number,customerName:inv.customerName||"Customer",amount:round2(amount),balanceAfter:invoiceBalance(inv),paymentMethod,currency:inv.currency||state.settings.currency||"GHS"};
  state.receipts.unshift(receipt);return receipt;
}
function recordPayment(id){
  const inv=state.invoices.find(x=>x.id===id);if(!inv||inv.status==="Void")return;const bal=invoiceBalance(inv);if(bal<=0)return toast("Invoice balance is already settled.");
  modal(`<div class="modal-head"><h3>Record payment · ${esc(inv.number)}</h3><button class="close" data-close-modal>×</button></div><div class="form-stack"><label>Outstanding balance<input class="input" value="${money(bal,inv.currency||state.settings.currency)}" readonly></label><label>Payment amount<input id="payAmount" type="number" min="0.01" max="${bal}" step=".01" class="input" value="${bal}"></label><label>Payment method<select id="payMethod" class="input">${paymentMethodOptions()}</select></label><label>Payment date<input id="payDate" type="date" class="input" value="${today()}"></label></div><p class="muted">A numbered receipt will be created automatically and added to the payment log.</p><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="savePayment">Save payment</button></div>`);
  $("#savePayment").onclick=()=>{const amount=round2(Math.min(bal,Math.max(0,+$("#payAmount").value||0)));if(amount<=0)return toast("Enter a payment amount.");const method=$("#payMethod").value,date=$("#payDate").value||today();mutate(()=>{inv.paid=round2(Number(inv.paid||0)+amount);inv.status=invoiceBalance(inv)<=0?"Paid":"Partially Paid";inv.reserved=false;const receipt=createReceipt(inv,amount,method,date);state.transactions.push({id:uid("tx"),date,type:"in",category:"Sales",description:`Payment for ${inv.number}`,amount,reference:inv.number,paymentMethod:method,currency:inv.currency||state.settings.currency,receiptId:receipt.id})},"Recorded invoice payment",inv.number,`${money(amount,inv.currency)} · ${method}`);closeModal();toast("Payment saved and receipt created.")};
}
function confirmDelivery(id){const inv=state.invoices.find(x=>x.id===id);if(!inv||inv.status==="Void")return;if(inv.delivered)return toast("Delivery is already confirmed.");if(!confirm(`Confirm that ${inv.number} has been delivered to ${inv.customerName}?`))return;try{mutate(()=>{deductDocumentStock(inv);inv.delivered=true;inv.status=Number(inv.paid||0)>=Number(inv.total||0)?"Paid":"Delivered"},"Confirmed invoice delivery",inv.number,inv.customerName||"");}catch(e){toast(e.message)}}
function copyForConversion(source,kind,paid=0){const inv={...source,id:uid(kind),number:nextDocumentNumber(kind),date:today(),dueDate:kind==="invoice"?addDays(today(),30):"",validUntil:kind==="proforma"?addDays(today(),Number(state.settings.documentValidityDays||7)):undefined,currency:source.currency||state.settings.currency||"GHS",paid:kind==="invoice"?round2(paid):0,status:kind==="invoice"?(paid>0?(paid>=source.total?"Paid":"Partially Paid"):"Draft"):"Draft",delivered:false,stockDeducted:false,stockDeductedAtInvoice:false,reserved:false,sourceDocumentId:source.id,sourceDocumentNumber:source.number,taxEnabled:source.taxEnabled!==false};recalcDocument(inv);return inv}
function convertToProforma(id){
  if(!editorTabSession){openEditorTab("convertProforma",{id});return}
  const source=state.estimates.find(x=>x.id===id);if(!source){modal(`<div class="modal-head"><h3>Quotation unavailable</h3><button class="close" data-close-modal aria-label="Close">×</button></div><p class="muted">This quotation could not be found in the workspace.</p><div class="modal-footer"><button class="btn btn-primary" data-close-modal>Close editor</button></div>`);return}
  if(!source.customerId){modal(`<div class="modal-head"><h3>Customer required</h3><button class="close" data-close-modal aria-label="Close">×</button></div><p class="muted">${esc(source.number)} does not have a customer. Add a customer to the quotation before creating a proforma invoice.</p><div class="modal-footer"><button class="btn btn-primary" data-close-modal>Close editor</button></div>`);return}
  modal(`<div class="modal-head"><div><div class="eyebrow">DOCUMENT CONVERSION</div><h3>Convert quote to proforma</h3></div><button class="close" data-close-modal aria-label="Close">×</button></div><div class="conversion-summary"><span>Source quotation</span><strong>${esc(source.number)} · ${esc(source.customerName||"Customer")}</strong><small>${money(source.total,source.currency||state.settings.currency)} · ${source.items.length} line items</small></div><p class="muted">A new proforma invoice will be created with its own document number. The original quotation will remain in your records.</p><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="confirmProformaConversion">Create proforma invoice</button></div>`);
  $("#confirmProformaConversion").onclick=()=>{const pro=copyForConversion(source,"proforma"),warnings=stockAvailabilityWarnings(pro.items);if(warnings.length&&!confirm(`Stock alert:\n\n${warnings.join("\n")}\n\nCreate this proforma invoice anyway?`))return;mutate(()=>{state.proformas.push(pro);source.convertedToNumber=pro.number;source.convertedAt=new Date().toISOString();source.status="Converted"},"Converted quote to proforma",source.number,pro.number);notifyEditorTabSaved();closeModal();toast(`${source.number} converted to ${pro.number}. The original quote is retained in history.`)};
}
function convertToInvoice(id){
  if(!editorTabSession){openEditorTab("convertInvoice",{id});return}
  const sourceType=state.estimates.some(x=>x.id===id)?"estimate":"proforma";
  const source=sourceType==="estimate"?state.estimates.find(x=>x.id===id):state.proformas.find(x=>x.id===id);if(!source){modal(`<div class="modal-head"><h3>Document unavailable</h3><button class="close" data-close-modal aria-label="Close">×</button></div><p class="muted">This sales document could not be found in the workspace.</p><div class="modal-footer"><button class="btn btn-primary" data-close-modal>Close editor</button></div>`);return}
  if(!source.customerId){modal(`<div class="modal-head"><h3>Customer required</h3><button class="close" data-close-modal aria-label="Close">×</button></div><p class="muted">${esc(source.number)} does not have a customer. Add a customer to the sales document before converting it to an invoice.</p><div class="modal-footer"><button class="btn btn-primary" data-close-modal>Close editor</button></div>`);return}
  modal(`<div class="modal-head"><h3>Convert ${esc(source.number)} to Invoice</h3><button class="close" data-close-modal>×</button></div><div class="form-stack"><p class="muted">Customer: <strong>${esc(source.customerName)}</strong><br>Total: <strong>${money(source.total,source.currency||state.settings.currency)}</strong></p><label>Payment / part payment<input id="convertPaid" type="number" min="0" max="${source.total}" step=".01" class="input" value="0"></label><label>Payment method<select id="convertMethod" class="input">${paymentMethodOptions()}</select></label><label>Invoice date<input id="convertDate" type="date" class="input" value="${today()}"></label><p class="muted">Inventory is deducted when the invoice is created. Use its waybill to record delivery.</p></div><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="convertBtn">Create invoice</button></div>`);
  $("#convertBtn").onclick=()=>{
    const paid=Math.min(source.total,Math.max(0,+$("#convertPaid").value||0));
    const inv={...copyForConversion(source,"invoice",paid),date:$("#convertDate").value};
    inv.dueDate=addDays(inv.date,30);
    const warnings=stockAvailabilityWarnings(inv.items);
    if(warnings.length){toast("Not enough available stock: "+warnings.join(" "));return}
    try{
      mutate(()=>{
        deductStockOnInvoice(inv);
        state.invoices.push(inv);
        source.convertedToNumber=inv.number;source.convertedAt=new Date().toISOString();source.status="Converted";
        if(paid>0){state.transactions.push({id:uid("tx"),date:inv.date,type:"in",category:"Sales",description:`Payment for ${inv.number}`,amount:paid,reference:inv.number,paymentMethod:$("#convertMethod").value,currency:inv.currency});createReceipt(inv,paid,$("#convertMethod").value,inv.date);}
      },"Converted sales document to invoice",source.number,inv.number);
      notifyEditorTabSaved();
      closeModal();toast(`${source.number} converted to ${inv.number}. The original document is retained in history.`);
    }catch(e){toast(e.message)}
  };
}
function openCopyQuotation(id){
  const source=findDocument(id); if(!source)return;
  openSale(source.id,true);
}

function nextOperationalNumber(kind){
  const config={
    estimate:{code:"EST",list:state.estimates},proforma:{code:"PRO",list:state.proformas},invoice:{code:"INV",list:state.invoices},
    purchaseOrder:{code:"PO",list:state.purchaseOrders},purchaseInvoice:{code:"PIN",list:state.purchaseInvoices},waybill:{code:"WB",list:state.waybills}
  }[kind];
  if(!config)return nextDocumentNumber(kind);
  const prefix=state.settings.prefix||"EVS",year=new Date().getFullYear(),key=`${prefix}-${config.code}-${year}-`;
  const nums=config.list.map(d=>d.number).filter(n=>n?.startsWith(key)).map(n=>+(n.split("-").pop())||0);
  return `${key}${String(Math.max(0,...nums)+1).padStart(4,"0")}`;
}
function supplierSnapshot(s){return {supplierId:s?.id||"",supplierName:s?.name||"",supplierContactPerson:s?.contactPerson||"",supplierPhone:s?.phone||"",supplierEmail:s?.email||"",supplierAddress:s?.address||"",supplierTaxId:s?.taxId||""}}
function openSupplier(id=null,onSaved=null){
  const s=id?state.suppliers.find(x=>x.id===id):null;
  modal(`<div class="modal-head"><h3>${s?"Edit":"Add"} Supplier</h3><button class="close" data-close-modal>×</button></div><div class="form-grid"><label>Supplier / Company name<input id="supName" class="input" value="${esc(s?.name||"")}" placeholder="Required"></label><label>Contact person<input id="supContact" class="input" value="${esc(s?.contactPerson||"")}"></label><label>Phone<input id="supPhone" class="input" value="${esc(s?.phone||"")}"></label><label>Email<input id="supEmail" class="input" value="${esc(s?.email||"")}"></label><label>Address<textarea id="supAddress" class="input" rows="3">${esc(s?.address||"")}</textarea></label><label>Tax / registration ID<input id="supTax" class="input" value="${esc(s?.taxId||"")}"></label><label>What they supply<input id="supSupplies" class="input" value="${esc(s?.supplies||"")}" placeholder="Panels, batteries, cables"></label></div><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="saveSupplier">Save supplier</button></div>`);
  $("#saveSupplier").onclick=()=>{const obj={id:s?.id||uid("supplier"),name:$("#supName").value.trim(),contactPerson:$("#supContact").value.trim(),phone:$("#supPhone").value.trim(),email:$("#supEmail").value.trim(),address:$("#supAddress").value.trim(),taxId:$("#supTax").value.trim(),supplies:$("#supSupplies").value.trim()};if(!obj.name)return toast("Supplier name is required.");mutate(()=>{if(s)Object.assign(s,obj);else state.suppliers.push(obj)},s?"Updated supplier":"Created supplier",obj.name,obj.supplies);closeModal();if(onSaved)onSaved(obj.id)};
}
function openSupplierQuick(onSaved){
  const wrap=document.createElement("div");wrap.className="submodal";wrap.innerHTML=`<div class="submodal-card"><div class="modal-head"><h3>Add Supplier</h3><button class="close" id="closeQuickSupplier">×</button></div><div class="form-grid"><label>Supplier / Company name<input id="qsName" class="input" placeholder="Required"></label><label>Contact person<input id="qsContact" class="input"></label><label>Phone<input id="qsPhone" class="input"></label><label>Email<input id="qsEmail" class="input"></label><label>Address<textarea id="qsAddress" class="input" rows="2"></textarea></label></div><div class="modal-footer"><button class="btn btn-outline" id="cancelQuickSupplier">Cancel</button><button class="btn btn-primary" id="saveQuickSupplier">Save supplier</button></div></div>`;$("#modalCard").appendChild(wrap);
  const close=()=>wrap.remove();$("#closeQuickSupplier").onclick=close;$("#cancelQuickSupplier").onclick=close;
  $("#saveQuickSupplier").onclick=()=>{const item={id:uid("supplier"),name:$("#qsName").value.trim(),contactPerson:$("#qsContact").value.trim(),phone:$("#qsPhone").value.trim(),email:$("#qsEmail").value.trim(),address:$("#qsAddress").value.trim()};if(!item.name)return toast("Supplier name is required.");mutate(()=>state.suppliers.push(item));const select=$("#pSupplier");if(select){select.insertAdjacentHTML("beforeend",`<option value="${item.id}">${esc(item.name)}</option>`);select.value=item.id}close();onSaved&&onSaved(item.id)};
}
function deleteSupplier(id){
  const supplier=state.suppliers.find(s=>s.id===id);if(!supplier)return;
  const linked=state.purchaseOrders.some(x=>x.supplierId===id)||state.purchaseInvoices.some(x=>x.supplierId===id);
  confirmAction({title:`Archive ${supplier.name}?`,message:linked?"This supplier is linked to purchase documents. The supplier will be hidden from active lists, and purchase history will remain available.":"This supplier will be hidden from active lists. The record will be retained.",confirmLabel:"Archive supplier",onConfirm:()=>mutate(()=>supplier.deletedAt=new Date().toISOString(),"Archived supplier",supplier.name,linked?"Purchase history retained":"")});
}
function purchaseSupplierOptions(selected=""){return `<select id="pSupplier" class="input"><option value="">Select supplier…</option>${state.suppliers.filter(s=>!s.deletedAt).map(s=>`<option value="${s.id}" ${s.id===selected?"selected":""}>${esc(s.name)}</option>`).join("")}</select><button class="btn btn-outline" type="button" id="addSupplierInline">+ Add supplier</button>`}
function openPurchase(kind="order",sourceOrderId=null){openEditorTab("purchase",{kind,sourceOrderId})}
function renderPurchaseEditor(kind="order",sourceOrderId=null){
  const isInvoice=kind==="invoice",sourceOrder=sourceOrderId?state.purchaseOrders.find(x=>x.id===sourceOrderId):null;
  const orderOptions=`<option value="">No linked purchase order</option>${state.purchaseOrders.filter(o=>!state.purchaseInvoices.some(p=>p.sourceOrderId===o.id)||o.id===sourceOrderId).map(o=>`<option value="${o.id}" ${o.id===sourceOrderId?"selected":""}>${esc(o.number)} — ${esc(o.supplierName||"Supplier")}</option>`).join("")}`;
  modal(`<div class="modal-head"><div><h3>New ${isInvoice?"Purchase Invoice":"Purchase Order"}</h3><small class="muted">${isInvoice?"Record a supplier bill; receive stock when goods arrive.":"Plan and print an order for your supplier."}</small></div><button class="close" data-close-modal>×</button></div>
    <div class="two-col"><div><label for="pSupplier">Supplier</label><div class="supplier-select">${purchaseSupplierOptions(sourceOrder?.supplierId||"")}</div></div><label>${isInvoice?"Supplier invoice number":"Order date"}<input id="pReference" class="input" value="" placeholder="${isInvoice?"Optional supplier reference":"Internal note (optional)"}"></label></div>
    ${isInvoice?`<div class="two-col" style="margin-top:12px"><label>Based on purchase order<select id="pSourceOrder" class="input">${orderOptions}</select></label><label>Invoice date<input id="pDate" type="date" class="input" value="${today()}"></label></div><div style="margin-top:12px"><label>Payment due date<input id="pDueDate" type="date" class="input" value="${addDays(today(),30)}"></label></div>`:`<div class="two-col" style="margin-top:12px"><label>Expected date<input id="pDate" type="date" class="input" value="${today()}"></label><label>Delivery / receiving instructions<input id="pInstructions" class="input" placeholder="Optional"></label></div>`}
    <label style="display:block;margin-top:12px">Currency<select id="pCurrency" class="input">${["GHS","USD","EUR","NGN"].map(c=>`<option value="${c}" ${c===(sourceOrder?.currency||state.settings.currency||"GHS")?"selected":""}>${c}</option>`).join("")}</select></label>
    <div class="panel-head" style="margin-top:16px"><h3>Items</h3><div class="actions"><button class="btn btn-outline" id="pAddProduct">+ New product</button><button class="btn btn-outline" id="pAddLine">+ Add item</button></div></div><div id="purchaseLines" class="purchase-lines"></div>
    <div class="form-grid" style="margin-top:14px"><label>Discount<input id="pDiscount" type="number" min="0" step=".01" class="input" value="${sourceOrder?.discount||0}"></label><label>Other charges<input id="pCharges" type="number" min="0" step=".01" class="input" value="${sourceOrder?.otherCharges||0}"></label><label>Supplier tax / duty<input id="pTax" type="number" min="0" step=".01" class="input" value="${sourceOrder?.tax||0}"></label></div>
    <label class="block-label" style="display:block;margin-top:12px">Notes<textarea id="pNote" class="input" rows="2">${esc(sourceOrder?.note||"")}</textarea></label><div class="purchase-total">Document total <strong id="purchaseTotal">${money(0)}</strong></div>
    <div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="savePurchase">Save ${isInvoice?"Purchase Invoice":"Purchase Order"}</button></div>`);
  const lineList=$("#purchaseLines");let selectedOrder=sourceOrder;
  const productOpts=(selected="")=>`<option value="">Select product…</option>${state.products.map(p=>`<option value="${p.id}" ${p.id===selected?"selected":""}>${esc(p.name)} · ${esc(p.sku||"")}</option>`).join("")}`;
  const addLine=(item={})=>{
    const row=document.createElement("div");row.className="purchase-line";row.dataset.lineId=item.lineId||uid("pline");
    const defaultCost=item.cost??item.price??(state.products.find(p=>p.id===item.productId)?.cost||0);
    row.innerHTML=`<select class="input p-line-product">${productOpts(item.productId||"")}</select><input class="input p-line-qty" type="number" min="1" step="1" value="${Number(item.qty||1)}" aria-label="Quantity"><input class="input p-line-cost" type="number" min="0" step=".01" value="${Number(defaultCost)}" aria-label="Unit cost"><strong class="p-line-total">${money(0)}</strong><button type="button" class="icon-btn remove-purchase-line">×</button>`;
    lineList.append(row);row.oninput=updateTotal;row.querySelector(".p-line-product").onchange=()=>{const p=state.products.find(x=>x.id===row.querySelector(".p-line-product").value);if(!item.cost&&!item.price)row.querySelector(".p-line-cost").value=p?.cost||0;updateTotal()};row.querySelector(".remove-purchase-line").onclick=()=>{row.remove();updateTotal()};updateTotal();
  };
  function updateTotal(){const currency=$("#pCurrency").value||"GHS",subtotal=[...lineList.querySelectorAll(".purchase-line")].reduce((n,r)=>{const x=(+r.querySelector(".p-line-qty").value||0)*(+r.querySelector(".p-line-cost").value||0);r.querySelector(".p-line-total").textContent=money(x,currency);return n+x},0);const disc=Math.min(subtotal,+$("#pDiscount").value||0);$("#purchaseTotal").textContent=money(Math.max(0,subtotal-disc)+(+$("#pCharges").value||0)+(+$("#pTax").value||0),currency);}
  $("#pAddLine").onclick=()=>addLine();["pDiscount","pCharges","pTax"].forEach(id=>$("#"+id).oninput=updateTotal);$("#pCurrency").onchange=updateTotal;
  $("#pAddProduct").onclick=()=>openQuickProduct(newId=>{lineList.querySelectorAll(".p-line-product").forEach(sel=>{const current=sel.value;sel.innerHTML=productOpts(current)});addLine({productId:newId})});
  $("#addSupplierInline").onclick=()=>openSupplierQuick(id=>$("#pSupplier").value=id);
  if(sourceOrder){sourceOrder.items.forEach(item=>addLine(item));}else addLine();
  if(isInvoice&&$("#pSupplier"))$("#pSupplier").disabled=!!sourceOrder;
  if(isInvoice&&$("#pSourceOrder"))$("#pSourceOrder").onchange=()=>{const order=state.purchaseOrders.find(x=>x.id===$("#pSourceOrder").value);selectedOrder=order||null;$("#pSupplier").disabled=!!order;if(!order){lineList.innerHTML="";addLine();$("#pDiscount").value=0;$("#pCharges").value=0;$("#pTax").value=0;$("#pNote").value="";updateTotal();return}$("#pSupplier").value=order.supplierId||"";lineList.innerHTML="";order.items.forEach(item=>addLine({...item,cost:item.cost??item.price}));$("#pDiscount").value=order.discount||0;$("#pCharges").value=order.otherCharges||0;$("#pTax").value=order.tax||0;$("#pNote").value=order.note||"";updateTotal();};
  $("#savePurchase").onclick=()=>{
    const supplier=state.suppliers.find(x=>x.id===$("#pSupplier").value);if(!supplier)return toast("Select or add a supplier.");
    const items=[...lineList.querySelectorAll(".purchase-line")].map(r=>({lineId:r.dataset.lineId,productId:r.querySelector(".p-line-product").value,qty:+r.querySelector(".p-line-qty").value||0,cost:+r.querySelector(".p-line-cost").value||0,receivedQty:Number((selectedOrder?.items||[]).find(x=>x.lineId===r.dataset.lineId)?.receivedQty||0)})).filter(x=>x.productId&&x.qty>0);
    if(!items.length)return toast("Add at least one item.");
    const subtotal=items.reduce((n,x)=>n+x.qty*x.cost,0),discount=Math.min(subtotal,+$("#pDiscount").value||0),charges=+$("#pCharges").value||0,tax=+$("#pTax").value||0;
    const doc={id:uid(isInvoice?"purchase_invoice":"purchase_order"),number:nextOperationalNumber(isInvoice?"purchaseInvoice":"purchaseOrder"),date:$("#pDate").value||today(),dueDate:isInvoice?$("#pDueDate").value:"",currency:$("#pCurrency").value||"GHS",reference:$("#pReference").value.trim(),items,subtotal:round2(subtotal),discount:round2(discount),otherCharges:round2(charges),tax:round2(tax),total:round2(Math.max(0,subtotal-discount)+charges+tax),note:$("#pNote").value.trim(),...supplierSnapshot(supplier)};
    if(isInvoice){doc.paid=0;doc.status="Unpaid";doc.sourceOrderId=$("#pSourceOrder")?.value||"";doc.received=items.every(x=>Number(x.receivedQty||0)>=x.qty);doc.receiptStatus=doc.received?"Received":items.some(x=>Number(x.receivedQty||0)>0)?"Partially received":"Awaiting goods";mutate(()=>{state.purchaseInvoices.push(doc);const order=state.purchaseOrders.find(x=>x.id===doc.sourceOrderId);if(order){order.status=order.items.every(x=>Number(x.receivedQty||0)>=x.qty)?"Received":order.items.some(x=>Number(x.receivedQty||0)>0)?"Partially received":"Invoiced";}});}
    else{doc.status="Ordered";doc.instructions=$("#pInstructions").value.trim();doc.items=items.map(x=>({...x,receivedQty:0}));mutate(()=>state.purchaseOrders.push(doc));}
    closeModal();notifyEditorTabSaved();toast(`${doc.number} saved.`);
  };
}
function recordPurchasePayment(id){
  const p=state.purchaseInvoices.find(x=>x.id===id);if(!p)return;const balance=Math.max(0,Number(p.total||0)-Number(p.paid||0));if(!balance)return toast("This purchase invoice is fully paid.");
  modal(`<div class="modal-head"><h3>Pay supplier invoice ${esc(p.number)}</h3><button class="close" data-close-modal>×</button></div><div class="form-stack"><label>Outstanding balance<input class="input" value="${money(balance,p.currency||state.settings.currency)}" readonly></label><label>Payment amount<input id="purchasePayAmount" class="input" type="number" min="0" max="${balance}" step=".01" value="${balance}"></label><label>Payment method<select id="purchasePayMethod" class="input">${paymentMethodOptions()}</select></label><label>Payment date<input id="purchasePayDate" class="input" type="date" value="${today()}"></label></div><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="savePurchasePayment">Record payment</button></div>`);
  $("#savePurchasePayment").onclick=()=>{const amount=round2(Math.min(balance,Math.max(0,+$("#purchasePayAmount").value||0))),method=$("#purchasePayMethod").value;if(!amount)return toast("Enter a payment amount.");mutate(()=>{p.paid=round2(Number(p.paid||0)+amount);p.status=p.paid>=p.total?"Paid":"Part-paid";state.transactions.push({id:uid("tx"),date:$("#purchasePayDate").value,type:"out",category:"Purchase",description:`Payment for ${p.number} — ${p.supplierName}`,amount,reference:p.number,paymentMethod:method,currency:p.currency||state.settings.currency})},"Recorded supplier payment",p.number,`${money(amount,p.currency||state.settings.currency)} · ${method}`);closeModal()};
}
function applyPurchaseReceipt(doc,item,qty){
  const product=state.products.find(p=>p.id===item.productId);if(!product)throw new Error("A product on this receipt no longer exists.");
  const oldQty=Number(product.qty||0),oldCost=Number(product.cost||0),cost=Number(item.cost||0),added=Number(qty||0);
  product.cost=oldQty+added?((oldQty*oldCost)+(added*cost))/(oldQty+added):cost;product.qty=oldQty+added;
  item.receivedQty=Number(item.receivedQty||0)+added;
  const order=doc.sourceOrderId?state.purchaseOrders.find(x=>x.id===doc.sourceOrderId):state.purchaseOrders.find(x=>x.items.some(i=>i.lineId===item.lineId));
  const partner=order||state.purchaseInvoices.find(x=>x.sourceOrderId===doc.id);
  const paired=partner&&partner!==doc?partner.items.find(x=>x.lineId===item.lineId):null;
  if(paired)paired.receivedQty=Number(paired.receivedQty||0)+added;
}
function syncPurchaseStatuses(doc){
  const fullyReceived=doc.items.every(x=>Number(x.receivedQty||0)>=Number(x.qty||0));doc.received=fullyReceived;doc.receiptStatus=fullyReceived?"Received":doc.items.some(x=>Number(x.receivedQty||0)>0)?"Partially received":"Awaiting goods";
  if(state.purchaseOrders.some(x=>x.id===doc.id))doc.status=fullyReceived?"Received":doc.items.some(x=>Number(x.receivedQty||0)>0)?"Partially received":"Ordered";
  if(doc.sourceOrderId){const order=state.purchaseOrders.find(x=>x.id===doc.sourceOrderId);if(order){const complete=order.items.every(x=>Number(x.receivedQty||0)>=Number(x.qty||0));order.status=complete?"Received":order.items.some(x=>Number(x.receivedQty||0)>0)?"Partially received":"Invoiced";}}
}
function openReceivePurchase(id){
  const doc=state.purchaseInvoices.find(x=>x.id===id);if(!doc)return;const pending=doc.items.reduce((n,x)=>n+Math.max(0,x.qty-Number(x.receivedQty||0)),0);if(!pending)return toast("All items on this purchase invoice have been received.");
  modal(`<div class="modal-head"><h3>Receive goods · ${esc(doc.number)}</h3><button class="close" data-close-modal>×</button></div><p class="muted">Enter quantities received. Inventory is updated and unit cost is included in weighted average stock cost.</p><div class="receive-list">${doc.items.map(x=>{const p=state.products.find(y=>y.id===x.productId);const remain=Math.max(0,x.qty-Number(x.receivedQty||0));return `<label class="receive-row"><span><strong>${esc(p?.name||"Product")}</strong><small>${Number(x.receivedQty||0)} of ${x.qty} received · ${remain} remaining</small></span><input class="input receive-qty" data-line-id="${esc(x.lineId)}" type="number" min="0" max="${remain}" value="${remain}" aria-label="Quantity received"></label>`}).join("")}</div><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="confirmPurchaseReceipt">Update stock</button></div>`);
  $("#confirmPurchaseReceipt").onclick=()=>{const entries=$$(".receive-qty").map(el=>({lineId:el.dataset.lineId,qty:Math.min(+el.max,+el.value||0)})).filter(x=>x.qty>0);if(!entries.length)return toast("Enter a quantity received.");mutate(()=>{entries.forEach(x=>{const item=doc.items.find(y=>y.lineId===x.lineId);applyPurchaseReceipt(doc,item,x.qty)});syncPurchaseStatuses(doc)});closeModal();toast("Received quantities added to stock.")};
}

function waybillSources(){return [
  ...state.invoices.map(x=>({kind:"invoice",doc:x,label:`Sales invoice ${x.number} · ${x.customerName}`})),
  ...state.purchaseInvoices.map(x=>({kind:"purchaseInvoice",doc:x,label:`Purchase invoice ${x.number} · ${x.supplierName}`})),
  ...state.purchaseOrders.map(x=>({kind:"purchaseOrder",doc:x,label:`Purchase order ${x.number} · ${x.supplierName}`}))
]}
function openWaybill(sourceType=null,sourceId=null){
  const sources=waybillSources(),preselected=sourceType&&sourceId?`${sourceType}:${sourceId}`:"";
  modal(`<div class="modal-head"><div><h3>Create Waybill</h3><small class="muted">Print a dispatch note or goods-received record. Stock updates when the waybill is completed.</small></div><button class="close" data-close-modal>×</button></div>
    <div class="two-col"><label>Based on document<select id="wSource" class="input"><option value="">Standalone waybill</option>${sources.map(x=>`<option value="${x.kind}:${x.doc.id}" ${preselected===`${x.kind}:${x.doc.id}`?"selected":""}>${esc(x.label)}</option>`).join("")}</select></label><label>Movement<select id="wDirection" class="input"><option value="outgoing">Outgoing / dispatch</option><option value="incoming">Incoming / received</option></select></label></div>
    <div class="two-col" style="margin-top:12px"><label>From / To<input id="wParty" class="input" placeholder="Customer or supplier"></label><label>Waybill date<input id="wDate" type="date" class="input" value="${today()}"></label><label>Carrier / driver<input id="wCarrier" class="input"></label><label>Vehicle / tracking reference<input id="wReference" class="input"></label></div>
    <div class="panel-head" style="margin-top:16px"><h3>Goods</h3><div class="actions"><button class="btn btn-outline" id="wAddProduct">+ New product</button><button class="btn btn-outline" id="wAddLine">+ Add item</button></div></div><div id="waybillLines" class="purchase-lines"></div>
    <label class="block-label" style="display:block;margin-top:12px">Delivery / handling notes<textarea id="wNote" class="input" rows="2"></textarea></label><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="saveWaybill">Save waybill</button></div>`);
  const lineList=$("#waybillLines");
  const productOpts=(selected="")=>`<option value="">Select product…</option>${state.products.map(p=>`<option value="${p.id}" ${p.id===selected?"selected":""}>${esc(p.name)} · ${esc(p.sku||"")}</option>`).join("")}`;
  const addLine=(item={})=>{const row=document.createElement("div");row.className="purchase-line waybill-line";row.dataset.sourceItemId=item.sourceItemId||item.lineId||"";row.innerHTML=`<select class="input w-line-product" ${row.dataset.sourceItemId?"disabled":""}>${productOpts(item.productId||"")}</select><input class="input w-line-qty" type="number" min="1" step="1" value="${Number(item.qty||1)}" aria-label="Waybill quantity"><span>${row.dataset.sourceItemId?"Linked":"Manual"}</span><button type="button" class="icon-btn remove-purchase-line">×</button>`;lineList.append(row);row.querySelector(".remove-purchase-line").onclick=()=>row.remove()};
  const loadSource=()=>{const [kind,id]=($("#wSource").value||"").split(":");const source=sources.find(x=>x.kind===kind&&x.doc.id===id);if(!source)return;
    const doc=source.doc, incoming=kind!=="invoice";$("#wDirection").value=incoming?"incoming":"outgoing";$("#wParty").value=incoming?(doc.supplierName||""):(doc.customerName||"");$("#wNote").value=`Against ${doc.number}`;lineList.innerHTML="";
    doc.items.forEach(x=>{const pending=Math.max(0,Number(x.qty||0)-Number(incoming?x.receivedQty||0:x.deliveredQty||0));if(pending)addLine({productId:x.productId,qty:pending,sourceItemId:x.lineId});});
    if(!lineList.children.length)toast("No outstanding quantities remain on this document.");
    $("#wDirection").disabled=true;$("#wAddLine").disabled=true;$("#wAddProduct").disabled=true;
  };
  $("#wSource").onchange=()=>{if($("#wSource").value){loadSource();return}$("#wDirection").disabled=false;$("#wAddLine").disabled=false;$("#wAddProduct").disabled=false;lineList.innerHTML="";$("#wParty").value="";$("#wNote").value="";addLine()};$("#wAddLine").onclick=()=>addLine();
  $("#wAddProduct").onclick=()=>openQuickProduct(newId=>{lineList.querySelectorAll(".w-line-product").forEach(sel=>{const current=sel.value;sel.innerHTML=productOpts(current)});addLine({productId:newId})});
  if(preselected)loadSource();else addLine();
  $("#saveWaybill").onclick=()=>{
    const direction=$("#wDirection").value,party=$("#wParty").value.trim();if(!party)return toast("Enter the customer or supplier name.");
    const items=[...lineList.querySelectorAll(".waybill-line")].map(r=>({productId:r.querySelector(".w-line-product").value,qty:+r.querySelector(".w-line-qty").value||0,handledQty:0,sourceItemId:r.dataset.sourceItemId||""})).filter(x=>x.productId&&x.qty>0);if(!items.length)return toast("Add at least one item to the waybill.");
    const [kind,id]=($("#wSource").value||"").split(":"),source=sources.find(x=>x.kind===kind&&x.doc.id===id);
    const wb={id:uid("waybill"),number:nextOperationalNumber("waybill"),date:$("#wDate").value||today(),direction,partyName:party,carrier:$("#wCarrier").value.trim(),reference:$("#wReference").value.trim(),note:$("#wNote").value.trim(),sourceType:source?.kind||"",sourceId:source?.doc.id||"",sourceNumber:source?.doc.number||"",items,status:"Prepared"};
    mutate(()=>state.waybills.push(wb));closeModal();toast(`${wb.number} saved.`);
  };
}
function completeWaybill(id){
  const wb=state.waybills.find(x=>x.id===id);if(!wb||wb.status==="Completed")return;
  const remaining=wb.items.reduce((n,x)=>n+Math.max(0,x.qty-Number(x.handledQty||0)),0);if(!remaining)return toast("All waybill quantities have been completed.");
  modal(`<div class="modal-head"><h3>${wb.direction==="incoming"?"Receive goods":"Confirm dispatch"} · ${esc(wb.number)}</h3><button class="close" data-close-modal>×</button></div><div class="receive-list">${wb.items.map(x=>{const p=state.products.find(y=>y.id===x.productId),left=Math.max(0,x.qty-Number(x.handledQty||0));return `<label class="receive-row"><span><strong>${esc(p?.name||"Product")}</strong><small>${Number(x.handledQty||0)} of ${x.qty} completed · ${left} remaining</small></span><input class="input waybill-qty" data-index="${wb.items.indexOf(x)}" type="number" min="0" max="${left}" value="${left}" aria-label="Quantity completed"></label>`}).join("")}</div><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="saveWaybillCompletion">Save quantities</button></div>`);
  $("#saveWaybillCompletion").onclick=()=>{
    const entries=$$(".waybill-qty").map(el=>({index:+el.dataset.index,qty:Math.min(+el.max,+el.value||0)})).filter(x=>x.qty>0);if(!entries.length)return toast("Enter at least one quantity.");
    const source=wb.sourceType==="invoice"?state.invoices.find(x=>x.id===wb.sourceId):wb.sourceType==="purchaseInvoice"?state.purchaseInvoices.find(x=>x.id===wb.sourceId):wb.sourceType==="purchaseOrder"?state.purchaseOrders.find(x=>x.id===wb.sourceId):null;
    const outgoingTotals={};
    for(const {index,qty} of entries){const line=wb.items[index],product=state.products.find(p=>p.id===line.productId);if(!product)return toast("A waybill product no longer exists.");
      const sourceLine=source?.items.find(x=>x.lineId===line.sourceItemId);
      if(wb.direction==="incoming"&&sourceLine&&qty>Number(sourceLine.qty||0)-Number(sourceLine.receivedQty||0))return toast("Received quantity now exceeds the remaining supplier order quantity.");
      if(wb.direction==="outgoing"&&sourceLine&&qty>Number(sourceLine.qty||0)-Number(sourceLine.deliveredQty||0))return toast("Dispatch quantity now exceeds the remaining invoice quantity.");
      if(wb.direction==="outgoing")outgoingTotals[line.productId]=(outgoingTotals[line.productId]||0)+qty;
    }
    if(wb.direction==="outgoing"&&!(source&&source.stockDeductedAtInvoice))for(const [productId,qty] of Object.entries(outgoingTotals)){const available=availableQty(productId,wb.sourceType==="invoice"?wb.sourceId:"");if(qty>available){const product=state.products.find(p=>p.id===productId);return toast(`Only ${available} units of ${product?.name||"this product"} are available for dispatch.`)}}
    try{mutate(()=>{
      entries.forEach(({index,qty})=>{const line=wb.items[index],product=state.products.find(p=>p.id===line.productId),sourceLine=source?.items.find(x=>x.lineId===line.sourceItemId);
        if(wb.direction==="incoming"){
          if(sourceLine)applyPurchaseReceipt(source,sourceLine,qty);
          else{const incoming={lineId:uid("receipt"),productId:line.productId,cost:Number(product.cost||0)};applyPurchaseReceipt({items:[]},incoming,qty)}
        }else{
          if(sourceLine)sourceLine.deliveredQty=Number(sourceLine.deliveredQty||0)+qty;
          if(!(source&&source.stockDeductedAtInvoice))product.qty-=qty;
        }
        line.handledQty=Number(line.handledQty||0)+qty;
      });
      if(source&&wb.direction==="incoming"){
        syncPurchaseStatuses(source);
        if(wb.sourceType==="purchaseOrder")state.purchaseInvoices.filter(x=>x.sourceOrderId===source.id).forEach(syncPurchaseStatuses);
      }
      if(source&&wb.direction==="outgoing"){
        const delivered=source.items.every(x=>Number(x.deliveredQty||0)>=Number(x.qty||0));source.delivered=delivered;source.stockDeducted=source.stockDeductedAtInvoice?true:delivered;source.reserved=!source.stockDeductedAtInvoice&&!delivered&&Number(source.paid||0)>0;source.status=delivered?(Number(source.paid||0)>=Number(source.total||0)?"Paid":"Delivered"):"Partially delivered";
      }
      wb.status=wb.items.every(x=>Number(x.handledQty||0)>=Number(x.qty||0))?"Completed":"Partially completed";
    });closeModal();toast(wb.status==="Completed"?"Waybill completed; stock updated.":"Waybill quantities updated.");}catch(e){toast(e.message)}
  };
}

function openCash(){
  modal(`<div class="modal-head"><h3>Record Cash Transaction</h3><button class="close" data-close-modal>×</button></div>
  <div class="form-stack"><label>Date<input id="tDate" type="date" class="input" value="${today()}"></label><label>Type<select id="tType" class="input"><option value="in">Cash in</option><option value="out">Cash out</option></select></label><label>Category<input id="tCat" class="input" placeholder="e.g. Purchase, Transport, Utilities"></label><label>Description<input id="tDesc" class="input"></label><label>Amount<input id="tAmount" type="number" min="0" step=".01" class="input"></label><label>Currency<select id="tCurrency" class="input">${["GHS","USD","EUR","NGN"].map(c=>`<option value="${c}" ${c===(state.settings.currency||"GHS")?"selected":""}>${c}</option>`).join("")}</select></label><label>Payment method<select id="tPaymentMethod" class="input">${paymentMethodOptions()}</select></label><label>Reference<input id="tRef" class="input"></label></div>
  <div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="saveCashBtn">Save Transaction</button></div>`);
  $("#saveCashBtn").onclick=()=>{const a=round2(+$("#tAmount").value||0);if(a<=0)return toast("Enter an amount.");const currency=$("#tCurrency").value||"GHS",reference=$("#tRef").value.trim(),category=$("#tCat").value.trim();mutate(()=>state.transactions.push({id:uid("tx"),date:$("#tDate").value,type:$("#tType").value,category,description:$("#tDesc").value.trim(),amount:a,reference,paymentMethod:$("#tPaymentMethod").value,currency}),"Recorded cash transaction",reference||category,`${$("#tType").value==="in"?"Cash in":"Cash out"} · ${money(a,currency)}`);closeModal()};
}
function deleteCash(id){
  const t=state.transactions.find(x=>x.id===id); if(!t)return;
  if(t.reference && state.invoices.some(i=>i.number===t.reference)){toast("This transaction is linked to an invoice. Manage it from the invoice payment history.","error");return}
  if(t.reference && state.purchaseInvoices.some(i=>i.number===t.reference)){toast("This transaction is linked to a supplier invoice. Manage it from the purchase invoice.","error");return}
  confirmAction({title:"Archive this transaction?",message:"It will be hidden from active cash reports while the transaction record is retained in your history.",confirmLabel:"Archive transaction",onConfirm:()=>mutate(()=>t.deletedAt=new Date().toISOString(),"Archived cash transaction",t.reference||t.id,t.category||"")});
}
function openCustomer(id=null,onSaved=null){
  const c=id?state.customers.find(x=>x.id===id):null;
  modal(`<div class="modal-head"><h3>${c?"Edit":"Add"} Customer</h3><button class="close" data-close-modal>×</button></div><div class="form-grid"><label>Customer / Company name<input id="cName" class="input" value="${esc(c?.name||"")}" placeholder="Required"></label><label>Contact person<input id="cContact" class="input" value="${esc(c?.contactPerson||"")}"></label><label>Phone<input id="cPhone" class="input" value="${esc(c?.phone||"")}"></label><label>Email<input id="cEmail" class="input" value="${esc(c?.email||"")}"></label><label>Tax ID / VAT number<input id="cTaxId" class="input" value="${esc(c?.taxId||"")}"></label><label>Credit limit<input id="cCreditLimit" type="number" min="0" step=".01" class="input" value="${Number(c?.creditLimit||0)}"></label><label>Billing address<textarea id="cBilling" class="input" rows="3">${esc(c?.billingAddress||c?.address||"")}</textarea></label><label>Shipping address<textarea id="cShipping" class="input" rows="3">${esc(c?.shippingAddress||"")}</textarea></label><label>Customer notes<textarea id="cNotes" class="input" rows="3">${esc(c?.notes||"")}</textarea></label></div><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="saveCustomerBtn">Save Customer</button></div>`);
  $("#saveCustomerBtn").onclick=()=>{const obj={id:c?.id||uid("cust"),name:$("#cName").value.trim(),contactPerson:$("#cContact").value.trim(),phone:$("#cPhone").value.trim(),email:$("#cEmail").value.trim(),taxId:$("#cTaxId").value.trim(),creditLimit:round2(+$("#cCreditLimit").value||0),billingAddress:$("#cBilling").value.trim(),shippingAddress:$("#cShipping").value.trim(),address:$("#cBilling").value.trim(),notes:$("#cNotes").value.trim()};if(!obj.name)return toast("Customer name is required.");mutate(()=>{if(c)Object.assign(c,obj);else state.customers.push(obj)},c?"Updated customer":"Created customer",obj.name,obj.phone||obj.email||"");closeModal();if(onSaved)onSaved(obj.id)};
}
function openCustomerQuick(onSaved){
  const wrap=document.createElement("div");wrap.className="submodal";wrap.innerHTML=`<div class="submodal-card"><div class="modal-head"><h3>Add Customer</h3><button class="close" id="closeQuickCustomer">×</button></div><div class="form-grid"><label>Customer / Company name<input id="qcName" class="input" placeholder="Required"></label><label>Contact person<input id="qcContact" class="input"></label><label>Phone<input id="qcPhone" class="input"></label><label>Email<input id="qcEmail" class="input"></label><label>Tax ID<input id="qcTax" class="input"></label><label>Billing address<textarea id="qcBilling" class="input" rows="2"></textarea></label></div><div class="modal-footer"><button class="btn btn-outline" id="cancelQuickCustomer">Cancel</button><button class="btn btn-primary" id="saveQuickCustomer">Save customer</button></div></div>`;$("#modalCard").appendChild(wrap);
  const close=()=>wrap.remove();$("#closeQuickCustomer").onclick=close;$("#cancelQuickCustomer").onclick=close;
  $("#saveQuickCustomer").onclick=()=>{const item={id:uid("cust"),name:$("#qcName").value.trim(),contactPerson:$("#qcContact").value.trim(),phone:$("#qcPhone").value.trim(),email:$("#qcEmail").value.trim(),taxId:$("#qcTax").value.trim(),billingAddress:$("#qcBilling").value.trim(),shippingAddress:"",address:$("#qcBilling").value.trim(),notes:""};if(!item.name)return toast("Customer name is required.");mutate(()=>state.customers.push(item));const select=$("#sCustomer");if(select){select.insertAdjacentHTML("beforeend",`<option value="${item.id}">${esc(item.name)}</option>`);select.value=item.id}close();onSaved&&onSaved(item.id)};
}
function deleteCustomer(id){
  const c=state.customers.find(x=>x.id===id); if(!c)return;
  const linked=allDocuments().filter(d=>d.customerId===id);
  confirmAction({title:`Archive ${c.name}?`,message:linked.length?`This customer has ${linked.length} linked document(s). The customer will be hidden from active lists, and the linked sales history will remain available.`:"This customer will be hidden from active lists. The record will be retained.",confirmLabel:"Archive customer",onConfirm:()=>mutate(()=>c.deletedAt=new Date().toISOString(),"Archived customer",c.name,`${linked.length} linked documents`)});
}
function deleteDocument(type,id){
  const collection=type==="Invoice"?state.invoices:type==="Estimate"?state.estimates:state.proformas;
  const d=collection.find(x=>x.id===id); if(!d)return;
  if(type==="Invoice"){toast("Invoices are never deleted. Use Void invoice and add a reason to preserve the financial history.");return;}
  confirmAction({title:`Archive ${d.number}?`,message:"This document will be hidden from active lists and retained in your Drive history.",confirmLabel:"Archive document",onConfirm:()=>mutate(()=>d.deletedAt=new Date().toISOString(),"Archived sales document",d.number,d.docType||type)});
}
function printInvoice(id,receipt){const latest=receipt?state.receipts.filter(x=>x.invoiceId===id).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")))[0]:null;return printDocument(id,receipt,latest)}
function findDocument(id){return state.invoices.find(x=>x.id===id)||state.estimates.find(x=>x.id===id)||state.proformas.find(x=>x.id===id)}
async function waitForPrintAssets(){
  document.querySelectorAll("#printArea .modern-document").forEach(doc=>{if(!doc.querySelector(".print-logo-watermark"))doc.insertAdjacentHTML("afterbegin",printLogoWatermark())});
  const images=[...document.querySelectorAll("#printArea img")];
  await Promise.all(images.map(img=>new Promise(resolve=>{
    if(img.complete && img.naturalWidth>0){resolve();return}
    const done=()=>{img.removeEventListener("load",done);img.removeEventListener("error",done);resolve()};
    img.addEventListener("load",done,{once:true});img.addEventListener("error",done,{once:true});
  })));
  if(document.fonts?.ready) try{await document.fonts.ready}catch(e){}
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
}
async function printDocument(id,receipt=false,receiptRecord=null){
  const i=findDocument(id);if(!i)return;const s=state.settings;
  const isInvoice=state.invoices.some(x=>x.id===id),isEstimate=state.estimates.some(x=>x.id===id);
  const type=isInvoice?"SALES INVOICE":isEstimate?"QUOTATION / ESTIMATE":"PROFORMA INVOICE";
  const currency=i.currency||s.currency||"GHS",receiptAmount=Number(receiptRecord?.amount??i.paid??0),receiptBalance=Number(receiptRecord?.balanceAfter??invoiceBalance(i));
  const validUntil=i.validUntil || ((!isInvoice) ? addDays(i.date || today(), Number(s.documentValidityDays||7)) : "");
  const rows=i.items.map((x,index)=>{const p=state.products.find(p=>p.id===x.productId),description=x.description||p?.description||"";return `<tr><td class="print-line-no">${String(index+1).padStart(2,"0")}</td><td><strong>${esc(x.itemName||x.name||p?.name||"Item")}</strong>${description?`<small class="item-description">${esc(description)}</small>`:""}</td><td class="num">${x.qty}</td><td class="num">${money(x.price,currency)}</td><td class="num"><strong>${money(x.qty*x.price,currency)}</strong></td></tr>`}).join("");
  const customerAddress=i.customerBillingAddress||"",shipping=i.customerShippingAddress||"";
  const taxes=(i.taxEnabled===false||s.taxEnabled===false?[]:(i.taxLines||taxBreakdown(documentTaxBase(i),s.taxCategories))).map(t=>`<div><span>${esc(t.name)} (${t.rate}%)</span><strong>${money(t.amount,currency)}</strong></div>`).join("");
  const paid=Number(i.paid||0),balance=invoiceBalance(i),reserved=!i.delivered&&!i.stockDeducted&&paid>0,status=isInvoice?effectiveInvoiceStatus(i):effectiveSalesDocStatus(i);
  const printStatus=receipt?(receiptBalance<=0?"PAID":"PAYMENT RECEIVED"):isInvoice?String(status||"DRAFT").toUpperCase():"";
  $("#printArea").innerHTML=`<div class="print-document modern-document ${receipt?"receipt-document":""}">
    ${isInvoice&&!receipt&&["Paid","Overdue"].includes(status)?`<div class="print-watermark ${status.toLowerCase()}">${esc(status.toUpperCase())}</div>`:""}
    <div class="modern-print-head"><div class="modern-company"><img src="${businessLogoSource()}" alt="${esc(s.name)}"><div><span class="modern-location">ACCRA · GHANA</span><h1>${esc(s.name)}</h1><p>${esc(s.address||"")}</p><p>${esc(s.phone||"")}${s.email?` · ${esc(s.email)}`:""}</p><p>${s.companyReg?`Reg. ${esc(s.companyReg)}`:""}${s.tax?` · TIN ${esc(s.tax)}`:""}</p></div></div><div class="modern-doc-ref"><span>${receipt?"PAYMENT RECEIPT":type}</span><strong>${esc(receiptRecord?.number||i.number)}</strong>${printStatus?`<em class="modern-status">${esc(printStatus)}</em>`:""}<div class="modern-doc-dates"><span><small>ISSUED</small><strong>${esc(receiptRecord?.date||i.date||"")}</strong></span>${isInvoice&&i.dueDate&&!receipt?`<span><small>DUE DATE</small><strong>${esc(i.dueDate)}</strong></span>`:validUntil?`<span><small>VALID UNTIL</small><strong>${esc(validUntil)}</strong></span>`:""}</div></div></div>
    <div class="modern-accent"></div>
    <div class="modern-address-grid"><div class="modern-address"><span class="print-eyebrow">${isInvoice?"BILL TO":"PREPARED FOR"}</span><strong>${esc(i.customerName||"Customer not specified")}</strong>${i.customerContactPerson?`<span>${esc(i.customerContactPerson)}</span>`:""}${customerAddress?`<span>${esc(customerAddress)}</span>`:""}${i.customerPhone?`<span>${esc(i.customerPhone)}</span>`:""}${i.customerEmail?`<span>${esc(i.customerEmail)}</span>`:""}${i.customerTaxId?`<span>TIN: ${esc(i.customerTaxId)}</span>`:""}</div><div class="modern-address"><span class="print-eyebrow">${shipping?"DELIVER TO":"DOCUMENT DETAILS"}</span>${shipping?`<strong>${esc(i.customerName||"")}</strong><span>${esc(shipping)}</span>`:`<strong>${esc(isInvoice?status:(reserved?"Reserved for delivery":type))}</strong>`}${isInvoice?receipt?`<span>Invoice: ${esc(i.number)}</span><span>Payment method: ${esc(displayPaymentMethod(receiptRecord?.paymentMethod))}</span><span>Amount received: ${money(receiptAmount,currency)}</span><span>Balance after payment: ${money(receiptBalance,currency)}</span>`:`<span>Amount paid: ${money(paid,currency)}</span><span>Balance due: ${money(balance,currency)}</span>`:""}${i.sourceDocumentNumber?`<span>Based on ${esc(i.sourceDocumentNumber)}</span>`:""}</div></div>
    ${!receipt&&i.purpose?`<div class="document-purpose"><strong>PROPOSAL / PROJECT SUMMARY</strong><p>${esc(i.purpose)}</p></div>`:""}
    <table class="print-table modern-table"><thead><tr><th>#</th><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody>${rows||`<tr><td colspan="5">No line items</td></tr>`}</tbody></table>
    <div class="modern-summary"><div class="print-total modern-total"><div><span>Subtotal</span><strong>${money(i.subtotal,currency)}</strong></div>${Number(i.discount||0)>0?`<div><span>Discount</span><strong>− ${money(i.discount,currency)}</strong></div>`:""}${Number(i.deliveryCharge||0)?`<div><span>Delivery</span><strong>${money(i.deliveryCharge,currency)}</strong></div>`:""}${Number(i.laborCharge||0)?`<div><span>Installation / labour</span><strong>${money(i.laborCharge,currency)}</strong></div>`:""}${taxes}<div class="grand"><span>${receipt?"AMOUNT RECEIVED":"TOTAL DUE"}</span><strong>${money(receipt?receiptAmount:i.total,currency)}</strong></div>${isInvoice&&!receipt?`<div class="balance-row"><span>Amount paid</span><strong>${money(paid,currency)}</strong></div><div class="balance-row"><span>Balance due</span><strong>${money(balance,currency)}</strong></div>`:""}</div><div class="modern-terms">${s.paymentTerms?`<div class="print-note"><strong>Payment terms</strong><div>${esc(s.paymentTerms)}</div></div>`:""}${s.salesContract?`<div class="print-note"><strong>Sales terms</strong><div>${esc(s.salesContract)}</div></div>`:""}${i.note?`<div class="print-note"><strong>Notes</strong><div>${esc(i.note)}</div></div>`:""}${s.bankDetails?`<div class="print-note"><strong>Payment details</strong><div>${esc(s.bankDetails)}</div></div>`:""}</div></div>
    <div class="print-sign"><div>Prepared by <span></span></div><div>Customer acknowledgement <span></span></div></div>
    <div class="print-footer"><span>${esc(s.footer||"Thank you for your business.")}</span><span>${esc(s.name)} · Accra, Ghana · ${esc(receiptRecord?.number||i.number)}</span></div>
  </div>`;
  await waitForPrintAssets();
  window.print();
}
function printReceipt(id){const receipt=state.receipts.find(x=>x.id===id);if(!receipt)return;return printDocument(receipt.invoiceId,true,receipt)}
async function printCreditNote(id){const note=state.creditNotes.find(x=>x.id===id);if(!note)return;const s=state.settings,currency=note.currency||s.currency||"GHS";$("#printArea").innerHTML=`<div class="print-document modern-document"><div class="modern-print-head"><div class="modern-company"><img src="${businessLogoSource()}"><div><h1>${esc(s.name)}</h1><p>${esc(s.address||"")}</p><p>${esc(s.phone||"")}${s.email?` · ${esc(s.email)}`:""}</p><p>${s.tax?`Tax ID ${esc(s.tax)}`:""}</p></div></div><div class="modern-doc-ref"><span>CREDIT NOTE</span><strong>${esc(note.number)}</strong><small>${esc(note.date)} · Against ${esc(note.invoiceNumber)}</small></div></div><div class="modern-accent"></div><div class="modern-address-grid"><div class="modern-address"><span class="print-eyebrow">ISSUED TO</span><strong>${esc(note.customerName)}</strong></div><div class="modern-address"><span class="print-eyebrow">ADJUSTMENT DETAILS</span><strong>${esc(note.reason)}</strong><span>Original invoice: ${esc(note.invoiceNumber)}</span></div></div><div class="print-total modern-total"><div class="grand"><span>CREDIT AMOUNT</span><strong>${money(note.amount,currency)}</strong></div></div><div class="print-note"><strong>Record note</strong><div>This credit note is retained as a financial adjustment against the original invoice.</div></div><div class="print-sign"><div>Authorized by <span></span></div><div>Customer acknowledgement <span></span></div></div><div class="print-footer"><span>${esc(s.footer)}</span><span>${esc(s.name)} · ${esc(note.number)}</span></div></div>`;await waitForPrintAssets();window.print()}

async function printPurchase(kind,id){
  const invoice=kind==="invoice",doc=(invoice?state.purchaseInvoices:state.purchaseOrders).find(x=>x.id===id);if(!doc)return;const s=state.settings;
  const currency=doc.currency||"GHS",rows=doc.items.map((x,index)=>{const p=state.products.find(y=>y.id===x.productId);return `<tr><td class="print-line-no">${String(index+1).padStart(2,"0")}</td><td><strong>${esc(x.itemName||x.name||p?.name||"Item")}</strong>${x.description||p?.description?`<small class="item-description">${esc(x.description||p?.description)}</small>`:""}</td><td class="num">${x.qty}</td><td class="num">${money(x.cost,currency)}</td><td class="num">${money(x.qty*x.cost,currency)}</td></tr>`}).join("");
  const balance=Math.max(0,Number(doc.total||0)-Number(doc.paid||0));
  $("#printArea").innerHTML=`<div class="print-document modern-document"><div class="modern-print-head"><div class="modern-company"><img src="${businessLogoSource()}"><div><h1>${esc(s.name)}</h1><p>${esc(s.address||"")}</p><p>${esc(s.phone||"")}${s.email?` · ${esc(s.email)}`:""}</p></div></div><div class="modern-doc-ref"><span>${invoice?"PURCHASE INVOICE":"PURCHASE ORDER"}</span><strong>${esc(doc.number)}</strong><small>${invoice?`Supplier ref. ${esc(doc.reference||"—")}`:`Date ${esc(doc.date||"")}`}</small></div></div><div class="modern-accent"></div><div class="modern-address-grid"><div class="modern-address"><span class="print-eyebrow">SUPPLIER</span><strong>${esc(doc.supplierName||"Supplier")}</strong>${doc.supplierContactPerson?`<span>${esc(doc.supplierContactPerson)}</span>`:""}${doc.supplierAddress?`<span>${esc(doc.supplierAddress)}</span>`:""}${doc.supplierPhone?`<span>${esc(doc.supplierPhone)}</span>`:""}${doc.supplierEmail?`<span>${esc(doc.supplierEmail)}</span>`:""}${doc.supplierTaxId?`<span>Tax ID: ${esc(doc.supplierTaxId)}</span>`:""}</div><div class="modern-address"><span class="print-eyebrow">${invoice?"BILL DETAILS":"DELIVER TO"}</span><strong>${esc(s.name)}</strong><span>${esc(s.address||"")}</span><span>${invoice?`Invoice date: ${esc(doc.date||"")}`:`Expected: ${esc(doc.date||"")}`}</span>${invoice&&doc.dueDate?`<span>Due date: ${esc(doc.dueDate)}</span>`:""}${doc.status&&doc.status!=="Approved"?`<span>Status: ${esc(doc.status)}</span>`:""}${doc.sourceOrderId?`<span>Purchase order: ${esc(state.purchaseOrders.find(x=>x.id===doc.sourceOrderId)?.number||"")}</span>`:""}</div></div><table class="print-table modern-table"><thead><tr><th>#</th><th>Description</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="modern-summary"><div class="print-total modern-total"><div><span>Subtotal</span><strong>${money(doc.subtotal,currency)}</strong></div>${Number(doc.discount||0)>0?`<div><span>Discount</span><strong>− ${money(doc.discount,currency)}</strong></div>`:""}${Number(doc.otherCharges||0)?`<div><span>Other charges</span><strong>${money(doc.otherCharges,currency)}</strong></div>`:""}${Number(doc.tax||0)?`<div><span>Supplier tax / duty</span><strong>${money(doc.tax,currency)}</strong></div>`:""}<div class="grand"><span>${invoice?"INVOICE TOTAL":"ORDER TOTAL"}</span><strong>${money(doc.total,currency)}</strong></div>${invoice?`<div class="balance-row"><span>Paid</span><strong>${money(doc.paid||0,currency)}</strong></div><div class="balance-row"><span>Balance due</span><strong>${money(balance,currency)}</strong></div>`:""}</div><div class="modern-terms">${doc.note?`<div class="print-note"><strong>Notes</strong><div>${esc(doc.note)}</div></div>`:""}${doc.instructions?`<div class="print-note"><strong>Delivery instructions</strong><div>${esc(doc.instructions)}</div></div>`:""}</div></div><div class="print-sign"><div>Authorized by <span></span></div><div>Supplier acknowledgement <span></span></div></div><div class="print-footer"><span>${esc(s.footer)}</span><span>${esc(s.name)} · ${esc(doc.number)}</span></div></div>`;
  await waitForPrintAssets();window.print();
}
async function printWaybill(id){
  const wb=state.waybills.find(x=>x.id===id);if(!wb)return;const s=state.settings;
  const rows=wb.items.map((x,index)=>{const p=state.products.find(y=>y.id===x.productId);return `<tr><td class="print-line-no">${String(index+1).padStart(2,"0")}</td><td><strong>${esc(x.itemName||x.name||p?.name||"Item")}</strong>${x.description||p?.description?`<small class="item-description">${esc(x.description||p?.description)}</small>`:""}</td><td class="num">${x.qty}</td><td class="num">${Number(x.handledQty||0)}</td><td></td></tr>`}).join("");
  $("#printArea").innerHTML=`<div class="print-document modern-document"><div class="modern-print-head"><div class="modern-company"><img src="${businessLogoSource()}"><div><h1>${esc(s.name)}</h1><p>${esc(s.address||"")}</p><p>${esc(s.phone||"")}${s.email?` · ${esc(s.email)}`:""}</p></div></div><div class="modern-doc-ref"><span>${wb.direction==="incoming"?"GOODS RECEIVED NOTE":"DELIVERY WAYBILL"}</span><strong>${esc(wb.number)}</strong><small>${esc(wb.date||"")}</small></div></div><div class="modern-accent"></div><div class="modern-address-grid"><div class="modern-address"><span class="print-eyebrow">${wb.direction==="incoming"?"RECEIVED FROM":"DELIVER TO"}</span><strong>${esc(wb.partyName||"")}</strong><span>${esc(wb.carrier||"")}</span><span>${esc(wb.reference||"")}</span></div><div class="modern-address"><span class="print-eyebrow">WAYBILL DETAILS</span><strong>${esc(wb.status||"Prepared")}</strong><span>Source: ${esc(wb.sourceNumber||"Standalone")}</span>${wb.note?`<span>${esc(wb.note)}</span>`:""}</div></div><table class="print-table modern-table"><thead><tr><th>#</th><th>Goods description</th><th class="num">Qty planned</th><th class="num">Qty handled</th><th>Condition / remarks</th></tr></thead><tbody>${rows}</tbody></table><div class="waybill-signatures"><div>Dispatched / received by <span></span></div><div>Driver / carrier <span></span></div><div>Customer / storekeeper <span></span></div></div><div class="print-footer"><span>Please verify quantities and condition on receipt.</span><span>${esc(s.name)} · ${esc(wb.number)}</span></div></div>`;
  await waitForPrintAssets();window.print();
}


$("#connectDriveBtn").onclick=connectDrive;
window.addEventListener("online",()=>{if(driveReady){setDriveStatus("Sync pending…",true);retryDriveSync(true)}});
$("#setLogoFile").onchange=()=>{const file=$("#setLogoFile").files?.[0];if(!file)return;if(!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>1024*1024){toast("Choose a PNG, JPG or WebP image up to 1 MB.");$("#setLogoFile").value="";return}const reader=new FileReader();reader.onload=()=>{const data=String(reader.result||"");mutate(()=>state.settings.logoData=data,"Updated business logo",file.name,"Logo embedded in the Drive workspace");toast("Business logo saved.")};reader.readAsDataURL(file)};
$("#syncBtn").onclick=()=>retryDriveSync();
$("#signOutBtn").onclick=()=>{const t=gapi.client.getToken();if(t)google.accounts.oauth2.revoke(t.access_token);gapi.client.setToken("");driveReady=false;driveWorkspaceLoaded=false;driveFileId=null;driveFolderId=null;setDriveStatus("Offline");showAuth()};
$$("[data-open-product]").forEach(b=>b.onclick=()=>openProduct());
$$("[data-open-sale]").forEach(b=>b.onclick=()=>openSale());
$$('[data-open-invoice]').forEach(b=>b.onclick=()=>openSale(null,false,"invoice"));
$$("[data-open-cash]").forEach(b=>b.onclick=()=>openCash());
$$("[data-open-customer]").forEach(b=>b.onclick=()=>openCustomer());
$("#saveSettingsBtn").onclick=()=>{mutate(()=>Object.assign(state.settings,{name:$("#setName").value.trim()||"EliteVolt Systems",phone:$("#setPhone").value.trim(),email:$("#setEmail").value.trim(),address:$("#setAddress").value.trim(),tax:$("#setTax").value.trim(),prefix:$("#setPrefix").value.trim()||"EVS",currency:$("#setCurrency").value||"GHS",role:$("#setRole").value,footer:$("#setFooter").value.trim(),companyReg:$("#setCompanyReg").value.trim(),taxCategories:$("#setTaxCategories").value.trim(),defaultTaxRate:+$("#setDefaultTaxRate").value||0,salesContract:$("#setSalesContract").value.trim(),documentNotes:$("#setDocumentNotes").value.trim(),paymentTerms:$("#setPaymentTerms").value.trim(),bankDetails:$("#setBankDetails").value.trim(),documentValidityDays:Math.max(1,+$("#setValidityDays").value||7),taxEnabled:$("#setTaxEnabled").checked}),"Updated business settings",state.settings.name,`${state.settings.currency} · ${state.settings.role}`);toast("Settings saved.")};
$("#exportCustomersBtn").onclick=exportCustomersCSV;$("#importCustomersBtn").onclick=()=>$("#customerCsvInput").click();$("#customerCsvInput").onchange=e=>{const file=e.target.files?.[0];if(file)importCustomersCSV(file);e.target.value=""};
$("#exportReportsBtn").onclick=exportReportsCSV;$("#exportAuditBtn").onclick=exportAuditCSV;$("#applyReportRange").onclick=renderAll;
$("#loadDemoDataBtn").onclick=loadDemoData;
$("#reportFrom").value=`${new Date().getFullYear()}-01-01`;$("#reportTo").value=today();
$("#manualBackupBtn").onclick=()=>retryDriveSync();
$("#printReportBtn").onclick=()=>{
  const s=state.settings,currency=s.currency||"GHS",from=$("#reportFrom").value||"0000-01-01",to=$("#reportTo").value||today(),invoices=state.invoices.filter(i=>!i.deletedAt&&!i.voidedAt&&i.status!=="Void"&&i.date>=from&&i.date<=to&&(i.currency||currency)===currency),expenses=state.expenses.filter(x=>!x.deletedAt&&x.date>=from&&x.date<=to&&(x.currency||currency)===currency),purchases=state.purchaseInvoices.filter(x=>!x.deletedAt&&x.date>=from&&x.date<=to&&(x.currency||currency)===currency),sales=invoices.reduce((n,x)=>n+Number(x.total||0),0),paid=invoices.reduce((n,x)=>n+Number(x.paid||0),0),expenseTotal=expenses.reduce((n,x)=>n+Number(x.amount||0),0),purchaseTotal=purchases.reduce((n,x)=>n+Number(x.total||0),0),rows=[...invoices.map(x=>`<tr><td>${esc(x.date||"")}</td><td>Sales invoice</td><td>${esc(x.number)}</td><td>${esc(x.customerName||"")}</td><td>${esc(effectiveInvoiceStatus(x))}</td><td class="num">${money(x.total,currency)}</td></tr>`),...purchases.map(x=>`<tr><td>${esc(x.date||"")}</td><td>Supplier invoice</td><td>${esc(x.number)}</td><td>${esc(x.supplierName||"")}</td><td>${esc(x.status||"")}</td><td class="num">${money(x.total,currency)}</td></tr>`),...expenses.map(x=>`<tr><td>${esc(x.date||"")}</td><td>Expense · ${esc(x.category||"")}</td><td>${esc(x.reference||"")}</td><td>${esc(x.vendor||"")}</td><td>Recorded</td><td class="num">${money(x.amount,currency)}</td></tr>`)].join("");
  $("#printArea").innerHTML=`<div class="print-document modern-document"><div class="modern-print-head"><div class="modern-company"><img src="${businessLogoSource()}"><div><h1>${esc(s.name)}</h1><p>${esc(s.address||"")}</p><p>${esc(s.phone||"")}${s.email?` · ${esc(s.email)}`:""}</p></div></div><div class="modern-doc-ref"><span>BUSINESS REPORT</span><strong>${esc(currency)}</strong><small>${esc(from)} — ${esc(to)}</small></div></div><div class="modern-accent"></div><div class="print-meta"><div class="print-box"><strong>Sales</strong>Invoice total: ${money(sales,currency)}<br>Payments received: ${money(paid,currency)}<br>Invoice balances: ${money(invoices.reduce((n,x)=>n+invoiceBalance(x),0),currency)}</div><div class="print-box"><strong>Purchases & expenses</strong>Supplier invoices: ${money(purchaseTotal,currency)}<br>Operating expenses: ${money(expenseTotal,currency)}<br>Stock value today: ${money(stockValue(),currency)}</div></div><table class="print-table modern-table"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Party</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>${rows||`<tr><td colspan="6">No activity for this period.</td></tr>`}</tbody></table><div class="print-footer"><span>${esc(s.footer)}</span><span>${esc(s.name)} · Generated ${today()}</span></div></div>`;
  waitForPrintAssets().then(()=>window.print());
};

["stockSearch","stockFilter","salesSearch","salesStatus","customerSearch","waybillSearch","waybillDirection","expenseSearch","expenseCategoryFilter","auditSearch"].forEach(id=>{const el=$("#"+id);el?.addEventListener("input",renderAll);el?.addEventListener("change",renderAll)});
window.addEventListener("load",async()=>{
  const sessionId=new URLSearchParams(location.search).get("editorSession");
  if(sessionId){
    const session=await readEditorSession(sessionId);
    if(session?.state){
      editorTabSession=session;state=mergeState(session.state);$("#connectDriveBtn").disabled=true;setDriveStatus("Editor tab",true);$("#driveDetails").textContent="Changes from this tab are saved locally and sent to the original workspace tab for cloud sync.";document.body.classList.add("editor-page-mode");showApp();
      if(session.kind==="product"){switchView("stock");renderProductEditor(session.options?.id||null);presentEditorAsPage()}
      else if(session.kind==="sale"){switchView("sales");renderSaleEditor(session.options?.sourceId||null,!!session.options?.copyMode,session.options?.initialType||"estimate");presentEditorAsPage()}
      else if(session.kind==="purchase"){switchView("purchases");renderPurchaseEditor(session.options?.kind||"order",session.options?.sourceOrderId||null);presentEditorAsPage()}
      else if(session.kind==="convertProforma"){switchView("sales");convertToProforma(session.options?.id);presentEditorAsPage()}
      else if(session.kind==="convertInvoice"){switchView("sales");convertToInvoice(session.options?.id);presentEditorAsPage()}
      else{init();$("#connectDriveBtn").disabled=true}
      return;
    }
  }
  init();$("#connectDriveBtn").disabled=true;
});
