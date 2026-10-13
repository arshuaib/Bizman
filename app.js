/* EliteVolt Systems Business Manager */
const CLIENT_ID = "963866679895-pjiipqqa4imbkmfs1uvm73eavp9d8am9.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file";
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";
const APP_FOLDER = "EliteVolt Systems Data";
const DATA_FILE = "elitevolt-data.json";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const money = (n) => `${state.settings.currency || "GH₵"} ${Number(n || 0).toLocaleString("en-GH",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
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

let state = defaultState();
let charts = {};
let tokenClient = null;
let driveFileId = null;
let driveFolderId = null;
let saveTimer = null;
let driveReady = false;

function defaultState(){
  return {
    version: 3,
    products: [],
    customers: [],
    invoices: [],
    estimates: [],
    proformas: [],
    suppliers: [],
    purchaseOrders: [],
    purchaseInvoices: [],
    waybills: [],
    transactions: [],
    settings: {
      name:"EliteVolt Systems",
      phone:"",
      email:"",
      address:"",
      tax:"",
      prefix:"EVS",
      currency:"GH₵",
      footer:"Thank you for doing business with EliteVolt Systems.",
      companyReg:"",
      taxCategories:"NHIL 2.5%, GETFund 2.5%, VAT 15%",
      defaultTaxRate:0,
      salesContract:"",
      documentNotes:"",
      paymentTerms:"Payment due as stated on the document.",
      bankDetails:"",
      documentValidityDays:7,
      taxEnabled:true
    }
  };
}
function mergeState(raw){
  const base=defaultState();
  return {
    ...base,...raw,
    version:3,
    products:Array.isArray(raw?.products)?raw.products:[],
    customers:Array.isArray(raw?.customers)?raw.customers:[],
    invoices:Array.isArray(raw?.invoices)?raw.invoices.map(i=>({...i,items:Array.isArray(i.items)?i.items.map(x=>({...x,lineId:x.lineId||uid("line")})):[],stockDeducted:i.stockDeducted??false,paid:Number(i.paid||0),delivered:!!i.delivered,reserved:i.reserved??(Number(i.paid||0)>0&&!i.delivered)})):[],
    estimates:Array.isArray(raw?.estimates)?raw.estimates.map(i=>({...i,items:Array.isArray(i.items)?i.items.map(x=>({...x,lineId:x.lineId||uid("line")})):[]})):[],
    proformas:Array.isArray(raw?.proformas)?raw.proformas.map(i=>({...i,items:Array.isArray(i.items)?i.items.map(x=>({...x,lineId:x.lineId||uid("line")})):[]})):[],
    suppliers:Array.isArray(raw?.suppliers)?raw.suppliers:[],
    purchaseOrders:Array.isArray(raw?.purchaseOrders)?raw.purchaseOrders.map(i=>({...i,items:Array.isArray(i.items)?i.items.map(x=>({...x,lineId:x.lineId||uid("pline"),receivedQty:Number(x.receivedQty||0)})):[]})):[],
    purchaseInvoices:Array.isArray(raw?.purchaseInvoices)?raw.purchaseInvoices.map(i=>({...i,items:Array.isArray(i.items)?i.items.map(x=>({...x,lineId:x.lineId||uid("pline"),receivedQty:Number(x.receivedQty||0)})):[]})):[],
    waybills:Array.isArray(raw?.waybills)?raw.waybills.map(w=>({...w,items:Array.isArray(w.items)?w.items.map(x=>({...x,handledQty:Number(x.handledQty||0)})):[]})):[],
    transactions:Array.isArray(raw?.transactions)?raw.transactions:[],
    settings:{...base.settings,...(raw?.settings||{})}
  };
}
function toast(msg){
  const el=$("#toast"); el.textContent=msg; el.classList.add("show");
  clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove("show"),2600);
}
function setDriveStatus(text,ok=false){$("#driveStatus").textContent=`Drive: ${text}`;$("#driveStatus").style.background=ok?"rgba(121,201,0,.18)":"rgba(255,255,255,.1)"}
function showApp(){ $("#authScreen").classList.add("hidden"); $("#app").classList.remove("hidden"); renderAll(); }
function showAuth(){ $("#authScreen").classList.remove("hidden"); $("#app").classList.add("hidden"); }

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
  if(!tokenClient) return;
  tokenClient.callback=async(resp)=>{
    if(resp.error){toast("Google authorization failed.");return}
    try{
      driveReady=true; setDriveStatus("Connected",true);
      await loadFromDrive();
      showApp();
      toast("Google Drive connected.");
    }catch(e){console.error(e);toast("Drive connection worked, but data could not be loaded.");showApp();}
  };
  const existing=gapi.client.getToken();
  tokenClient.requestAccessToken({prompt:existing?"":"consent"});
}
async function loadFromDrive(){
  const qFolder=`name='${APP_FOLDER.replace(/'/g,"\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const folders=await gapi.client.drive.files.list({q:qFolder,fields:"files(id,name)",pageSize:10});
  if(folders.result.files?.length) driveFolderId=folders.result.files[0].id;
  else{
    const r=await gapi.client.drive.files.create({resource:{name:APP_FOLDER,mimeType:"application/vnd.google-apps.folder"},fields:"id,name"});
    driveFolderId=r.result.id;
  }
  const qFile=`name='${DATA_FILE}' and '${driveFolderId}' in parents and trashed=false`;
  const files=await gapi.client.drive.files.list({q:qFile,fields:"files(id,name,modifiedTime)",pageSize:10});
  if(files.result.files?.length){
    driveFileId=files.result.files[0].id;
    const r=await gapi.client.drive.files.get({fileId:driveFileId,alt:"media"});
    state=mergeState(typeof r.body==="string"?JSON.parse(r.body):r.body);
  }else{
    await saveToDrive(true);
  }
  $("#driveDetails").textContent=`Folder: ${APP_FOLDER} • Data file: ${DATA_FILE}`;
}
async function saveToDrive(silent=false){
  if(!driveReady) return;
  try{
    const body=JSON.stringify(state,null,2);
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
    setDriveStatus("Synced",true);
    if(!silent) toast("Saved to Google Drive.");
  }catch(e){console.error(e);setDriveStatus("Sync error");toast("Could not save to Drive.");}
}
function scheduleSave(){
  clearTimeout(saveTimer); setDriveStatus("Saving…",true);
  saveTimer=setTimeout(()=>saveToDrive(),700);
}
function mutate(fn){fn();renderAll();scheduleSave();}

function renderAll(){
  renderDashboard();renderStock();renderSales();renderPurchases();renderWaybills();renderCashflow();renderCustomers();renderReports();renderSettings();
}
function switchView(view){
  $$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $$(".view").forEach(v=>v.classList.toggle("active",v.id===view));
  if(view==="dashboard") renderDashboard();
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
  return orderTaxCategories(categories).map(x=>({...x,amount:base*x.rate/100}));
}
function documentTaxBase(doc){return Math.max(0,Number(doc.subtotal||0)-Number(doc.discount||0)+Number(doc.deliveryCharge||0)+Number(doc.laborCharge||0))}
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
  doc.subtotal=doc.items.reduce((s,x)=>s+Number(x.qty||0)*Number(x.price||0),0);
  doc.taxBase=documentTaxBase(doc);
  doc.taxLines=state.settings.taxEnabled===false?[]:taxBreakdown(doc.taxBase,state.settings.taxCategories);
  doc.taxTotal=doc.taxLines.reduce((s,x)=>s+x.amount,0);
  doc.total=Math.max(0,doc.taxBase+doc.taxTotal);
  return doc;
}
function reservedValue(){return state.invoices.reduce((s,i)=>s+(!i.delivered&&!i.stockDeducted&&Number(i.paid||0)>0?Number(i.total||0):0),0)}

function renderDashboard(){
  $("#mStock").textContent=money(stockValue());$("#mStockUnits").textContent=`${state.products.reduce((s,p)=>s+Number(p.qty||0),0)} units`;
  const mk=today().slice(0,7), inv=state.invoices.filter(i=>i.date.startsWith(mk));
  $("#mSales").textContent=money(inv.reduce((s,i)=>s+Number(i.total||0),0));$("#mInvoices").textContent=`${inv.length} invoices`;
  const trans=state.transactions.filter(t=>t.date.startsWith(mk));
  $("#mCashIn").textContent=money(trans.filter(t=>t.type==="in").reduce((s,t)=>s+Number(t.amount||0),0));
  $("#mCashOut").textContent=money(trans.filter(t=>t.type==="out").reduce((s,t)=>s+Number(t.amount||0),0));
  renderCashChart();renderCategoryChart();
  const low=state.products.filter(p=>Number(p.qty||0)-reservedQty(p.id)<=Number(p.minQty||0));
  $("#lowStockList").innerHTML=low.length?low.slice(0,8).map(p=>`<div class="list-row"><div><strong>${esc(p.name)}</strong><small>${esc(p.sku||"No SKU")}</small></div><span class="badge ${p.qty<=0?"out":"part"}">${p.qty} left</span></div>`).join(""):`<div class="empty">No low-stock items.</div>`;
  const recent=[...state.invoices].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);
  $("#recentSalesList").innerHTML=recent.length?recent.map(i=>`<div class="list-row"><div><strong>${esc(i.number)}</strong><small>${esc(i.customerName||"Customer missing")} • ${esc(i.date)}</small></div><strong>${money(i.total)}</strong></div>`).join(""):`<div class="empty">No sales recorded.</div>`;
}
function destroyChart(k){if(charts[k]){charts[k].destroy();charts[k]=null}}
function renderCashChart(){
  destroyChart("cash");const months=lastMonths(6);
  const data=months.map(m=>{const ts=state.transactions.filter(t=>t.date.startsWith(m));return {m,label:monthLabel(m),in:ts.filter(t=>t.type==="in").reduce((s,t)=>s+Number(t.amount||0),0),out:ts.filter(t=>t.type==="out").reduce((s,t)=>s+Number(t.amount||0),0)}});
  charts.cash=new Chart($("#cashChart"),{type:"line",data:{labels:data.map(x=>x.label),datasets:[{label:"Cash in",data:data.map(x=>x.in),tension:.35},{label:"Cash out",data:data.map(x=>x.out),tension:.35}]},options:{responsive:true,plugins:{legend:{position:"bottom"}},scales:{y:{beginAtZero:true}}}});
}
function renderCategoryChart(){
  destroyChart("category");const map={};state.invoices.forEach(i=>i.items.forEach(x=>{const p=state.products.find(p=>p.id===x.productId);const k=p?.category||"Other";map[k]=(map[k]||0)+Number(x.qty||0)*Number(x.price||0)}));
  const rows=Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,8);
  charts.category=new Chart($("#categoryChart"),{type:"doughnut",data:{labels:rows.map(x=>x[0]),datasets:[{data:rows.map(x=>x[1])}]},options:{responsive:true,plugins:{legend:{position:"bottom"}}}});
}

function renderStock(){
  const q=(document.querySelector("#stockSearch")?.value||"").toLowerCase(),f=document.querySelector("#stockFilter")?.value||"";
  const rows=state.products.filter(p=>`${p.name} ${p.sku||""} ${p.category||""}`.toLowerCase().includes(q)).filter(p=>{
    const avail=availableQty(p.id);return f==="low"?avail<=Number(p.minQty||0):f==="out"?avail<=0:true;
  });
  $("#stockTable").innerHTML=rows.length?rows.map(p=>{
    const reserved=reservedQty(p.id),avail=Math.max(0,Number(p.qty||0)-reserved);
    const badge=avail<=0?"out":avail<=Number(p.minQty||0)?"part":"ok";
    const menu=`<button class="icon-btn" data-edit-product="${p.id}">Edit</button><button class="icon-btn" data-adjust-product="${p.id}">Adjust</button><button class="icon-btn danger-action" data-delete-product="${p.id}">Delete</button>`;
    return `<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.sku||"—")}</td><td>${esc(p.category||"—")}</td><td><span class="badge ${badge}">${p.qty} on hand</span><small class="table-sub">${reserved} reserved • ${avail} available</small></td><td>${money(p.cost)}</td><td>${money(p.price)}</td><td>${money(p.qty*p.cost)}</td><td><div class="action-menu"><button class="action-menu-toggle" type="button" aria-expanded="false">Actions <span>▾</span></button><div class="action-menu-list">${menu}</div></div></td></tr>`;
  }).join(""):`<tr><td colspan="8" class="empty">No products found.</td></tr>`;
  $$('[data-edit-product]').forEach(b=>b.onclick=()=>openProduct(b.dataset.editProduct));
  $$('[data-adjust-product]').forEach(b=>b.onclick=()=>openAdjust(b.dataset.adjustProduct));
  $$('[data-delete-product]').forEach(b=>b.onclick=()=>{document.querySelectorAll('.action-menu.open').forEach(x=>x.classList.remove('open'));deleteProduct(b.dataset.deleteProduct)});
  $$('#stockTable .action-menu-toggle').forEach(b=>b.onclick=(e)=>{
    e.stopPropagation();
    const menu=b.closest('.action-menu');
    const wasOpen=menu.classList.contains('open');
    document.querySelectorAll('.action-menu.open').forEach(x=>{
      x.classList.remove('open');
      const t=x.querySelector('.action-menu-toggle'); if(t)t.setAttribute('aria-expanded','false');
      const list=x.querySelector('.action-menu-list'); if(list){list.style.top='';list.style.left='';list.style.right='';list.style.bottom='';list.style.visibility='';list.style.maxHeight='';list.style.overflowY='';}
    });
    if(wasOpen){b.setAttribute('aria-expanded','false');return;}
    menu.classList.add('open'); b.setAttribute('aria-expanded','true');
    const list=menu.querySelector('.action-menu-list'); if(!list)return;
    list.style.position='fixed'; list.style.visibility='hidden'; list.style.display='flex'; list.style.flexDirection='column';
    const br=b.getBoundingClientRect(), gap=6, pad=8;
    let lr=list.getBoundingClientRect(), top=br.bottom+gap;
    if(top+lr.height>window.innerHeight-pad) top=Math.max(pad,br.top-lr.height-gap);
    if(top+lr.height>window.innerHeight-pad){list.style.maxHeight=Math.max(120,window.innerHeight-top-pad)+'px';list.style.overflowY='auto';lr=list.getBoundingClientRect();top=Math.min(top,window.innerHeight-lr.height-pad);}
    let left=Math.max(pad,Math.min(br.right-lr.width,window.innerWidth-lr.width-pad));
    list.style.top=Math.round(top)+'px';list.style.left=Math.round(left)+'px';list.style.right='auto';list.style.bottom='auto';list.style.visibility='visible';
  });
}
function allDocuments(){
  return [
    ...state.estimates.map(d=>({...d,docType:"Estimate"})),
    ...state.proformas.map(d=>({...d,docType:"Proforma Invoice"})),
    ...state.invoices.map(d=>({...d,docType:"Invoice"}))
  ].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
}
function renderSales(){
  const q=($t("#salesSearch")?.value||"").toLowerCase(),f=$t("#salesStatus")?.value||"";
  const rows=allDocuments().filter(d=>`${d.number} ${d.customerName||""}`.toLowerCase().includes(q)).filter(d=>!f||d.docType===f||d.status===f);
  $("#salesTable").innerHTML=rows.length?rows.map(d=>{
    const isInv=d.docType==="Invoice", paid=Number(d.paid||0), balance=Math.max(0,Number(d.total||0)-paid);
    const reserved=isInv&&!d.delivered&&!d.stockDeducted&&paid>0;
    let badge=d.status||"Draft"; if(reserved) badge="Reserved / Awaiting delivery";
    const cls=reserved?"part":badge==="Paid"||badge==="Delivered"?"paid":badge==="Part-paid"?"part":"unpaid";
     let menu=`<button class="icon-btn" data-print-doc="${d.id}">Print</button><button class="icon-btn" data-copy-doc="${d.id}">Copy as quote</button>`;
     if(d.docType==="Estimate"){menu+=`<button class="icon-btn" data-edit-doc="${d.id}">Edit</button><button class="icon-btn" data-convert-pro="${d.id}">To Proforma</button><button class="icon-btn" data-convert-inv="${d.id}">To Invoice</button>`;
     } else if(d.docType==="Proforma Invoice"){menu+=`<button class="icon-btn" data-edit-doc="${d.id}">Edit</button><button class="icon-btn" data-convert-inv="${d.id}">To Invoice</button>`;
     } else menu+=`<button class="icon-btn" data-payment="${d.id}">Payment</button>${!d.delivered?`<button class="icon-btn" data-create-waybill="invoice:${d.id}">Create waybill</button>`:""}<button class="icon-btn" data-delivery="${d.id}">${d.delivered?"Delivered":"Confirm delivery"}</button><button class="icon-btn" data-receipt="${d.id}">Receipt</button>`;
    menu+=`<button class="icon-btn danger-action" data-delete-doc="${d.docType}:${d.id}">Delete</button>`;
     return `<tr><td><strong>${esc(d.number)}</strong><small class="table-sub">${d.docType==="Estimate"?"Quote / Estimate":esc(d.docType)}</small></td><td>${esc(d.date)}</td><td>${esc(d.customerName||"Customer missing")}</td><td>${money(d.total)}</td><td>${isInv?money(paid):"—"}</td><td>${isInv?money(balance):"—"}</td><td><span class="badge ${cls}">${esc(badge)}</span></td><td><div class="action-menu"><button class="action-menu-toggle" type="button" aria-expanded="false">Actions <span>▾</span></button><div class="action-menu-list">${menu}</div></div></td></tr>`;
  }).join(""):`<tr><td colspan="8" class="empty">No documents found.</td></tr>`;
  $$('[data-print-doc]').forEach(b=>b.onclick=()=>printDocument(b.dataset.printDoc));
  $$('[data-copy-doc]').forEach(b=>b.onclick=()=>openCopyQuotation(b.dataset.copyDoc));
  $$('[data-edit-doc]').forEach(b=>b.onclick=()=>openSale(b.dataset.editDoc,false));
  $$('[data-receipt]').forEach(b=>b.onclick=()=>printInvoice(b.dataset.receipt,true));
  $$('[data-payment]').forEach(b=>b.onclick=()=>recordPayment(b.dataset.payment));
  $$('[data-delivery]').forEach(b=>b.onclick=()=>confirmDelivery(b.dataset.delivery));
  $$('[data-convert-pro]').forEach(b=>b.onclick=()=>convertToProforma(b.dataset.convertPro));
  $$('[data-convert-inv]').forEach(b=>b.onclick=()=>convertToInvoice(b.dataset.convertInv));
  $$('[data-create-waybill]').forEach(b=>b.onclick=()=>{const [type,id]=b.dataset.createWaybill.split(":");openWaybill(type,id)});
  $$('.action-menu-toggle').forEach(b=>b.onclick=(e)=>{
    e.stopPropagation();
    const menu=b.closest('.action-menu');
    const wasOpen=menu.classList.contains('open');
    document.querySelectorAll('.action-menu.open').forEach(x=>{
      x.classList.remove('open');
      const t=x.querySelector('.action-menu-toggle');
      if(t)t.setAttribute('aria-expanded','false');
      const list=x.querySelector('.action-menu-list');
      if(list){list.style.top='';list.style.left='';list.style.right='';list.style.bottom='';list.style.visibility='';}
    });
    if(wasOpen){b.setAttribute('aria-expanded','false');return;}
    menu.classList.add('open');
    b.setAttribute('aria-expanded','true');
    const list=menu.querySelector('.action-menu-list');
    if(!list)return;
    list.style.position='fixed';
    list.style.visibility='hidden';
    list.style.display='flex';
    list.style.flexDirection='column';
    const br=b.getBoundingClientRect();
    const lr=list.getBoundingClientRect();
    const gap=6, pad=8;
    let top=br.bottom+gap;
    if(top+lr.height>window.innerHeight-pad){top=Math.max(pad,br.top-lr.height-gap);}
    if(top+lr.height>window.innerHeight-pad){
      list.style.maxHeight=Math.max(120,window.innerHeight-top-pad)+'px';
      list.style.overflowY='auto';
      const adjusted=list.getBoundingClientRect();
      top=Math.min(top,window.innerHeight-adjusted.height-pad);
    }
    let left=br.right-lr.width;
    left=Math.max(pad,Math.min(left,window.innerWidth-lr.width-pad));
    list.style.top=Math.round(top)+'px';
    list.style.left=Math.round(left)+'px';
    list.style.right='auto';
    list.style.bottom='auto';
    list.style.visibility='visible';
  });
  $$('[data-delete-doc]').forEach(b=>{const [type,id]=b.dataset.deleteDoc.split(":");b.onclick=()=>{document.querySelectorAll('.action-menu.open').forEach(x=>x.classList.remove('open'));deleteDocument(type,id)}});
}
function $t(sel){return document.querySelector(sel)}

function renderPurchases(){
  const month=today().slice(0,7),monthInvoices=state.purchaseInvoices.filter(x=>String(x.date||"").startsWith(month));
  const openOrders=state.purchaseOrders.filter(x=>x.status!=="Received"&&x.status!=="Cancelled");
  const outstanding=state.purchaseInvoices.reduce((n,x)=>n+Math.max(0,Number(x.total||0)-Number(x.paid||0)),0);
  $("#mOpenPO").textContent=openOrders.length;
  $("#mPurchaseInvoices").textContent=state.purchaseInvoices.length;
  $("#mPurchaseBalance").textContent=`${money(outstanding)} outstanding`;
  $("#mPurchases").textContent=money(monthInvoices.reduce((n,x)=>n+Number(x.total||0),0));
  $("#purchaseOrdersTable").innerHTML=state.purchaseOrders.length?state.purchaseOrders.slice().sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))).map(p=>{
    const received=p.items.reduce((n,x)=>n+Number(x.receivedQty||0),0),qty=p.items.reduce((n,x)=>n+Number(x.qty||0),0),pending=received<qty;
    const linkedInvoice=state.purchaseInvoices.some(x=>x.sourceOrderId===p.id);
    return `<tr><td><strong>${esc(p.number)}</strong></td><td>${esc(p.date||"")}</td><td>${esc(p.supplierName||"Supplier")}</td><td>${money(p.total)}</td><td>${received} / ${qty}</td><td><span class="badge ${p.status==="Received"?"paid":p.status==="Partially received"?"part":"unpaid"}">${esc(p.status||"Ordered")}</span></td><td><div class="actions"><button class="icon-btn" data-print-purchase="order:${p.id}">Print</button>${pending?`<button class="icon-btn" data-create-waybill="purchaseOrder:${p.id}">Waybill</button>`:""}${!linkedInvoice?`<button class="icon-btn" data-convert-purchase="${p.id}">Create invoice</button>`:""}</div></td></tr>`;
  }).join(""):`<tr><td colspan="7" class="empty">No purchase orders yet. Create one to plan your next supplier order.</td></tr>`;
  $("#purchaseInvoicesTable").innerHTML=state.purchaseInvoices.length?state.purchaseInvoices.slice().sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))).map(p=>{
    const balance=Math.max(0,Number(p.total||0)-Number(p.paid||0)),received=p.items.reduce((n,x)=>n+Number(x.receivedQty||0),0),qty=p.items.reduce((n,x)=>n+Number(x.qty||0),0);
    return `<tr><td><strong>${esc(p.number)}</strong><small class="table-sub">${esc(p.reference||"")}</small></td><td>${esc(p.date||"")}</td><td>${esc(p.supplierName||"Supplier")}</td><td>${money(p.total)}</td><td>${money(p.paid||0)}</td><td>${money(balance)}</td><td>${received} / ${qty}</td><td><div class="actions"><button class="icon-btn" data-print-purchase="invoice:${p.id}">Print</button>${received<qty?`<button class="icon-btn" data-create-waybill="purchaseInvoice:${p.id}">Waybill</button>`:""}${balance>0?`<button class="icon-btn" data-purchase-payment="${p.id}">Payment</button>`:""}${received<qty?`<button class="icon-btn" data-receive-purchase="${p.id}">Receive stock</button>`:""}</div></td></tr>`;
  }).join(""):`<tr><td colspan="8" class="empty">Supplier invoices will appear here.</td></tr>`;
  $("#suppliersTable").innerHTML=state.suppliers.length?state.suppliers.map(s=>`<tr><td><strong>${esc(s.name)}</strong></td><td>${esc(s.contactPerson||"—")}</td><td>${esc(s.phone||"—")}</td><td>${esc(s.email||"—")}</td><td>${state.purchaseOrders.filter(x=>x.supplierId===s.id).length+state.purchaseInvoices.filter(x=>x.supplierId===s.id).length}</td><td><div class="actions"><button class="icon-btn" data-edit-supplier="${s.id}">Edit</button><button class="icon-btn danger-action" data-delete-supplier="${s.id}">Delete</button></div></td></tr>`).join(""):`<tr><td colspan="6" class="empty">Add your first supplier to start creating purchase orders.</td></tr>`;
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
document.addEventListener('click',()=>document.querySelectorAll('.action-menu.open').forEach(x=>{
  x.classList.remove('open');
  const t=x.querySelector('.action-menu-toggle');if(t)t.setAttribute('aria-expanded','false');
  const list=x.querySelector('.action-menu-list');if(list){list.style.top='';list.style.left='';list.style.right='';list.style.bottom='';list.style.visibility='';list.style.maxHeight='';list.style.overflowY='';}
}));
window.addEventListener('resize',()=>document.querySelectorAll('.action-menu.open').forEach(x=>{
  const b=x.querySelector('.action-menu-toggle'),list=x.querySelector('.action-menu-list');if(!b||!list)return;
  const br=b.getBoundingClientRect(),lr=list.getBoundingClientRect(),gap=6,pad=8;
  let top=br.bottom+gap;if(top+lr.height>window.innerHeight-pad)top=Math.max(pad,br.top-lr.height-gap);
  let left=Math.max(pad,Math.min(br.right-lr.width,window.innerWidth-lr.width-pad));
  list.style.top=Math.round(top)+'px';list.style.left=Math.round(left)+'px';
}));
window.addEventListener('scroll',()=>document.querySelectorAll('.action-menu.open').forEach(x=>{
  const b=x.querySelector('.action-menu-toggle'),list=x.querySelector('.action-menu-list');if(!b||!list)return;
  const br=b.getBoundingClientRect(),lr=list.getBoundingClientRect(),gap=6,pad=8;
  let top=br.bottom+gap;if(top+lr.height>window.innerHeight-pad)top=Math.max(pad,br.top-lr.height-gap);
  let left=Math.max(pad,Math.min(br.right-lr.width,window.innerWidth-lr.width-pad));
  list.style.top=Math.round(top)+'px';list.style.left=Math.round(left)+'px';
},{passive:true}));
function renderCashflow(){
  const ins=state.transactions.filter(t=>t.type==="in").reduce((s,t)=>s+Number(t.amount||0),0),outs=state.transactions.filter(t=>t.type==="out").reduce((s,t)=>s+Number(t.amount||0),0);
  $("#cfIn").textContent=money(ins);$("#cfOut").textContent=money(outs);$("#cfNet").textContent=money(ins-outs);
  $("#cashTable").innerHTML=[...state.transactions].sort((a,b)=>b.date.localeCompare(a.date)).map(t=>`<tr><td>${esc(t.date)}</td><td><span class="badge ${t.type==="in"?"paid":"unpaid"}">${t.type==="in"?"Cash in":"Cash out"}</span></td><td>${esc(t.category||"—")}</td><td>${esc(t.description||"")}</td><td>${money(t.amount)}</td><td>${esc(t.reference||"—")}</td><td><button class="icon-btn" data-delete-cash="${t.id}">Delete</button></td></tr>`).join("")||`<tr><td colspan="7" class="empty">No transactions.</td></tr>`;
  $$("[data-delete-cash]").forEach(b=>b.onclick=()=>deleteCash(b.dataset.deleteCash));
  destroyChart("monthly");const months=lastMonths(12);const vals=months.map(m=>{const ts=state.transactions.filter(t=>t.date.startsWith(m));return {label:monthLabel(m),v:ts.filter(t=>t.type==="in").reduce((s,t)=>s+Number(t.amount||0),0)-ts.filter(t=>t.type==="out").reduce((s,t)=>s+Number(t.amount||0),0)}});
  charts.monthly=new Chart($("#monthlyCashChart"),{type:"bar",data:{labels:vals.map(x=>x.label),datasets:[{label:"Net cash flow",data:vals.map(x=>x.v)}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});
}
function renderCustomers(){
  const q=($("#customerSearch")?.value||"").toLowerCase();
  const rows=state.customers.filter(c=>`${c.name} ${c.phone||""} ${c.email||""}`.toLowerCase().includes(q));
  $("#customersTable").innerHTML=rows.length?rows.map(c=>`<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.contactPerson||"—")}</td><td>${esc(c.phone||"—")}</td><td>${esc(c.email||"—")}</td><td>${esc(c.billingAddress||c.address||"—")}</td><td>${allDocuments().filter(i=>i.customerId===c.id).length}</td><td><div class="actions"><button class="icon-btn" data-edit-customer="${c.id}">Edit</button><button class="icon-btn" data-delete-customer="${c.id}">Delete</button></div></td></tr>`).join(""):`<tr><td colspan="7" class="empty">No customers found.</td></tr>`;
  $$("[data-edit-customer]").forEach(b=>b.onclick=()=>openCustomer(b.dataset.editCustomer));
  $$("[data-delete-customer]").forEach(b=>b.onclick=()=>deleteCustomer(b.dataset.deleteCustomer));
}
function renderReports(){
  $("#rProducts").textContent=state.products.length;$("#rUnits").textContent=state.products.reduce((s,p)=>s+Number(p.qty||0),0);$("#rInvoices").textContent=state.invoices.length;$("#rCustomers").textContent=state.customers.length;
  const sold={};state.invoices.forEach(i=>i.items.forEach(x=>sold[x.productId]=(sold[x.productId]||0)+Number(x.qty||0)));
  $("#topProducts").innerHTML=Object.entries(sold).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([id,q])=>{const p=state.products.find(p=>p.id===id);return `<div class="list-row"><div><strong>${esc(p?.name||"Deleted product")}</strong><small>${q} units sold</small></div></div>`}).join("")||`<div class="empty">No sales data.</div>`;
  const cat={};state.products.forEach(p=>cat[p.category||"Other"]=(cat[p.category||"Other"]||0)+Number(p.qty||0));$("#categorySummary").innerHTML=Object.entries(cat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="list-row"><strong>${esc(k)}</strong><span>${v} units</span></div>`).join("")||`<div class="empty">No stock data.</div>`;
}
function renderSettings(){
  const s=state.settings;$("#setName").value=s.name;$("#setPhone").value=s.phone;$("#setEmail").value=s.email;$("#setAddress").value=s.address;$("#setTax").value=s.tax;$("#setPrefix").value=s.prefix;$("#setCurrency").value=s.currency;$("#setFooter").value=s.footer;$("#setCompanyReg").value=s.companyReg||"";$("#setTaxCategories").value=s.taxCategories||"";$("#setDefaultTaxRate").value=s.defaultTaxRate??0;$("#setSalesContract").value=s.salesContract||"";$("#setDocumentNotes").value=s.documentNotes||"";$("#setPaymentTerms").value=s.paymentTerms||"";$("#setBankDetails").value=s.bankDetails||"";$("#setValidityDays").value=s.documentValidityDays??7;$("#setTaxEnabled").checked=s.taxEnabled!==false;
}

function modal(content){$("#modalCard").innerHTML=content;$("#modal").classList.remove("hidden")}
function closeModal(){$("#modal").classList.add("hidden");$("#modalCard").innerHTML=""}
document.addEventListener("click",e=>{if(e.target.matches("[data-close-modal]"))closeModal()});

function openProduct(id=null,onSaved=null){
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
      sku,
      category,
      qty:+$("#pQty").value,
      minQty:+$("#pMin").value,
      cost:+$("#pCost").value,
      price:+$("#pPrice").value
    };
    mutate(()=>{if(p)Object.assign(p,obj);else state.products.push(obj)});
    closeModal();
    if(onSaved) onSaved(obj.id);
  };
}
function openAdjust(id){
  const p=state.products.find(x=>x.id===id);if(!p)return;
  modal(`<div class="modal-head"><h3>Adjust Stock — ${esc(p.name)}</h3><button class="close" data-close-modal>×</button></div>
  <div class="form-stack"><label>Adjustment quantity<input id="aQty" type="number" class="input" value="0"></label><label>Reason<select id="aReason" class="input"><option>Stock received</option><option>Stock damaged</option><option>Stock count correction</option><option>Other</option></select></label><label>Note<input id="aNote" class="input"></label></div>
  <div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="adjustBtn">Apply</button></div>`);
  $("#adjustBtn").onclick=()=>{const n=+$("#aQty").value;if(!n){toast("Enter an adjustment quantity.");return}mutate(()=>{p.qty=Math.max(0,Number(p.qty)+n);state.transactions.push({id:uid("tx"),date:today(),type:n>0?"out":"out",category:"Stock adjustment",description:`${$("#aReason").value}: ${$("#aNote").value}`,amount:0,reference:p.sku||p.id})});closeModal();};
}
function deleteProduct(id){
  const p=state.products.find(x=>x.id===id); if(!p)return;
  const referenced=[...allDocuments(),...state.purchaseOrders,...state.purchaseInvoices,...state.waybills].some(d=>d.items?.some(x=>x.productId===id));
  const reserved=reservedQty(id)>0;
  if(referenced){toast("Delete protection: this item is used in a sales, purchase or waybill record. Edit or archive it instead.");return}
  if(reserved){toast("Delete protection: this item has reserved stock for a customer.");return}
  if(Number(p.qty||0)>0 && !confirm(`Delete ${p.name}? This will remove ${p.qty} unit(s) currently in stock. Continue?`))return;
  if(Number(p.qty||0)<=0 && !confirm(`Delete ${p.name}? This action cannot be undone.`))return;
  mutate(()=>state.products=state.products.filter(x=>x.id!==id));
}
function nextDocumentNumber(kind){
  const prefix=state.settings.prefix||"EVS";const year=new Date().getFullYear();
  const map={estimate:state.estimates,proforma:state.proformas,invoice:state.invoices};
  const code={estimate:"EST",proforma:"PRO",invoice:"INV"}[kind];
  const arr=map[kind]||[];
  const nums=arr.map(d=>d.number).filter(n=>n?.startsWith(`${prefix}-${code}-${year}-`)).map(n=>+(n.split("-").pop())||0);
  return `${prefix}-${code}-${year}-${String(Math.max(0,...nums)+1).padStart(4,"0")}`;
}
function addDays(date,days){const d=new Date(date+"T00:00:00");d.setDate(d.getDate()+days);return d.toISOString().slice(0,10)}
function customerSnapshot(c){return {customerId:c?.id||"",customerName:c?.name||"",customerContactPerson:c?.contactPerson||"",customerPhone:c?.phone||"",customerEmail:c?.email||"",customerBillingAddress:c?.billingAddress||c?.address||"",customerShippingAddress:c?.shippingAddress||"",customerTaxId:c?.taxId||""}}
function customerSelectHtml(selected=""){
  return `<select id="sCustomer" class="input"><option value="">Select customer…</option>${state.customers.map(c=>`<option value="${c.id}" ${c.id===selected?"selected":""}>${esc(c.name)}</option>`).join("")}</select><button type="button" class="btn btn-outline" id="addCustomerInline">+ Add customer</button>`;
}
function openSale(sourceId=null, copyMode=false){
  const source=sourceId?findDocument(sourceId):null;
  const sourceKind=source?(state.proformas.some(x=>x.id===source.id)?"proforma":"estimate"):"estimate";
  if(!state.products.length){toast("Add products before creating a quotation.");return}
  const taxLabels=parseTaxCategories(state.settings.taxCategories);
  modal(`<div class="modal-head"><h3>${source && !copyMode ? "Edit " + esc(source.number) : "New Quote / Estimate"}</h3><button class="close" data-close-modal>×</button></div>
  <p class="muted">Save this quote or estimate, then convert it to a proforma or sales invoice when approved. Stock changes only when delivery is confirmed.</p>
  <div class="two-col"><label>Document type<select id="sDocType" class="input"><option value="estimate">Quote / Estimate</option></select></label><label>Date<input id="sDate" type="date" class="input" value="${esc(source?.date||today())}"></label></div>
  <div class="two-col" style="margin-top:12px"><div><label>Customer ${customerSelectHtml(source && !copyMode ? source.customerId : "")}</label></div><div><label>Customer details</label><div id="selectedCustomerInfo" class="selected-customer">Select a customer. Walk-in customers are not used for formal documents.</div></div></div>
  <div style="margin-top:15px"><div class="panel-head"><h3>Items</h3><div class="actions"><button class="btn btn-outline" id="quickAddStock">+ Add item to stock</button><button class="btn btn-outline" id="addLine">+ Add item</button></div></div><div id="saleLines" class="line-items"></div><div id="stockWarning" class="stock-warning hidden"></div></div>
  <div class="form-grid" style="margin-top:14px"><label>Discount amount<input id="sDiscount" type="number" min="0" step=".01" class="input" value="${source?.discount||0}"><small class="muted">Calculated: <span id="discountPct">0%</span> of subtotal</small></label><label>Delivery charge<input id="sDelivery" type="number" min="0" step=".01" class="input" value="${source?.deliveryCharge||0}"></label><label>Installation / labour charge<input id="sLabor" type="number" min="0" step=".01" class="input" value="${source?.laborCharge||0}"></label></div>
  <div class="panel" style="margin-top:14px"><label style="display:flex;gap:8px;align-items:center"><input id="sTaxEnabled" type="checkbox" ${(source?.taxEnabled!==false && state.settings.taxEnabled!==false)?"checked":""}> Apply configured taxes</label><div class="muted" id="taxSummary" style="margin-top:5px"></div></div>
  <label style="display:block;margin-top:12px">Document note<textarea id="sNote" class="input" rows="2">${esc(source?.note||state.settings.documentNotes||"")}</textarea></label>
  <div class="sale-total">Total: <span id="saleTotal" style="margin-left:8px">${money(0)}</span></div>
  <div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="saveSaleBtn">Save Quote / Estimate</button></div>`);

  function refreshCustomerInfo(){
    const c=state.customers.find(c=>c.id===$("#sCustomer").value);
    $("#selectedCustomerInfo").innerHTML=c?`<strong>${esc(c.name)}</strong><br>${esc(c.phone||"")} ${c.email?`• ${esc(c.email)}`:""}<br>${esc(c.billingAddress||"")}${c.shippingAddress?`<br>Ship: ${esc(c.shippingAddress)}`:""}`:"<span class='muted'>Select a customer. Walk-in customers are not used for formal documents.</span>";
  }
  $("#addCustomerInline").onclick=()=>openCustomerQuick(id=>{ $("#sCustomer").value=id; refreshCustomerInfo(); });
  $("#sCustomer").onchange=refreshCustomerInfo;

  const productOptions=(selected="")=>`<option value="">Select item…</option>${state.products.map(p=>`<option value="${p.id}" ${p.id===selected?"selected":""}>${esc(p.name)} — ${availableQty(p.id)} available</option>`).join("")}`;
  const addLine=(selectedId="", qty=1, linePrice=0, lineId="")=>{
    const row=document.createElement("div");row.className="product-line";row.dataset.lineId=lineId||uid("line");
    row.innerHTML=`<select class="input line-product">${productOptions(selectedId)}</select><input class="input line-qty" type="number" min="1" value="${qty}"><input class="input line-price" type="number" min="0" step=".01" value="${linePrice}"><span class="line-sub">${money(0)}</span><button class="icon-btn remove-line" type="button">×</button>`;
    $("#saleLines").appendChild(row);
    const sel=row.querySelector(".line-product"),price=row.querySelector(".line-price");
    const updatePrice=()=>{const p=state.products.find(p=>p.id===sel.value);if(!linePrice) price.value=p?.price||0;updateTotal()};
    sel.onchange=updatePrice;row.oninput=updateTotal;row.querySelector(".remove-line").onclick=()=>{row.remove();updateTotal()};
    if(selectedId) updatePrice(); else updateTotal();
  };
  const refreshLineOptions=()=>{$$(".line-product").forEach(sel=>{const current=sel.value;sel.innerHTML=productOptions(current);});};
  const updateTotal=()=>{
    const rows=$$(".product-line");
    const items=rows.map(r=>({productId:r.querySelector('.line-product').value,qty:+r.querySelector('.line-qty').value||0,price:+r.querySelector('.line-price').value||0})).filter(x=>x.productId&&x.qty>0);
    rows.forEach(r=>{const q=+r.querySelector('.line-qty').value||0,p=state.products.find(x=>x.id===r.querySelector('.line-product').value);r.querySelector('.line-sub').textContent=money(q*(+r.querySelector('.line-price').value||0));});
    const subtotal=items.reduce((s,x)=>s+x.qty*x.price,0),discount=Math.min(subtotal,+$("#sDiscount").value||0),delivery=+$("#sDelivery").value||0,labor=+$("#sLabor").value||0,base=Math.max(0,subtotal-discount+delivery+labor),tax=$("#sTaxEnabled").checked?taxBreakdown(base,state.settings.taxCategories).reduce((s,x)=>s+x.amount,0):0;
    $("#sDiscount").value=discount; $("#discountPct").textContent=subtotal?(discount/subtotal*100).toFixed(2)+"%":"0%"; $("#taxSummary").textContent=$("#sTaxEnabled").checked?(taxLabels.length?taxLabels.map(x=>`${esc(x.name)} ${x.rate}%`).join(" + "):"No configured taxes"):"Taxes excluded";
    $("#saleTotal").textContent=money(base+tax);
    const warnings=stockAvailabilityWarnings(items);
    const box=$("#stockWarning");
    if(warnings.length){box.classList.remove("hidden");box.innerHTML=`<strong>Stock alert</strong><br>${warnings.map(esc).join("<br>")}`}else{box.classList.add("hidden");box.innerHTML=""}
  };
  $("#addLine").onclick=()=>addLine();
  $("#quickAddStock").onclick=()=>openQuickProduct((newId)=>{refreshLineOptions();addLine(newId);});
  $("#sDiscount").oninput=updateTotal;$("#sDelivery").oninput=updateTotal;$("#sLabor").oninput=updateTotal;$("#sTaxEnabled").onchange=updateTotal;
  if(source?.items?.length){source.items.forEach(x=>addLine(x.productId,x.qty,x.price,x.lineId));}else addLine();

  $("#saveSaleBtn").onclick=()=>{
    const c=state.customers.find(c=>c.id===$("#sCustomer").value);if(!c)return toast("Select or add a customer before saving the quotation.");
    const items=$$(".product-line").map(r=>({lineId:r.dataset.lineId,productId:r.querySelector('.line-product').value,qty:+r.querySelector('.line-qty').value||0,price:+r.querySelector('.line-price').value||0,deliveredQty:Number((source?.items||[]).find(x=>x.lineId===r.dataset.lineId)?.deliveredQty||0)})).filter(x=>x.productId&&x.qty>0);
    if(!items.length)return toast("Add at least one item and select each item.");
    const warnings=stockAvailabilityWarnings(items, source&&!copyMode?source.id:"");
    if(warnings.length && !confirm(`Stock alert:

${warnings.join("\n")}

Save this quotation anyway?`)) return;
    const subtotal=items.reduce((a,x)=>a+x.qty*x.price,0);
    const discount=Math.min(subtotal,Math.max(0,+$("#sDiscount").value||0));
    const doc={id:source&&!copyMode?source.id:uid("estimate"),number:source&&!copyMode?source.number:nextDocumentNumber("estimate"),date:$("#sDate").value,validUntil:addDays($("#sDate").value,Number(state.settings.documentValidityDays||7)),items,discount,deliveryCharge:+$("#sDelivery").value||0,laborCharge:+$("#sLabor").value||0,paid:0,status:"Quotation",delivered:false,stockDeducted:false,note:$("#sNote").value.trim(),taxEnabled:$("#sTaxEnabled").checked,...customerSnapshot(c)};
    recalcDocument(doc);
    doc.status=source&&!copyMode&&sourceKind==="proforma"?"Proforma": "Quotation";
    mutate(()=>{
      if(source&&!copyMode){
        if(sourceKind==="proforma") state.proformas=state.proformas.map(x=>x.id===source.id?{...doc,status:"Proforma"}:x);
        else state.estimates=state.estimates.map(x=>x.id===source.id?doc:x);
      } else state.estimates.push(doc);
    });
    closeModal();toast(source&&!copyMode?`${doc.number} updated.`:`${doc.number} saved.`);
  };
}
function openQuickProduct(onSaved){
  const wrap=document.createElement("div");wrap.className="submodal";wrap.innerHTML=`<div class="submodal-card"><div class="modal-head"><h3>Add Item to Stock</h3><button class="close" id="closeQuickProduct">×</button></div><div class="form-grid"><label>Product name<input id="qpName" class="input" placeholder="e.g. Solar Panel 550W"></label><label>Category<input id="qpCat" class="input" value="Solar / Electrical"></label><label>Opening quantity<input id="qpQty" type="number" min="0" class="input" value="0"></label><label>Minimum stock<input id="qpMin" type="number" min="0" class="input" value="2"></label><label>Cost price<input id="qpCost" type="number" min="0" step=".01" class="input" value="0"></label><label>Selling price<input id="qpPrice" type="number" min="0" step=".01" class="input" value="0"></label></div><div class="modal-footer"><button class="btn btn-outline" id="cancelQuickProduct">Cancel</button><button class="btn btn-primary" id="saveQuickProduct">Add Item</button></div></div>`;$("#modalCard").appendChild(wrap);
  const close=()=>wrap.remove();$("#closeQuickProduct").onclick=close;$("#cancelQuickProduct").onclick=close;
  $("#saveQuickProduct").onclick=()=>{const name=$("#qpName").value.trim(),category=$("#qpCat").value.trim();if(!name||!category)return toast("Product name and category are required.");const obj={id:uid("prod"),name,sku:makeSku(category,name),category,qty:+$("#qpQty").value||0,minQty:+$("#qpMin").value||0,cost:+$("#qpCost").value||0,price:+$("#qpPrice").value||0};mutate(()=>state.products.push(obj));close();onSaved&&onSaved(obj.id);};
}
function deductDocumentStock(doc){
  if(doc.stockDeducted)return;
  const totals={};doc.items.forEach(x=>{totals[x.productId]=(totals[x.productId]||0)+Math.max(0,Number(x.qty||0)-Number(x.deliveredQty||0))});
  for(const [productId,remaining] of Object.entries(totals)){const p=state.products.find(p=>p.id===productId);if(!p||Number(p.qty)<remaining)throw new Error(`Insufficient physical stock for ${p?.name||"item"}.`)}
  doc.items.forEach(x=>{const remaining=Math.max(0,Number(x.qty||0)-Number(x.deliveredQty||0)),p=state.products.find(p=>p.id===x.productId);p.qty-=remaining;x.deliveredQty=Number(x.deliveredQty||0)+remaining});doc.stockDeducted=true;doc.delivered=true;doc.reserved=false;
}
function recordPayment(id){
  const inv=state.invoices.find(x=>x.id===id);if(!inv)return;const bal=Math.max(0,Number(inv.total)-Number(inv.paid));if(bal<=0)return toast("Invoice is already fully paid.");
  modal(`<div class="modal-head"><h3>Record Payment — ${esc(inv.number)}</h3><button class="close" data-close-modal>×</button></div><div class="form-stack"><label>Outstanding balance<input class="input" value="${money(bal)}" readonly></label><label>Payment amount<input id="payAmount" type="number" min="0" max="${bal}" step=".01" class="input" value="${bal}"></label><label>Date<input id="payDate" type="date" class="input" value="${today()}"></label></div><p class="muted">Payment reserves the ordered stock. Stock remains in physical inventory until delivery is confirmed.</p><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="savePayment">Save Payment</button></div>`);
  $("#savePayment").onclick=()=>{const amount=Math.min(bal,Math.max(0,+$("#payAmount").value||0));if(amount<=0)return toast("Enter a payment amount.");mutate(()=>{inv.paid=Number(inv.paid||0)+amount;inv.status=inv.paid>=inv.total?"Paid":"Part-paid";inv.reserved=!inv.delivered&&!inv.stockDeducted;state.transactions.push({id:uid("tx"),date:$("#payDate").value,type:"in",category:"Sales",description:`Payment for ${inv.number}`,amount,reference:inv.number})});closeModal()};
}
function confirmDelivery(id){const inv=state.invoices.find(x=>x.id===id);if(!inv)return;if(inv.delivered)return toast("Delivery is already confirmed.");if(!confirm(`Confirm that ${inv.number} has been delivered to ${inv.customerName}? Stock will be deducted.`))return;try{mutate(()=>{deductDocumentStock(inv);inv.status=Number(inv.paid||0)>=Number(inv.total||0)?"Paid":"Delivered";});}catch(e){toast(e.message)}}
function copyForConversion(source,kind,paid=0){const inv={...source,id:uid(kind),number:nextDocumentNumber(kind),date:today(),validUntil:kind==="proforma"?addDays(today(),Number(state.settings.documentValidityDays||7)):undefined,paid:kind==="invoice"?paid:0,status:kind==="invoice"?(paid>0?(paid>=source.total?"Paid":"Part-paid"):"Unpaid"):"Proforma",delivered:false,stockDeducted:false,reserved:false,sourceDocumentId:source.id,sourceDocumentNumber:source.number,taxEnabled:source.taxEnabled!==false};recalcDocument(inv);return inv}
function convertToProforma(id){
  const source=state.estimates.find(x=>x.id===id);if(!source)return;
  if(!source.customerId)return toast("This quotation has no customer. Add a customer before converting.");
  const pro=copyForConversion(source,"proforma");
  const warnings=stockAvailabilityWarnings(pro.items);
  if(warnings.length && !confirm(`Stock alert:\n\n${warnings.join("\n")}\n\nConvert this quotation to a proforma invoice anyway?`)) return;
  mutate(()=>{state.proformas.push(pro);state.estimates=state.estimates.filter(x=>x.id!==source.id)});
  closeModal();toast(`${source.number} converted to ${pro.number}. The quotation was removed.`);
}
function convertToInvoice(id){
  const sourceType=state.estimates.some(x=>x.id===id)?"estimate":"proforma";
  const source=sourceType==="estimate"?state.estimates.find(x=>x.id===id):state.proformas.find(x=>x.id===id);if(!source)return;
  if(!source.customerId)return toast("This document has no customer. Add a customer before converting.");
  modal(`<div class="modal-head"><h3>Convert ${esc(source.number)} to Invoice</h3><button class="close" data-close-modal>×</button></div><div class="form-stack"><p class="muted">Customer: <strong>${esc(source.customerName)}</strong><br>Total: <strong>${money(source.total)}</strong></p><label>Payment / part payment<input id="convertPaid" type="number" min="0" max="${source.total}" step=".01" class="input" value="0"></label><label>Invoice date<input id="convertDate" type="date" class="input" value="${today()}"></label><p class="muted">Payment reserves stock. Physical stock remains unchanged until delivery is confirmed.</p></div><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="convertBtn">Save Invoice</button></div>`);
  $("#convertBtn").onclick=()=>{
    const paid=Math.min(source.total,Math.max(0,+$("#convertPaid").value||0));
    const inv={...copyForConversion(source,"invoice",paid),date:$("#convertDate").value};
    const warnings=stockAvailabilityWarnings(inv.items);
    if(warnings.length){toast("Not enough available stock: "+warnings.join(" "));return}
    try{
      mutate(()=>{
        state.invoices.push(inv);
        if(sourceType==="estimate") state.estimates=state.estimates.filter(x=>x.id!==source.id);
        else state.proformas=state.proformas.filter(x=>x.id!==source.id);
        if(paid>0){inv.reserved=true;state.transactions.push({id:uid("tx"),date:inv.date,type:"in",category:"Sales",description:`Payment for ${inv.number}`,amount:paid,reference:inv.number});}
      });
      closeModal();toast(`${source.number} converted to ${inv.number}. The previous document was removed.`);
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
  modal(`<div class="modal-head"><h3>${s?"Edit":"Add"} Supplier</h3><button class="close" data-close-modal>×</button></div><div class="form-grid"><label>Supplier / Company name<input id="supName" class="input" value="${esc(s?.name||"")}" placeholder="Required"></label><label>Contact person<input id="supContact" class="input" value="${esc(s?.contactPerson||"")}"></label><label>Phone<input id="supPhone" class="input" value="${esc(s?.phone||"")}"></label><label>Email<input id="supEmail" class="input" value="${esc(s?.email||"")}"></label><label>Address<textarea id="supAddress" class="input" rows="3">${esc(s?.address||"")}</textarea></label><label>Tax / registration ID<input id="supTax" class="input" value="${esc(s?.taxId||"")}"></label></div><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="saveSupplier">Save supplier</button></div>`);
  $("#saveSupplier").onclick=()=>{const obj={id:s?.id||uid("supplier"),name:$("#supName").value.trim(),contactPerson:$("#supContact").value.trim(),phone:$("#supPhone").value.trim(),email:$("#supEmail").value.trim(),address:$("#supAddress").value.trim(),taxId:$("#supTax").value.trim()};if(!obj.name)return toast("Supplier name is required.");mutate(()=>{if(s)Object.assign(s,obj);else state.suppliers.push(obj)});closeModal();if(onSaved)onSaved(obj.id)};
}
function openSupplierQuick(onSaved){
  const wrap=document.createElement("div");wrap.className="submodal";wrap.innerHTML=`<div class="submodal-card"><div class="modal-head"><h3>Add Supplier</h3><button class="close" id="closeQuickSupplier">×</button></div><div class="form-grid"><label>Supplier / Company name<input id="qsName" class="input" placeholder="Required"></label><label>Contact person<input id="qsContact" class="input"></label><label>Phone<input id="qsPhone" class="input"></label><label>Email<input id="qsEmail" class="input"></label><label>Address<textarea id="qsAddress" class="input" rows="2"></textarea></label></div><div class="modal-footer"><button class="btn btn-outline" id="cancelQuickSupplier">Cancel</button><button class="btn btn-primary" id="saveQuickSupplier">Save supplier</button></div></div>`;$("#modalCard").appendChild(wrap);
  const close=()=>wrap.remove();$("#closeQuickSupplier").onclick=close;$("#cancelQuickSupplier").onclick=close;
  $("#saveQuickSupplier").onclick=()=>{const item={id:uid("supplier"),name:$("#qsName").value.trim(),contactPerson:$("#qsContact").value.trim(),phone:$("#qsPhone").value.trim(),email:$("#qsEmail").value.trim(),address:$("#qsAddress").value.trim()};if(!item.name)return toast("Supplier name is required.");mutate(()=>state.suppliers.push(item));const select=$("#pSupplier");if(select){select.insertAdjacentHTML("beforeend",`<option value="${item.id}">${esc(item.name)}</option>`);select.value=item.id}close();onSaved&&onSaved(item.id)};
}
function deleteSupplier(id){
  const supplier=state.suppliers.find(s=>s.id===id);if(!supplier)return;
  if(state.purchaseOrders.some(x=>x.supplierId===id)||state.purchaseInvoices.some(x=>x.supplierId===id))return toast("This supplier is linked to purchase documents. Keep the supplier record for history.");
  if(confirm(`Delete supplier ${supplier.name}?`))mutate(()=>state.suppliers=state.suppliers.filter(s=>s.id!==id));
}
function purchaseSupplierOptions(selected=""){return `<select id="pSupplier" class="input"><option value="">Select supplier…</option>${state.suppliers.map(s=>`<option value="${s.id}" ${s.id===selected?"selected":""}>${esc(s.name)}</option>`).join("")}</select><button class="btn btn-outline" type="button" id="addSupplierInline">+ Add supplier</button>`}
function openPurchase(kind="order",sourceOrderId=null){
  const isInvoice=kind==="invoice",sourceOrder=sourceOrderId?state.purchaseOrders.find(x=>x.id===sourceOrderId):null;
  const orderOptions=`<option value="">No linked purchase order</option>${state.purchaseOrders.filter(o=>!state.purchaseInvoices.some(p=>p.sourceOrderId===o.id)||o.id===sourceOrderId).map(o=>`<option value="${o.id}" ${o.id===sourceOrderId?"selected":""}>${esc(o.number)} — ${esc(o.supplierName||"Supplier")}</option>`).join("")}`;
  modal(`<div class="modal-head"><div><h3>New ${isInvoice?"Purchase Invoice":"Purchase Order"}</h3><small class="muted">${isInvoice?"Record a supplier bill; receive stock when goods arrive.":"Plan and print an order for your supplier."}</small></div><button class="close" data-close-modal>×</button></div>
    <div class="two-col"><div><label for="pSupplier">Supplier</label><div class="supplier-select">${purchaseSupplierOptions(sourceOrder?.supplierId||"")}</div></div><label>${isInvoice?"Supplier invoice number":"Order date"}<input id="pReference" class="input" value="" placeholder="${isInvoice?"Optional supplier reference":"Internal note (optional)"}"></label></div>
    ${isInvoice?`<div class="two-col" style="margin-top:12px"><label>Based on purchase order<select id="pSourceOrder" class="input">${orderOptions}</select></label><label>Invoice date<input id="pDate" type="date" class="input" value="${today()}"></label></div><div style="margin-top:12px"><label>Payment due date<input id="pDueDate" type="date" class="input" value="${addDays(today(),30)}"></label></div>`:`<div class="two-col" style="margin-top:12px"><label>Expected date<input id="pDate" type="date" class="input" value="${today()}"></label><label>Delivery / receiving instructions<input id="pInstructions" class="input" placeholder="Optional"></label></div>`}
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
  function updateTotal(){const subtotal=[...lineList.querySelectorAll(".purchase-line")].reduce((n,r)=>{const x=(+r.querySelector(".p-line-qty").value||0)*(+r.querySelector(".p-line-cost").value||0);r.querySelector(".p-line-total").textContent=money(x);return n+x},0);const disc=Math.min(subtotal,+$("#pDiscount").value||0);$("#purchaseTotal").textContent=money(Math.max(0,subtotal-disc)+(+$("#pCharges").value||0)+(+$("#pTax").value||0));}
  $("#pAddLine").onclick=()=>addLine();["pDiscount","pCharges","pTax"].forEach(id=>$("#"+id).oninput=updateTotal);
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
    const doc={id:uid(isInvoice?"purchase_invoice":"purchase_order"),number:nextOperationalNumber(isInvoice?"purchaseInvoice":"purchaseOrder"),date:$("#pDate").value||today(),dueDate:isInvoice?$("#pDueDate").value:"",reference:$("#pReference").value.trim(),items,subtotal,discount,otherCharges:charges,tax,total:Math.max(0,subtotal-discount)+charges+tax,note:$("#pNote").value.trim(),...supplierSnapshot(supplier)};
    if(isInvoice){doc.paid=0;doc.status="Unpaid";doc.sourceOrderId=$("#pSourceOrder")?.value||"";doc.received=items.every(x=>Number(x.receivedQty||0)>=x.qty);doc.receiptStatus=doc.received?"Received":items.some(x=>Number(x.receivedQty||0)>0)?"Partially received":"Awaiting goods";mutate(()=>{state.purchaseInvoices.push(doc);const order=state.purchaseOrders.find(x=>x.id===doc.sourceOrderId);if(order){order.status=order.items.every(x=>Number(x.receivedQty||0)>=x.qty)?"Received":order.items.some(x=>Number(x.receivedQty||0)>0)?"Partially received":"Invoiced";}});}
    else{doc.status="Ordered";doc.instructions=$("#pInstructions").value.trim();doc.items=items.map(x=>({...x,receivedQty:0}));mutate(()=>state.purchaseOrders.push(doc));}
    closeModal();toast(`${doc.number} saved.`);
  };
}
function recordPurchasePayment(id){
  const p=state.purchaseInvoices.find(x=>x.id===id);if(!p)return;const balance=Math.max(0,Number(p.total||0)-Number(p.paid||0));if(!balance)return toast("This purchase invoice is fully paid.");
  modal(`<div class="modal-head"><h3>Pay supplier invoice ${esc(p.number)}</h3><button class="close" data-close-modal>×</button></div><div class="form-stack"><label>Outstanding balance<input class="input" value="${money(balance)}" readonly></label><label>Payment amount<input id="purchasePayAmount" class="input" type="number" min="0" max="${balance}" step=".01" value="${balance}"></label><label>Payment date<input id="purchasePayDate" class="input" type="date" value="${today()}"></label></div><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="savePurchasePayment">Record payment</button></div>`);
  $("#savePurchasePayment").onclick=()=>{const amount=Math.min(balance,Math.max(0,+$("#purchasePayAmount").value||0));if(!amount)return toast("Enter a payment amount.");mutate(()=>{p.paid=Number(p.paid||0)+amount;p.status=p.paid>=p.total?"Paid":"Part-paid";state.transactions.push({id:uid("tx"),date:$("#purchasePayDate").value,type:"out",category:"Purchase",description:`Payment for ${p.number} — ${p.supplierName}`,amount,reference:p.number})});closeModal()};
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
    if(wb.direction==="outgoing")for(const [productId,qty] of Object.entries(outgoingTotals)){const available=availableQty(productId,wb.sourceType==="invoice"?wb.sourceId:"");if(qty>available){const product=state.products.find(p=>p.id===productId);return toast(`Only ${available} units of ${product?.name||"this product"} are available for dispatch.`)}}
    try{mutate(()=>{
      entries.forEach(({index,qty})=>{const line=wb.items[index],product=state.products.find(p=>p.id===line.productId),sourceLine=source?.items.find(x=>x.lineId===line.sourceItemId);
        if(wb.direction==="incoming"){
          if(sourceLine)applyPurchaseReceipt(source,sourceLine,qty);
          else{const incoming={lineId:uid("receipt"),productId:line.productId,cost:Number(product.cost||0)};applyPurchaseReceipt({items:[]},incoming,qty)}
        }else{
          if(sourceLine)sourceLine.deliveredQty=Number(sourceLine.deliveredQty||0)+qty;
          product.qty-=qty;
        }
        line.handledQty=Number(line.handledQty||0)+qty;
      });
      if(source&&wb.direction==="incoming"){
        syncPurchaseStatuses(source);
        if(wb.sourceType==="purchaseOrder")state.purchaseInvoices.filter(x=>x.sourceOrderId===source.id).forEach(syncPurchaseStatuses);
      }
      if(source&&wb.direction==="outgoing"){
        const delivered=source.items.every(x=>Number(x.deliveredQty||0)>=Number(x.qty||0));source.delivered=delivered;source.stockDeducted=delivered;source.reserved=!delivered&&Number(source.paid||0)>0;source.status=delivered?(Number(source.paid||0)>=Number(source.total||0)?"Paid":"Delivered"):"Partially delivered";
      }
      wb.status=wb.items.every(x=>Number(x.handledQty||0)>=Number(x.qty||0))?"Completed":"Partially completed";
    });closeModal();toast(wb.status==="Completed"?"Waybill completed; stock updated.":"Waybill quantities updated.");}catch(e){toast(e.message)}
  };
}

function openCash(){
  modal(`<div class="modal-head"><h3>Record Cash Transaction</h3><button class="close" data-close-modal>×</button></div>
  <div class="form-stack"><label>Date<input id="tDate" type="date" class="input" value="${today()}"></label><label>Type<select id="tType" class="input"><option value="in">Cash in</option><option value="out">Cash out</option></select></label><label>Category<input id="tCat" class="input" placeholder="e.g. Purchase, Transport, Utilities"></label><label>Description<input id="tDesc" class="input"></label><label>Amount<input id="tAmount" type="number" min="0" step=".01" class="input"></label><label>Reference<input id="tRef" class="input"></label></div>
  <div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="saveCashBtn">Save Transaction</button></div>`);
  $("#saveCashBtn").onclick=()=>{const a=+$("#tAmount").value;if(a<=0)return toast("Enter an amount.");mutate(()=>state.transactions.push({id:uid("tx"),date:$("#tDate").value,type:$("#tType").value,category:$("#tCat").value.trim(),description:$("#tDesc").value.trim(),amount:a,reference:$("#tRef").value.trim()}));closeModal()};
}
function deleteCash(id){
  const t=state.transactions.find(x=>x.id===id); if(!t)return;
  if(t.reference && state.invoices.some(i=>i.number===t.reference)){toast("Delete protection: this transaction is linked to an invoice. Manage it from the invoice payment history.");return}
  if(t.reference && state.purchaseInvoices.some(i=>i.number===t.reference)){toast("Delete protection: this transaction is linked to a supplier invoice. Manage it from the purchase invoice.");return}
  if(confirm("Delete this cash transaction? This action cannot be undone."))mutate(()=>state.transactions=state.transactions.filter(x=>x.id!==id));
}
function openCustomer(id=null,onSaved=null){
  const c=id?state.customers.find(x=>x.id===id):null;
  modal(`<div class="modal-head"><h3>${c?"Edit":"Add"} Customer</h3><button class="close" data-close-modal>×</button></div><div class="form-grid"><label>Customer / Company name<input id="cName" class="input" value="${esc(c?.name||"")}" placeholder="Required"></label><label>Contact person<input id="cContact" class="input" value="${esc(c?.contactPerson||"")}"></label><label>Phone<input id="cPhone" class="input" value="${esc(c?.phone||"")}"></label><label>Email<input id="cEmail" class="input" value="${esc(c?.email||"")}"></label><label>Tax ID / VAT number<input id="cTaxId" class="input" value="${esc(c?.taxId||"")}"></label><label>Billing address<textarea id="cBilling" class="input" rows="3">${esc(c?.billingAddress||c?.address||"")}</textarea></label><label>Shipping address<textarea id="cShipping" class="input" rows="3">${esc(c?.shippingAddress||"")}</textarea></label><label>Customer notes<textarea id="cNotes" class="input" rows="3">${esc(c?.notes||"")}</textarea></label></div><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="saveCustomerBtn">Save Customer</button></div>`);
  $("#saveCustomerBtn").onclick=()=>{const obj={id:c?.id||uid("cust"),name:$("#cName").value.trim(),contactPerson:$("#cContact").value.trim(),phone:$("#cPhone").value.trim(),email:$("#cEmail").value.trim(),taxId:$("#cTaxId").value.trim(),billingAddress:$("#cBilling").value.trim(),shippingAddress:$("#cShipping").value.trim(),address:$("#cBilling").value.trim(),notes:$("#cNotes").value.trim()};if(!obj.name)return toast("Customer name is required.");mutate(()=>{if(c)Object.assign(c,obj);else state.customers.push(obj)});closeModal();if(onSaved)onSaved(obj.id)};
}
function openCustomerQuick(onSaved){
  const wrap=document.createElement("div");wrap.className="submodal";wrap.innerHTML=`<div class="submodal-card"><div class="modal-head"><h3>Add Customer</h3><button class="close" id="closeQuickCustomer">×</button></div><div class="form-grid"><label>Customer / Company name<input id="qcName" class="input" placeholder="Required"></label><label>Contact person<input id="qcContact" class="input"></label><label>Phone<input id="qcPhone" class="input"></label><label>Email<input id="qcEmail" class="input"></label><label>Tax ID<input id="qcTax" class="input"></label><label>Billing address<textarea id="qcBilling" class="input" rows="2"></textarea></label></div><div class="modal-footer"><button class="btn btn-outline" id="cancelQuickCustomer">Cancel</button><button class="btn btn-primary" id="saveQuickCustomer">Save customer</button></div></div>`;$("#modalCard").appendChild(wrap);
  const close=()=>wrap.remove();$("#closeQuickCustomer").onclick=close;$("#cancelQuickCustomer").onclick=close;
  $("#saveQuickCustomer").onclick=()=>{const item={id:uid("cust"),name:$("#qcName").value.trim(),contactPerson:$("#qcContact").value.trim(),phone:$("#qcPhone").value.trim(),email:$("#qcEmail").value.trim(),taxId:$("#qcTax").value.trim(),billingAddress:$("#qcBilling").value.trim(),shippingAddress:"",address:$("#qcBilling").value.trim(),notes:""};if(!item.name)return toast("Customer name is required.");mutate(()=>state.customers.push(item));const select=$("#sCustomer");if(select){select.insertAdjacentHTML("beforeend",`<option value="${item.id}">${esc(item.name)}</option>`);select.value=item.id}close();onSaved&&onSaved(item.id)};
}
function deleteCustomer(id){
  const c=state.customers.find(x=>x.id===id); if(!c)return;
  const linked=allDocuments().filter(d=>d.customerId===id);
  if(linked.length){toast("Delete protection: this customer has sales documents. Keep the customer record for CRM history.");return}
  if(confirm(`Delete customer ${c.name}? This action cannot be undone.`))mutate(()=>state.customers=state.customers.filter(x=>x.id!==id));
}
function deleteDocument(type,id){
  const collection=type==="Invoice"?state.invoices:type==="Estimate"?state.estimates:state.proformas;
  const d=collection.find(x=>x.id===id); if(!d)return;
  if(type==="Invoice"){
    if(state.waybills.some(w=>w.sourceType==="invoice"&&w.sourceId===d.id)){toast("Delete protection: this invoice is linked to a waybill. Keep it for delivery history.");return;}
    if(Number(d.paid||0)>0 || d.delivered || d.stockDeducted || d.reserved){
      toast("Delete protection: paid, reserved or delivered invoices cannot be deleted. Keep them for audit history.");return;
    }
    const linkedTx=state.transactions.some(t=>t.reference===d.number);
    if(linkedTx){toast("Delete protection: this invoice has linked transactions.");return;}
  }
  const message=type==="Invoice"?`Delete unpaid invoice ${d.number}?`:type==="Estimate"?`Delete quotation ${d.number}?`:`Delete proforma invoice ${d.number}?`;
  if(!confirm(`${message}\n\nFirst confirmation: continue?`))return;
  if(!confirm(`FINAL CONFIRMATION\n\nYou are about to permanently delete ${d.number}.\nThis action cannot be undone.\n\nPress OK only if you are certain.`))return;
  mutate(()=>{
    if(type==="Invoice")state.invoices=state.invoices.filter(x=>x.id!==id);
    else if(type==="Estimate")state.estimates=state.estimates.filter(x=>x.id!==id);
    else state.proformas=state.proformas.filter(x=>x.id!==id);
  });
}
function printInvoice(id,receipt){return printDocument(id,receipt)}
function findDocument(id){return state.invoices.find(x=>x.id===id)||state.estimates.find(x=>x.id===id)||state.proformas.find(x=>x.id===id)}
async function waitForPrintAssets(){
  const images=[...document.querySelectorAll("#printArea img")];
  await Promise.all(images.map(img=>new Promise(resolve=>{
    if(img.complete && img.naturalWidth>0){resolve();return}
    const done=()=>{img.removeEventListener("load",done);img.removeEventListener("error",done);resolve()};
    img.addEventListener("load",done,{once:true});img.addEventListener("error",done,{once:true});
  })));
  if(document.fonts?.ready) try{await document.fonts.ready}catch(e){}
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
}
async function printDocument(id,receipt=false){
  const i=findDocument(id);if(!i)return;const s=state.settings;
  const isInvoice=state.invoices.some(x=>x.id===id),isEstimate=state.estimates.some(x=>x.id===id);
  const type=isInvoice?"SALES INVOICE":isEstimate?"QUOTATION / ESTIMATE":"PROFORMA INVOICE";
  const validUntil=i.validUntil || ((!isInvoice) ? addDays(i.date || today(), Number(s.documentValidityDays||7)) : "");
  const rows=i.items.map((x,index)=>{const p=state.products.find(p=>p.id===x.productId);return `<tr><td class="print-line-no">${String(index+1).padStart(2,"0")}</td><td><strong>${esc(p?.name||"Item")}</strong><small>${esc(p?.category||"")}</small></td><td>${esc(p?.sku||"—")}</td><td class="num">${x.qty}</td><td class="num">${money(x.price)}</td><td class="num"><strong>${money(x.qty*x.price)}</strong></td></tr>`}).join("");
  const customerAddress=i.customerBillingAddress||"",shipping=i.customerShippingAddress||"";
  const taxes=(i.taxEnabled===false||s.taxEnabled===false?[]:(i.taxLines||taxBreakdown(documentTaxBase(i),s.taxCategories))).map(t=>`<div><span>${esc(t.name)} (${t.rate}%)</span><strong>${money(t.amount)}</strong></div>`).join("");
  const paid=Number(i.paid||0),balance=Math.max(0,Number(i.total||0)-paid),reserved=!i.delivered&&!i.stockDeducted&&paid>0;
  $("#printArea").innerHTML=`<div class="print-document modern-document ${receipt?"receipt-document":""}">
    <div class="modern-print-head"><div class="modern-company"><img src="assets/elitevolt-logo.png"><div><h1>${esc(s.name)}</h1><p>${esc(s.address||"")}</p><p>${esc(s.phone||"")}${s.email?` · ${esc(s.email)}`:""}</p><p>${s.companyReg?`Reg. ${esc(s.companyReg)}`:""}${s.tax?` · Tax ID ${esc(s.tax)}`:""}</p></div></div><div class="modern-doc-ref"><span>${receipt?"PAYMENT RECEIPT":type}</span><strong>${esc(i.number)}</strong><small>Issued ${esc(i.date||"")}${validUntil?` · Valid to ${esc(validUntil)}`:""}</small></div></div>
    <div class="modern-accent"></div>
    <div class="modern-address-grid"><div class="modern-address"><span class="print-eyebrow">${isInvoice?"BILL TO":"PREPARED FOR"}</span><strong>${esc(i.customerName||"Customer not specified")}</strong>${i.customerContactPerson?`<span>${esc(i.customerContactPerson)}</span>`:""}${customerAddress?`<span>${esc(customerAddress)}</span>`:""}${i.customerPhone?`<span>${esc(i.customerPhone)}</span>`:""}${i.customerEmail?`<span>${esc(i.customerEmail)}</span>`:""}${i.customerTaxId?`<span>Tax ID: ${esc(i.customerTaxId)}</span>`:""}</div><div class="modern-address"><span class="print-eyebrow">${shipping?"DELIVER TO":"DOCUMENT DETAILS"}</span>${shipping?`<strong>${esc(i.customerName||"")}</strong><span>${esc(shipping)}</span>`:`<strong>${esc(reserved?"Reserved for delivery":i.status||"Quotation")}</strong>`}${isInvoice?`<span>Amount paid: ${money(paid)}</span><span>Balance due: ${money(balance)}</span>`:""}${i.sourceDocumentNumber?`<span>Based on ${esc(i.sourceDocumentNumber)}</span>`:""}</div></div>
    <table class="print-table modern-table"><thead><tr><th>#</th><th>Description</th><th>SKU</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody>${rows||`<tr><td colspan="6">No line items</td></tr>`}</tbody></table>
    <div class="modern-summary"><div class="modern-terms">${s.paymentTerms?`<div class="print-note"><strong>Payment terms</strong><div>${esc(s.paymentTerms)}</div></div>`:""}${s.salesContract?`<div class="print-note"><strong>Sales terms</strong><div>${esc(s.salesContract)}</div></div>`:""}${i.note?`<div class="print-note"><strong>Notes</strong><div>${esc(i.note)}</div></div>`:""}${s.bankDetails?`<div class="print-note"><strong>Payment details</strong><div>${esc(s.bankDetails)}</div></div>`:""}</div><div class="print-total modern-total"><div><span>Subtotal</span><strong>${money(i.subtotal)}</strong></div><div><span>Discount</span><strong>− ${money(i.discount)}</strong></div>${Number(i.deliveryCharge||0)?`<div><span>Delivery</span><strong>${money(i.deliveryCharge)}</strong></div>`:""}${Number(i.laborCharge||0)?`<div><span>Installation / labour</span><strong>${money(i.laborCharge)}</strong></div>`:""}${taxes}<div class="grand"><span>${receipt?"AMOUNT RECEIVED":"TOTAL DUE"}</span><strong>${money(receipt?paid:i.total)}</strong></div>${isInvoice&&!receipt?`<div class="balance-row"><span>Amount paid</span><strong>${money(paid)}</strong></div><div class="balance-row"><span>Balance due</span><strong>${money(balance)}</strong></div>`:""}</div></div>
    <div class="print-sign"><div>Prepared by <span></span></div><div>Customer acknowledgement <span></span></div></div>
    <div class="print-footer"><span>${esc(s.footer)}</span><span>${esc(s.name)} · ${esc(i.number)}</span></div>
  </div>`;
  await waitForPrintAssets();
  window.print();
}

async function printPurchase(kind,id){
  const invoice=kind==="invoice",doc=(invoice?state.purchaseInvoices:state.purchaseOrders).find(x=>x.id===id);if(!doc)return;const s=state.settings;
  const rows=doc.items.map((x,index)=>{const p=state.products.find(y=>y.id===x.productId);return `<tr><td class="print-line-no">${String(index+1).padStart(2,"0")}</td><td><strong>${esc(p?.name||"Item")}</strong><small>${esc(p?.sku||"")}</small></td><td class="num">${x.qty}</td><td class="num">${money(x.cost)}</td><td class="num">${money(x.qty*x.cost)}</td></tr>`}).join("");
  const balance=Math.max(0,Number(doc.total||0)-Number(doc.paid||0));
  $("#printArea").innerHTML=`<div class="print-document modern-document"><div class="modern-print-head"><div class="modern-company"><img src="assets/elitevolt-logo.png"><div><h1>${esc(s.name)}</h1><p>${esc(s.address||"")}</p><p>${esc(s.phone||"")}${s.email?` · ${esc(s.email)}`:""}</p></div></div><div class="modern-doc-ref"><span>${invoice?"PURCHASE INVOICE":"PURCHASE ORDER"}</span><strong>${esc(doc.number)}</strong><small>${invoice?`Supplier ref. ${esc(doc.reference||"—")}`:`Date ${esc(doc.date||"")}`}</small></div></div><div class="modern-accent"></div><div class="modern-address-grid"><div class="modern-address"><span class="print-eyebrow">SUPPLIER</span><strong>${esc(doc.supplierName||"Supplier")}</strong>${doc.supplierContactPerson?`<span>${esc(doc.supplierContactPerson)}</span>`:""}${doc.supplierAddress?`<span>${esc(doc.supplierAddress)}</span>`:""}${doc.supplierPhone?`<span>${esc(doc.supplierPhone)}</span>`:""}${doc.supplierEmail?`<span>${esc(doc.supplierEmail)}</span>`:""}${doc.supplierTaxId?`<span>Tax ID: ${esc(doc.supplierTaxId)}</span>`:""}</div><div class="modern-address"><span class="print-eyebrow">${invoice?"BILL DETAILS":"DELIVER TO"}</span><strong>${esc(s.name)}</strong><span>${esc(s.address||"")}</span><span>${invoice?`Invoice date: ${esc(doc.date||"")}`:`Expected: ${esc(doc.date||"")}`}</span>${invoice&&doc.dueDate?`<span>Due date: ${esc(doc.dueDate)}</span>`:""}<span>Status: ${esc(doc.status||"Draft")}</span>${doc.sourceOrderId?`<span>Purchase order: ${esc(state.purchaseOrders.find(x=>x.id===doc.sourceOrderId)?.number||"")}</span>`:""}</div></div><table class="print-table modern-table"><thead><tr><th>#</th><th>Description</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="modern-summary"><div class="modern-terms">${doc.note?`<div class="print-note"><strong>Notes</strong><div>${esc(doc.note)}</div></div>`:""}${doc.instructions?`<div class="print-note"><strong>Delivery instructions</strong><div>${esc(doc.instructions)}</div></div>`:""}</div><div class="print-total modern-total"><div><span>Subtotal</span><strong>${money(doc.subtotal)}</strong></div><div><span>Discount</span><strong>− ${money(doc.discount)}</strong></div>${Number(doc.otherCharges||0)?`<div><span>Other charges</span><strong>${money(doc.otherCharges)}</strong></div>`:""}${Number(doc.tax||0)?`<div><span>Supplier tax / duty</span><strong>${money(doc.tax)}</strong></div>`:""}<div class="grand"><span>${invoice?"INVOICE TOTAL":"ORDER TOTAL"}</span><strong>${money(doc.total)}</strong></div>${invoice?`<div class="balance-row"><span>Paid</span><strong>${money(doc.paid||0)}</strong></div><div class="balance-row"><span>Balance due</span><strong>${money(balance)}</strong></div>`:""}</div></div><div class="print-sign"><div>Authorized by <span></span></div><div>Supplier acknowledgement <span></span></div></div><div class="print-footer"><span>${esc(s.footer)}</span><span>${esc(s.name)} · ${esc(doc.number)}</span></div></div>`;
  await waitForPrintAssets();window.print();
}
async function printWaybill(id){
  const wb=state.waybills.find(x=>x.id===id);if(!wb)return;const s=state.settings;
  const rows=wb.items.map((x,index)=>{const p=state.products.find(y=>y.id===x.productId);return `<tr><td class="print-line-no">${String(index+1).padStart(2,"0")}</td><td><strong>${esc(p?.name||"Item")}</strong><small>${esc(p?.sku||"")}</small></td><td class="num">${x.qty}</td><td class="num">${Number(x.handledQty||0)}</td><td></td></tr>`}).join("");
  $("#printArea").innerHTML=`<div class="print-document modern-document"><div class="modern-print-head"><div class="modern-company"><img src="assets/elitevolt-logo.png"><div><h1>${esc(s.name)}</h1><p>${esc(s.address||"")}</p><p>${esc(s.phone||"")}${s.email?` · ${esc(s.email)}`:""}</p></div></div><div class="modern-doc-ref"><span>${wb.direction==="incoming"?"GOODS RECEIVED NOTE":"DELIVERY WAYBILL"}</span><strong>${esc(wb.number)}</strong><small>${esc(wb.date||"")}</small></div></div><div class="modern-accent"></div><div class="modern-address-grid"><div class="modern-address"><span class="print-eyebrow">${wb.direction==="incoming"?"RECEIVED FROM":"DELIVER TO"}</span><strong>${esc(wb.partyName||"")}</strong><span>${esc(wb.carrier||"")}</span><span>${esc(wb.reference||"")}</span></div><div class="modern-address"><span class="print-eyebrow">WAYBILL DETAILS</span><strong>${esc(wb.status||"Prepared")}</strong><span>Source: ${esc(wb.sourceNumber||"Standalone")}</span>${wb.note?`<span>${esc(wb.note)}</span>`:""}</div></div><table class="print-table modern-table"><thead><tr><th>#</th><th>Goods description</th><th class="num">Qty planned</th><th class="num">Qty handled</th><th>Condition / remarks</th></tr></thead><tbody>${rows}</tbody></table><div class="waybill-signatures"><div>Dispatched / received by <span></span></div><div>Driver / carrier <span></span></div><div>Customer / storekeeper <span></span></div></div><div class="print-footer"><span>Please verify quantities and condition on receipt.</span><span>${esc(s.name)} · ${esc(wb.number)}</span></div></div>`;
  await waitForPrintAssets();window.print();
}


$("#connectDriveBtn").onclick=connectDrive;
$("#syncBtn").onclick=()=>saveToDrive();
$("#signOutBtn").onclick=()=>{const t=gapi.client.getToken();if(t)google.accounts.oauth2.revoke(t.access_token);gapi.client.setToken("");driveReady=false;driveFileId=null;driveFolderId=null;setDriveStatus("Offline");showAuth()};
$$("[data-open-product]").forEach(b=>b.onclick=()=>openProduct());
$$("[data-open-sale]").forEach(b=>b.onclick=()=>openSale());
$$("[data-open-cash]").forEach(b=>b.onclick=()=>openCash());
$$("[data-open-customer]").forEach(b=>b.onclick=()=>openCustomer());
$("#saveSettingsBtn").onclick=()=>{mutate(()=>Object.assign(state.settings,{name:$("#setName").value.trim()||"EliteVolt Systems",phone:$("#setPhone").value.trim(),email:$("#setEmail").value.trim(),address:$("#setAddress").value.trim(),tax:$("#setTax").value.trim(),prefix:$("#setPrefix").value.trim()||"EVS",currency:$("#setCurrency").value.trim()||"GH₵",footer:$("#setFooter").value.trim(),companyReg:$("#setCompanyReg").value.trim(),taxCategories:$("#setTaxCategories").value.trim(),defaultTaxRate:+$("#setDefaultTaxRate").value||0,salesContract:$("#setSalesContract").value.trim(),documentNotes:$("#setDocumentNotes").value.trim(),paymentTerms:$("#setPaymentTerms").value.trim(),bankDetails:$("#setBankDetails").value.trim(),documentValidityDays:Math.max(1,+$("#setValidityDays").value||7),taxEnabled:$("#setTaxEnabled").checked}));toast("Settings saved.")};
$("#manualBackupBtn").onclick=()=>saveToDrive();
$("#printReportBtn").onclick=()=>{
  const s=state.settings;
  $("#printArea").innerHTML=`<div class="print-document"><div class="print-head"><img src="assets/elitevolt-logo.png"><div class="print-company"><h1>${esc(s.name)}</h1><p>${esc(s.address)}</p><p>${esc(s.phone)} ${s.email?`• ${esc(s.email)}`:""}</p></div></div><div class="print-title"><h2>BUSINESS SUMMARY REPORT</h2><p>Generated ${today()}</p></div><div class="print-meta"><div class="print-box"><strong>Inventory</strong>Products: ${state.products.length}<br>Units on hand: ${state.products.reduce((a,p)=>a+Number(p.qty||0),0)}<br>Stock value: ${money(stockValue())}</div><div class="print-box"><strong>Sales</strong>Invoices: ${state.invoices.length}<br>Total sales: ${money(salesTotal())}<br>Total paid: ${money(paidTotal())}</div></div><table class="print-table"><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Qty</th><th>Stock value</th></tr></thead><tbody>${state.products.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.sku||"")}</td><td>${esc(p.category||"")}</td><td>${p.qty}</td><td>${money(p.qty*p.cost)}</td></tr>`).join("")}</tbody></table><div class="print-footer"><span>${esc(s.footer)}</span><span>${esc(s.name)}</span></div></div>`;
  waitForPrintAssets().then(()=>window.print());
};

["stockSearch","stockFilter","salesSearch","salesStatus","customerSearch","waybillSearch","waybillDirection"].forEach(id=>{const el=$("#"+id);el?.addEventListener("input",renderAll);el?.addEventListener("change",renderAll)});
window.addEventListener("load",()=>{init();$("#connectDriveBtn").disabled=true});
