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
    version: 1,
    products: [],
    customers: [],
    invoices: [],
    transactions: [],
    settings: {
      name:"EliteVolt Systems",
      phone:"",
      email:"",
      address:"",
      tax:"",
      prefix:"EVS",
      currency:"GH₵",
      footer:"Thank you for doing business with EliteVolt Systems."
    }
  };
}
function mergeState(raw){
  const base=defaultState();
  return {
    ...base,...raw,
    products:Array.isArray(raw?.products)?raw.products:[],
    customers:Array.isArray(raw?.customers)?raw.customers:[],
    invoices:Array.isArray(raw?.invoices)?raw.invoices:[],
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
  renderDashboard();renderStock();renderSales();renderCashflow();renderCustomers();renderReports();renderSettings();
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

function renderDashboard(){
  $("#mStock").textContent=money(stockValue());$("#mStockUnits").textContent=`${state.products.reduce((s,p)=>s+Number(p.qty||0),0)} units`;
  const mk=today().slice(0,7), inv=state.invoices.filter(i=>i.date.startsWith(mk));
  $("#mSales").textContent=money(inv.reduce((s,i)=>s+Number(i.total||0),0));$("#mInvoices").textContent=`${inv.length} invoices`;
  const trans=state.transactions.filter(t=>t.date.startsWith(mk));
  $("#mCashIn").textContent=money(trans.filter(t=>t.type==="in").reduce((s,t)=>s+Number(t.amount||0),0));
  $("#mCashOut").textContent=money(trans.filter(t=>t.type==="out").reduce((s,t)=>s+Number(t.amount||0),0));
  renderCashChart();renderCategoryChart();
  const low=state.products.filter(p=>Number(p.qty||0)<=Number(p.minQty||0));
  $("#lowStockList").innerHTML=low.length?low.slice(0,8).map(p=>`<div class="list-row"><div><strong>${esc(p.name)}</strong><small>${esc(p.sku||"No SKU")}</small></div><span class="badge ${p.qty<=0?"out":"part"}">${p.qty} left</span></div>`).join(""):`<div class="empty">No low-stock items.</div>`;
  const recent=[...state.invoices].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);
  $("#recentSalesList").innerHTML=recent.length?recent.map(i=>`<div class="list-row"><div><strong>${esc(i.number)}</strong><small>${esc(i.customerName||"Walk-in")} • ${esc(i.date)}</small></div><strong>${money(i.total)}</strong></div>`).join(""):`<div class="empty">No sales recorded.</div>`;
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
  const q=($("#stockSearch")?.value||"").toLowerCase(),f=$("#stockFilter")?.value||"";
  const rows=state.products.filter(p=>`${p.name} ${p.sku||""} ${p.category||""}`.toLowerCase().includes(q)).filter(p=>f==="low"?Number(p.qty)<=Number(p.minQty||0):f==="out"?Number(p.qty)<=0:true);
  $("#stockTable").innerHTML=rows.length?rows.map(p=>`<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.sku||"—")}</td><td>${esc(p.category||"—")}</td><td><span class="badge ${p.qty<=0?"out":p.qty<=p.minQty?"part":"ok"}">${p.qty}</span></td><td>${money(p.cost)}</td><td>${money(p.price)}</td><td>${money(p.qty*p.cost)}</td><td><div class="actions"><button class="icon-btn" data-edit-product="${p.id}">Edit</button><button class="icon-btn" data-adjust-product="${p.id}">Adjust</button><button class="icon-btn" data-delete-product="${p.id}">Delete</button></div></td></tr>`).join(""):`<tr><td colspan="8" class="empty">No products found.</td></tr>`;
  $$("[data-edit-product]").forEach(b=>b.onclick=()=>openProduct(b.dataset.editProduct));
  $$("[data-adjust-product]").forEach(b=>b.onclick=()=>openAdjust(b.dataset.adjustProduct));
  $$("[data-delete-product]").forEach(b=>b.onclick=()=>deleteProduct(b.dataset.deleteProduct));
}
function renderSales(){
  const q=($("#salesSearch")?.value||"").toLowerCase(),f=$("#salesStatus")?.value||"";
  const rows=[...state.invoices].sort((a,b)=>b.date.localeCompare(a.date)).filter(i=>`${i.number} ${i.customerName||""}`.toLowerCase().includes(q)).filter(i=>!f||i.status===f);
  $("#salesTable").innerHTML=rows.length?rows.map(i=>`<tr><td><strong>${esc(i.number)}</strong></td><td>${esc(i.date)}</td><td>${esc(i.customerName||"Walk-in")}</td><td>${money(i.total)}</td><td>${money(i.paid)}</td><td>${money(i.total-i.paid)}</td><td><span class="badge ${i.status==="Paid"?"paid":i.status==="Part-paid"?"part":"unpaid"}">${i.status}</span></td><td><div class="actions"><button class="icon-btn" data-print-invoice="${i.id}">Print</button><button class="icon-btn" data-receipt="${i.id}">Receipt</button><button class="icon-btn" data-delete-invoice="${i.id}">Delete</button></div></td></tr>`).join(""):`<tr><td colspan="8" class="empty">No invoices found.</td></tr>`;
  $$("[data-print-invoice]").forEach(b=>b.onclick=()=>printInvoice(b.dataset.printInvoice,false));
  $$("[data-receipt]").forEach(b=>b.onclick=()=>printInvoice(b.dataset.receipt,true));
  $$("[data-delete-invoice]").forEach(b=>b.onclick=()=>deleteInvoice(b.dataset.deleteInvoice));
}
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
  $("#customersTable").innerHTML=rows.length?rows.map(c=>`<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.phone||"—")}</td><td>${esc(c.email||"—")}</td><td>${esc(c.address||"—")}</td><td>${state.invoices.filter(i=>i.customerId===c.id).length}</td><td><div class="actions"><button class="icon-btn" data-edit-customer="${c.id}">Edit</button><button class="icon-btn" data-delete-customer="${c.id}">Delete</button></div></td></tr>`).join(""):`<tr><td colspan="6" class="empty">No customers found.</td></tr>`;
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
  const s=state.settings;$("#setName").value=s.name;$("#setPhone").value=s.phone;$("#setEmail").value=s.email;$("#setAddress").value=s.address;$("#setTax").value=s.tax;$("#setPrefix").value=s.prefix;$("#setCurrency").value=s.currency;$("#setFooter").value=s.footer;
}

function modal(content){$("#modalCard").innerHTML=content;$("#modal").classList.remove("hidden")}
function closeModal(){$("#modal").classList.add("hidden");$("#modalCard").innerHTML=""}
document.addEventListener("click",e=>{if(e.target.matches("[data-close-modal]"))closeModal()});

function openProduct(id=null){
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
  };
}
function openAdjust(id){
  const p=state.products.find(x=>x.id===id);if(!p)return;
  modal(`<div class="modal-head"><h3>Adjust Stock — ${esc(p.name)}</h3><button class="close" data-close-modal>×</button></div>
  <div class="form-stack"><label>Adjustment quantity<input id="aQty" type="number" class="input" value="0"></label><label>Reason<select id="aReason" class="input"><option>Stock received</option><option>Stock damaged</option><option>Stock count correction</option><option>Other</option></select></label><label>Note<input id="aNote" class="input"></label></div>
  <div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="adjustBtn">Apply</button></div>`);
  $("#adjustBtn").onclick=()=>{const n=+$("#aQty").value;if(!n){toast("Enter an adjustment quantity.");return}mutate(()=>{p.qty=Math.max(0,Number(p.qty)+n);state.transactions.push({id:uid("tx"),date:today(),type:n>0?"out":"out",category:"Stock adjustment",description:`${$("#aReason").value}: ${$("#aNote").value}`,amount:0,reference:p.sku||p.id})});closeModal();};
}
function deleteProduct(id){if(!confirm("Delete this product? Existing invoice history will be retained."))return;mutate(()=>state.products=state.products.filter(p=>p.id!==id))}
function nextInvoiceNumber(){const prefix=state.settings.prefix||"EVS";const year=new Date().getFullYear();const nums=state.invoices.map(i=>i.number).filter(n=>n?.startsWith(`${prefix}-${year}-`)).map(n=>+(n.split("-").pop())||0);return `${prefix}-${year}-${String(Math.max(0,...nums)+1).padStart(4,"0")}`}
function openSale(){
  if(!state.products.length){toast("Add products before creating a sale.");return}
  const customerOptions=state.customers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("");
  modal(`<div class="modal-head"><h3>New Sale / Invoice</h3><button class="close" data-close-modal>×</button></div>
  <div class="two-col"><label>Date<input id="sDate" type="date" class="input" value="${today()}"></label><label>Customer<select id="sCustomer" class="input"><option value="">Walk-in customer</option>${customerOptions}</select></label></div>
  <div style="margin-top:15px"><div class="panel-head"><h3>Items</h3><button class="btn btn-outline" id="addLine">+ Add item</button></div><div id="saleLines" class="line-items"></div></div>
  <div class="two-col" style="margin-top:14px"><label>Discount<input id="sDiscount" type="number" min="0" step=".01" class="input" value="0"></label><label>Amount paid<input id="sPaid" type="number" min="0" step=".01" class="input" value="0"></label></div>
  <div class="sale-total">Total: <span id="saleTotal" style="margin-left:8px">GH₵ 0.00</span></div>
  <div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="saveSaleBtn">Save & Print Invoice</button></div>`);
  const addLine=()=>{const row=document.createElement("div");row.className="product-line";row.innerHTML=`<select class="input line-product">${state.products.map(p=>`<option value="${p.id}">${esc(p.name)} — ${p.qty} available</option>`).join("")}</select><input class="input line-qty" type="number" min="1" value="1"><input class="input line-price" type="number" min="0" step=".01" value="0"><span class="line-sub">0.00</span><button class="icon-btn remove-line">×</button>`;$("#saleLines").appendChild(row);const sel=row.querySelector(".line-product"),price=row.querySelector(".line-price");price.value=state.products.find(p=>p.id===sel.value)?.price||0;row.oninput=updateTotal;sel.onchange=()=>{price.value=state.products.find(p=>p.id===sel.value)?.price||0;updateTotal()};row.querySelector(".remove-line").onclick=()=>{row.remove();updateTotal()};updateTotal()};
  const updateTotal=()=>{let sub=0;$$(".product-line").forEach(r=>{const v=+r.querySelector(".line-qty").value||0,p=+r.querySelector(".line-price").value||0;const s=v*p;sub+=s;r.querySelector(".line-sub").textContent=money(s)});const total=Math.max(0,sub-(+$("#sDiscount").value||0));$("#saleTotal").textContent=money(total);};
  $("#addLine").onclick=addLine;$("#sDiscount").oninput=updateTotal;addLine();
  $("#saveSaleBtn").onclick=()=>{
    const items=$$(".product-line").map(r=>({productId:r.querySelector(".line-product").value,qty:+r.querySelector(".line-qty").value,price:+r.querySelector(".line-price").value})).filter(x=>x.qty>0);
    if(!items.length)return toast("Add at least one item.");
    for(const x of items){const p=state.products.find(p=>p.id===x.productId);if(!p||x.qty>p.qty){toast(`Not enough stock for ${p?.name||"item"}.`);return}}
    const subtotal=items.reduce((s,x)=>s+x.qty*x.price,0),discount=+$("#sDiscount").value||0,total=Math.max(0,subtotal-discount),paid=Math.min(total,Math.max(0,+$("#sPaid").value||0));
    const c=state.customers.find(c=>c.id===$("#sCustomer").value);const inv={id:uid("inv"),number:nextInvoiceNumber(),date:$("#sDate").value,customerId:c?.id||"",customerName:c?.name||"Walk-in customer",customerPhone:c?.phone||"",customerAddress:c?.address||"",items,subtotal,discount,total,paid,status:paid>=total?"Paid":paid>0?"Part-paid":"Unpaid"};
    mutate(()=>{state.invoices.push(inv);items.forEach(x=>{const p=state.products.find(p=>p.id===x.productId);p.qty-=x.qty});if(paid>0)state.transactions.push({id:uid("tx"),date:inv.date,type:"in",category:"Sales",description:`Payment for ${inv.number}`,amount:paid,reference:inv.number})});closeModal();printInvoice(inv.id,false);
  };
}
function openCash(){
  modal(`<div class="modal-head"><h3>Record Cash Transaction</h3><button class="close" data-close-modal>×</button></div>
  <div class="form-stack"><label>Date<input id="tDate" type="date" class="input" value="${today()}"></label><label>Type<select id="tType" class="input"><option value="in">Cash in</option><option value="out">Cash out</option></select></label><label>Category<input id="tCat" class="input" placeholder="e.g. Purchase, Transport, Utilities"></label><label>Description<input id="tDesc" class="input"></label><label>Amount<input id="tAmount" type="number" min="0" step=".01" class="input"></label><label>Reference<input id="tRef" class="input"></label></div>
  <div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="saveCashBtn">Save Transaction</button></div>`);
  $("#saveCashBtn").onclick=()=>{const a=+$("#tAmount").value;if(a<=0)return toast("Enter an amount.");mutate(()=>state.transactions.push({id:uid("tx"),date:$("#tDate").value,type:$("#tType").value,category:$("#tCat").value.trim(),description:$("#tDesc").value.trim(),amount:a,reference:$("#tRef").value.trim()}));closeModal()};
}
function deleteCash(id){if(confirm("Delete this transaction?"))mutate(()=>state.transactions=state.transactions.filter(t=>t.id!==id))}
function openCustomer(id=null){
  const c=id?state.customers.find(x=>x.id===id):null;
  modal(`<div class="modal-head"><h3>${c?"Edit":"Add"} Customer</h3><button class="close" data-close-modal>×</button></div><div class="form-grid"><label>Name<input id="cName" class="input" value="${esc(c?.name||"")}"></label><label>Phone<input id="cPhone" class="input" value="${esc(c?.phone||"")}"></label><label>Email<input id="cEmail" class="input" value="${esc(c?.email||"")}"></label><label>Address<input id="cAddress" class="input" value="${esc(c?.address||"")}"></label></div><div class="modal-footer"><button class="btn btn-outline" data-close-modal>Cancel</button><button class="btn btn-primary" id="saveCustomerBtn">Save Customer</button></div>`);
  $("#saveCustomerBtn").onclick=()=>{const obj={id:c?.id||uid("cust"),name:$("#cName").value.trim(),phone:$("#cPhone").value.trim(),email:$("#cEmail").value.trim(),address:$("#cAddress").value.trim()};if(!obj.name)return toast("Customer name is required.");mutate(()=>{if(c)Object.assign(c,obj);else state.customers.push(obj)});closeModal()}
}
function deleteCustomer(id){if(confirm("Delete this customer? Invoice history will remain."))mutate(()=>state.customers=state.customers.filter(c=>c.id!==id))}
function deleteInvoice(id){if(!confirm("Delete this invoice? Stock will NOT be restored automatically. Use a stock adjustment if needed."))return;mutate(()=>{const i=state.invoices.find(x=>x.id===id);if(i?.paid)state.transactions=state.transactions.filter(t=>t.reference!==i.number);state.invoices=state.invoices.filter(x=>x.id!==id)})}

function printInvoice(id,receipt){
  const i=state.invoices.find(x=>x.id===id);if(!i)return;const s=state.settings;
  const rows=i.items.map(x=>{const p=state.products.find(p=>p.id===x.productId);return `<tr><td>${esc(p?.name||"Item")}</td><td>${esc(p?.sku||"")}</td><td>${x.qty}</td><td>${money(x.price)}</td><td>${money(x.qty*x.price)}</td></tr>`}).join("");
  $("#printArea").innerHTML=`<div class="print-document">
    <div class="print-head"><img src="assets/elitevolt-logo.png"><div class="print-company"><h1>${esc(s.name)}</h1><p>${esc(s.address)}</p><p>${esc(s.phone)} ${s.email?`• ${esc(s.email)}`:""}</p><p>${s.tax?`Tax/VAT: ${esc(s.tax)}`:""}</p></div></div>
    <div class="print-title"><h2>${receipt?"PAYMENT RECEIPT":"SALES INVOICE"}</h2><p>${esc(i.number)} • ${esc(i.date)}</p></div>
    <div class="print-meta"><div class="print-box"><strong>Bill to</strong>${esc(i.customerName)}<br>${esc(i.customerAddress||"")}${i.customerPhone?`<br>${esc(i.customerPhone)}`:""}</div><div class="print-box"><strong>Payment</strong>Status: ${esc(i.status)}<br>Amount paid: ${money(i.paid)}<br>Balance: ${money(i.total-i.paid)}</div></div>
    <table class="print-table"><thead><tr><th>Description</th><th>SKU</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="print-total"><div><span>Subtotal</span><strong>${money(i.subtotal)}</strong></div><div><span>Discount</span><strong>${money(i.discount)}</strong></div><div class="grand"><span>Total</span><strong>${money(i.total)}</strong></div></div>
    <div class="print-sign"><div>Prepared by</div><div>Customer acknowledgement</div></div>
    <div class="print-footer"><span>${esc(s.footer)}</span><span>${esc(s.name)}</span></div>
  </div>`;
  setTimeout(()=>window.print(),100);
}

$("#connectDriveBtn").onclick=connectDrive;
$("#syncBtn").onclick=()=>saveToDrive();
$("#signOutBtn").onclick=()=>{const t=gapi.client.getToken();if(t)google.accounts.oauth2.revoke(t.access_token);gapi.client.setToken("");driveReady=false;driveFileId=null;driveFolderId=null;setDriveStatus("Offline");showAuth()};
$$("[data-open-product]").forEach(b=>b.onclick=()=>openProduct());
$$("[data-open-sale]").forEach(b=>b.onclick=()=>openSale());
$$("[data-open-cash]").forEach(b=>b.onclick=()=>openCash());
$$("[data-open-customer]").forEach(b=>b.onclick=()=>openCustomer());
$("#saveSettingsBtn").onclick=()=>{mutate(()=>Object.assign(state.settings,{name:$("#setName").value.trim()||"EliteVolt Systems",phone:$("#setPhone").value.trim(),email:$("#setEmail").value.trim(),address:$("#setAddress").value.trim(),tax:$("#setTax").value.trim(),prefix:$("#setPrefix").value.trim()||"EVS",currency:$("#setCurrency").value.trim()||"GH₵",footer:$("#setFooter").value.trim()}));toast("Settings saved.")};
$("#manualBackupBtn").onclick=()=>saveToDrive();
$("#printReportBtn").onclick=()=>{
  const s=state.settings;
  $("#printArea").innerHTML=`<div class="print-document"><div class="print-head"><img src="assets/elitevolt-logo.png"><div class="print-company"><h1>${esc(s.name)}</h1><p>${esc(s.address)}</p><p>${esc(s.phone)} ${s.email?`• ${esc(s.email)}`:""}</p></div></div><div class="print-title"><h2>BUSINESS SUMMARY REPORT</h2><p>Generated ${today()}</p></div><div class="print-meta"><div class="print-box"><strong>Inventory</strong>Products: ${state.products.length}<br>Units on hand: ${state.products.reduce((a,p)=>a+Number(p.qty||0),0)}<br>Stock value: ${money(stockValue())}</div><div class="print-box"><strong>Sales</strong>Invoices: ${state.invoices.length}<br>Total sales: ${money(salesTotal())}<br>Total paid: ${money(paidTotal())}</div></div><table class="print-table"><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Qty</th><th>Stock value</th></tr></thead><tbody>${state.products.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.sku||"")}</td><td>${esc(p.category||"")}</td><td>${p.qty}</td><td>${money(p.qty*p.cost)}</td></tr>`).join("")}</tbody></table><div class="print-footer"><span>${esc(s.footer)}</span><span>${esc(s.name)}</span></div></div>`;
  setTimeout(()=>window.print(),100);
};

["stockSearch","stockFilter","salesSearch","salesStatus","customerSearch"].forEach(id=>{const el=$("#"+id);el?.addEventListener("input",renderAll);el?.addEventListener("change",renderAll)});
window.addEventListener("load",()=>{init();$("#connectDriveBtn").disabled=true});
