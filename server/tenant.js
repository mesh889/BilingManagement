'use strict';

/**
 * Tenant + Property + Rent/Expense management module for Express + sqlite3.
 * Register from index.js with:
 *   require('./tenantRentManagement')(app, db);
 *
 * Tables: properties, tenants, entries
 * Financial entries are soft-deleted by marking them VOID.
 */
module.exports = function registerTenantRentManagement(app, db, options = {}) {
  if (!app || !db) throw new Error('app and db are required');
  const BASE = options.basePath || '/api/tenant';

  // Adapter for the existing better-sqlite3 connection used by the billing server.
  const run = async (sql, p=[]) => { const r = db.prepare(sql).run(...p); return { lastID: Number(r.lastInsertRowid || 0), changes: r.changes }; };
  const get = async (sql,p=[]) => db.prepare(sql).get(...p) || null;
  const all = async (sql,p=[]) => db.prepare(sql).all(...p);
  const exec = async sql => { db.exec(sql); };
  const fail = (message,statusCode=400) => { const e=new Error(message); e.statusCode=statusCode; return e; };
  const id = v => { const n=Number(v); if(!Number.isInteger(n)||n<1) throw fail('Invalid ID.'); return n; };
  const money = (v,name='amount') => { const n=Number(v); if(!Number.isFinite(n)||n<=0) throw fail(`${name} must be greater than 0.`); return Math.round(n*100)/100; };
  const date = (v,name='date') => { if(!v||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(v))) throw fail(`${name} must be YYYY-MM-DD.`); const d=new Date(`${v}T00:00:00Z`); if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==v) throw fail(`Invalid ${name}.`); return v; };
  const optDate = (v,n) => v==null||v===''?null:date(v,n);
  const month = v => { v=v||new Date().toISOString().slice(0,7); if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw fail('month must be YYYY-MM.'); return v; };
  const year = v => { v=String(v||new Date().getUTCFullYear()); if(!/^\d{4}$/.test(v)) throw fail('year must be YYYY.'); return v; };
  const status = (v,allowed,def) => { v=String(v||def).toUpperCase(); if(!allowed.includes(v)) throw fail(`Invalid status. Allowed: ${allowed.join(', ')}.`); return v; };
  const asyncRoute = fn => (req,res)=>Promise.resolve(fn(req,res)).catch(e=>{ console.error('[tenantRentManagement]',e); res.status(e.statusCode||500).json({success:false,message:e.message||'Internal server error'}); });
  const like = v => `%${String(v).trim()}%`;
  const types=['COLLECTION','EXPENSE'];
  const categories={COLLECTION:['RENT_COLLECTION'],EXPENSE:['MAINTENANCE','DEPOSIT_RETURN','PAINTING','OTHER_EXPENSE']};
  const paymentModes=['CASH','BANK','UPI','OTHER'];
  const entryType=v=>{v=String(v||'').toUpperCase();if(!types.includes(v))throw fail('entry_type must be COLLECTION or EXPENSE.');return v;};
  const category=(t,v)=>{v=String(v||'').toUpperCase();if(!categories[t].includes(v))throw fail(`Invalid category for ${t}.`);return v;};
  const payment=v=>{if(v==null||v==='')return null;v=String(v).toUpperCase();if(!paymentModes.includes(v))throw fail('Invalid payment_mode.');return v;};

  async function init(){
    await exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS properties(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_code TEXT NOT NULL UNIQUE,
        property_name TEXT NOT NULL,
        location TEXT NOT NULL,
        property_details TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','INACTIVE')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS tenants(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_name TEXT NOT NULL,
        tenant_phone TEXT,
        tenant_email TEXT,
        property_id INTEGER NOT NULL,
        deposit_amount NUMERIC NOT NULL DEFAULT 0,
        agreement_start_date TEXT NOT NULL,
        agreement_end_date TEXT,
        rent_amount NUMERIC NOT NULL CHECK(rent_amount>=0),
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','ENDED','INACTIVE')),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(property_id) REFERENCES properties(id)
      );
      CREATE TABLE IF NOT EXISTS entries(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id TEXT NOT NULL UNIQUE,
        entry_date TEXT NOT NULL,
        entry_type TEXT NOT NULL CHECK(entry_type IN('COLLECTION','EXPENSE')),
        property_id INTEGER NOT NULL,
        tenant_id INTEGER,
        category TEXT NOT NULL,
        amount NUMERIC NOT NULL CHECK(amount>0),
        payment_mode TEXT,
        reference_no TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'POSTED' CHECK(status IN('POSTED','VOID')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(property_id) REFERENCES properties(id),
        FOREIGN KEY(tenant_id) REFERENCES tenants(id)
      );
      CREATE INDEX IF NOT EXISTS idx_tenants_property ON tenants(property_id);
      CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
      CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(entry_date);
      CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(entry_type);
      CREATE INDEX IF NOT EXISTS idx_entries_property ON entries(property_id);
      CREATE INDEX IF NOT EXISTS idx_entries_tenant ON entries(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);`);
  }

  const ensureProperty=async(pid,active=false)=>{const r=await get('SELECT * FROM properties WHERE id=?',[id(pid)]);if(!r)throw fail('Property not found.',404);if(active&&r.status!=='ACTIVE')throw fail('Selected property is inactive.');return r;};
  const ensureTenant=async(tid,active=false)=>{const r=await get('SELECT * FROM tenants WHERE id=?',[id(tid)]);if(!r)throw fail('Tenant not found.',404);if(active&&r.status!=='ACTIVE')throw fail('Selected tenant is inactive.');return r;};
  const ensureTenantProperty=async(tid,pid)=>{const t=await ensureTenant(tid,true);if(Number(t.property_id)!==Number(pid))throw fail('Tenant does not belong to selected property.');return t;};
  const txnId=()=>`TXN-${new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)}-${Math.floor(1000+Math.random()*9000)}`;
  async function newTxnId(){for(let i=0;i<20;i++){const x=txnId();if(!await get('SELECT id FROM entries WHERE transaction_id=?',[x]))return x;}throw new Error('Could not generate transaction ID.');}

  // ---------------- Properties ----------------
  app.get(`${BASE}/properties`,asyncRoute(async(req,res)=>{
    const w=[],p=[]; if(req.query.status){w.push('p.status=?');p.push(status(req.query.status,['ACTIVE','INACTIVE'],'ACTIVE'));}
    if(req.query.search){const q=like(req.query.search);w.push('(p.property_name LIKE ? OR p.property_code LIKE ? OR p.location LIKE ?)');p.push(q,q,q);}
    const ws=w.length?'WHERE '+w.join(' AND '):''; const total=(await get(`SELECT COUNT(*) total FROM properties p ${ws}`,p)).total;
    const rows=await all(`SELECT p.*,(SELECT COUNT(*) FROM tenants t WHERE t.property_id=p.id AND t.status='ACTIVE') active_tenant_count FROM properties p ${ws} ORDER BY p.id DESC`,p);
    res.json({success:true,data:rows,total});
  }));
  app.get(`${BASE}/properties/:id`,asyncRoute(async(req,res)=>{const pid=id(req.params.id);const p=await ensureProperty(pid);const tenants=await all('SELECT * FROM tenants WHERE property_id=? ORDER BY status,tenant_name',[pid]);res.json({success:true,data:{...p,tenants}});}));
  app.post(`${BASE}/properties`,asyncRoute(async(req,res)=>{
    const b=req.body||{};if(!String(b.property_name||'').trim())throw fail('property_name is required.');if(!String(b.location||'').trim())throw fail('location is required.');
    const code=String(b.property_code||`PROP-${Date.now()}`).trim();const s=status(b.status,['ACTIVE','INACTIVE'],'ACTIVE');
    try{const r=await run('INSERT INTO properties(property_code,property_name,location,property_details,status) VALUES(?,?,?,?,?)',[code,String(b.property_name).trim(),String(b.location).trim(),b.property_details||null,s]);res.status(201).json({success:true,data:await get('SELECT * FROM properties WHERE id=?',[r.lastID])});}catch(e){if(String(e.message).includes('UNIQUE constraint failed'))e.statusCode=409;throw e;}
  }));
  app.put(`${BASE}/properties/:id`,asyncRoute(async(req,res)=>{const pid=id(req.params.id),old=await ensureProperty(pid),b=req.body||{};const name=b.property_name===undefined?old.property_name:String(b.property_name).trim(),loc=b.location===undefined?old.location:String(b.location).trim();if(!name||!loc)throw fail('property_name and location are required.');await run('UPDATE properties SET property_code=?,property_name=?,location=?,property_details=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[String(b.property_code===undefined?old.property_code:b.property_code).trim(),name,loc,b.property_details===undefined?old.property_details:b.property_details,status(b.status,['ACTIVE','INACTIVE'],old.status),pid]);res.json({success:true,data:await get('SELECT * FROM properties WHERE id=?',[pid])});}));
  app.delete(`${BASE}/properties/:id`,asyncRoute(async(req,res)=>{const pid=id(req.params.id);await ensureProperty(pid);await run("UPDATE properties SET status='INACTIVE',updated_at=CURRENT_TIMESTAMP WHERE id=?",[pid]);res.json({success:true,message:'Property deactivated; history preserved.'});}));

  // ---------------- Tenants ----------------
  app.get(`${BASE}/tenants`,asyncRoute(async(req,res)=>{
    const w=[],p=[];if(req.query.status){w.push('t.status=?');p.push(status(req.query.status,['ACTIVE','ENDED','INACTIVE'],'ACTIVE'));}if(req.query.property_id){w.push('t.property_id=?');p.push(id(req.query.property_id));}if(req.query.search){const q=like(req.query.search);w.push('(t.tenant_name LIKE ? OR t.tenant_phone LIKE ? OR t.tenant_email LIKE ?)');p.push(q,q,q);}const ws=w.length?'WHERE '+w.join(' AND '):'';
    const rows=await all(`SELECT t.*,p.property_name,p.property_code FROM tenants t JOIN properties p ON p.id=t.property_id ${ws} ORDER BY t.id DESC`,p);
    for(const t of rows){t.expected_rent=await expectedRent(t);const c=await get("SELECT COALESCE(SUM(amount),0) total FROM entries WHERE tenant_id=? AND entry_type='COLLECTION' AND category='RENT_COLLECTION' AND status='POSTED'",[t.id]);t.total_rent_collected=Number(c.total||0);t.overdue_amount=Math.max(0,t.expected_rent-t.total_rent_collected);}
    res.json({success:true,data:rows,total:rows.length});
  }));
  app.get(`${BASE}/tenants/:id`,asyncRoute(async(req,res)=>{const tid=id(req.params.id),t=await get('SELECT t.*,p.property_name,p.property_code,p.location FROM tenants t JOIN properties p ON p.id=t.property_id WHERE t.id=?',[tid]);if(!t)throw fail('Tenant not found.',404);t.expected_rent=await expectedRent(t);const c=await get("SELECT COALESCE(SUM(amount),0) total FROM entries WHERE tenant_id=? AND entry_type='COLLECTION' AND category='RENT_COLLECTION' AND status='POSTED'",[tid]);t.total_rent_collected=Number(c.total||0);t.overdue_amount=Math.max(0,t.expected_rent-t.total_rent_collected);t.entries=await all('SELECT e.*,p.property_name FROM entries e JOIN properties p ON p.id=e.property_id WHERE e.tenant_id=? ORDER BY e.entry_date DESC,e.id DESC',[tid]);res.json({success:true,data:t});}));
  app.post(`${BASE}/tenants`,asyncRoute(async(req,res)=>{const b=req.body||{};if(!String(b.tenant_name||'').trim())throw fail('tenant_name is required.');const p=await ensureProperty(b.property_id,true);const s=date(b.agreement_start_date,'agreement_start_date'),e=optDate(b.agreement_end_date,'agreement_end_date');if(e&&e<s)throw fail('agreement_end_date cannot be before agreement_start_date.');const r=money(b.rent_amount,'rent_amount'),d=b.deposit_amount==null||b.deposit_amount===''?0:money(b.deposit_amount,'deposit_amount');const x=await run('INSERT INTO tenants(tenant_name,tenant_phone,tenant_email,property_id,deposit_amount,agreement_start_date,agreement_end_date,rent_amount,status,notes) VALUES(?,?,?,?,?,?,?,?,?,?)',[String(b.tenant_name).trim(),b.tenant_phone||null,b.tenant_email||null,p.id,d,s,e,r,status(b.status,['ACTIVE','ENDED','INACTIVE'],'ACTIVE'),b.notes||null]);res.status(201).json({success:true,data:await get('SELECT * FROM tenants WHERE id=?',[x.lastID])});}));
  app.put(`${BASE}/tenants/:id`,asyncRoute(async(req,res)=>{const tid=id(req.params.id),old=await ensureTenant(tid),b=req.body||{},pid=b.property_id===undefined?old.property_id:id(b.property_id);await ensureProperty(pid,true);const name=b.tenant_name===undefined?old.tenant_name:String(b.tenant_name).trim(),s=b.agreement_start_date===undefined?old.agreement_start_date:date(b.agreement_start_date,'agreement_start_date'),e=b.agreement_end_date===undefined?old.agreement_end_date:optDate(b.agreement_end_date,'agreement_end_date');if(!name)throw fail('tenant_name is required.');if(e&&e<s)throw fail('agreement_end_date cannot be before agreement_start_date.');const r=b.rent_amount===undefined?Number(old.rent_amount):money(b.rent_amount,'rent_amount'),d=b.deposit_amount===undefined?Number(old.deposit_amount||0):(b.deposit_amount===''?0:money(b.deposit_amount,'deposit_amount'));await run('UPDATE tenants SET tenant_name=?,tenant_phone=?,tenant_email=?,property_id=?,deposit_amount=?,agreement_start_date=?,agreement_end_date=?,rent_amount=?,status=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[name,b.tenant_phone===undefined?old.tenant_phone:b.tenant_phone,b.tenant_email===undefined?old.tenant_email:b.tenant_email,pid,d,s,e,r,status(b.status,['ACTIVE','ENDED','INACTIVE'],old.status),b.notes===undefined?old.notes:b.notes,tid]);res.json({success:true,data:await get('SELECT * FROM tenants WHERE id=?',[tid])});}));
  app.delete(`${BASE}/tenants/:id`,asyncRoute(async(req,res)=>{const tid=id(req.params.id);await ensureTenant(tid);await run("UPDATE tenants SET status='INACTIVE',updated_at=CURRENT_TIMESTAMP WHERE id=?",[tid]);res.json({success:true,message:'Tenant deactivated; history preserved.'});}));

  // ---------------- Entries ----------------
  app.get(`${BASE}/entries`,asyncRoute(async(req,res)=>{const w=[],p=[];if(req.query.entry_type){w.push('e.entry_type=?');p.push(entryType(req.query.entry_type));}if(req.query.property_id){w.push('e.property_id=?');p.push(id(req.query.property_id));}if(req.query.tenant_id){w.push('e.tenant_id=?');p.push(id(req.query.tenant_id));}if(req.query.status){w.push('e.status=?');p.push(status(req.query.status,['POSTED','VOID'],'POSTED'));}if(req.query.month){w.push("substr(e.entry_date,1,7)=?");p.push(month(req.query.month));}if(req.query.from){w.push('e.entry_date>=?');p.push(date(req.query.from,'from'));}if(req.query.to){w.push('e.entry_date<=?');p.push(date(req.query.to,'to'));}if(req.query.category){w.push('e.category=?');p.push(String(req.query.category).toUpperCase());}const ws=w.length?'WHERE '+w.join(' AND '):'';const rows=await all(`SELECT e.*,p.property_name,p.property_code,t.tenant_name FROM entries e JOIN properties p ON p.id=e.property_id LEFT JOIN tenants t ON t.id=e.tenant_id ${ws} ORDER BY e.entry_date DESC,e.id DESC`,p);res.json({success:true,data:rows,total:rows.length});}));
  app.get(`${BASE}/entries/:id`,asyncRoute(async(req,res)=>{const r=await get('SELECT e.*,p.property_name,p.property_code,t.tenant_name FROM entries e JOIN properties p ON p.id=e.property_id LEFT JOIN tenants t ON t.id=e.tenant_id WHERE e.id=?',[id(req.params.id)]);if(!r)throw fail('Entry not found.',404);res.json({success:true,data:r});}));
  app.post(`${BASE}/entries`,asyncRoute(async(req,res)=>{const b=req.body||{},t=entryType(b.entry_type),ed=b.entry_date?date(b.entry_date,'entry_date'):new Date().toISOString().slice(0,10),pid=id(b.property_id);await ensureProperty(pid,true);const c=category(t,b.category),a=money(b.amount),pm=payment(b.payment_mode);let tid=null;if(b.tenant_id!==undefined&&b.tenant_id!==null&&b.tenant_id!==''){tid=id(b.tenant_id);await ensureTenantProperty(tid,pid);}if(t==='COLLECTION'&&c==='RENT_COLLECTION'&&!tid)throw fail('Tenant is required for rent collection.');const tx=await newTxnId();const r=await run('INSERT INTO entries(transaction_id,entry_date,entry_type,property_id,tenant_id,category,amount,payment_mode,reference_no,notes,status) VALUES(?,?,?,?,?,?,?,?,?,?,\'POSTED\')',[tx,ed,t,pid,tid,c,a,pm,b.reference_no||null,b.notes||null]);res.status(201).json({success:true,data:await get('SELECT e.*,p.property_name,p.property_code,t.tenant_name FROM entries e JOIN properties p ON p.id=e.property_id LEFT JOIN tenants t ON t.id=e.tenant_id WHERE e.id=?',[r.lastID])});}));
  app.put(`${BASE}/entries/:id`,asyncRoute(async(req,res)=>{const eid=id(req.params.id),old=await get('SELECT * FROM entries WHERE id=?',[eid]);if(!old)throw fail('Entry not found.',404);if(old.status==='VOID')throw fail('VOID entries cannot be edited.');const b=req.body||{},t=b.entry_type===undefined?old.entry_type:entryType(b.entry_type),ed=b.entry_date===undefined?old.entry_date:date(b.entry_date,'entry_date'),pid=b.property_id===undefined?old.property_id:id(b.property_id);await ensureProperty(pid,true);const c=b.category===undefined?category(t,old.category):category(t,b.category),a=b.amount===undefined?Number(old.amount):money(b.amount),pm=b.payment_mode===undefined?old.payment_mode:payment(b.payment_mode);let tid=b.tenant_id===undefined?old.tenant_id:(b.tenant_id==null||b.tenant_id===''?null:id(b.tenant_id));if(tid)await ensureTenantProperty(tid,pid);if(t==='COLLECTION'&&c==='RENT_COLLECTION'&&!tid)throw fail('Tenant is required for rent collection.');await run('UPDATE entries SET entry_date=?,entry_type=?,property_id=?,tenant_id=?,category=?,amount=?,payment_mode=?,reference_no=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[ed,t,pid,tid,c,a,pm,b.reference_no===undefined?old.reference_no:b.reference_no,b.notes===undefined?old.notes:b.notes,eid]);res.json({success:true,data:await get('SELECT e.*,p.property_name,p.property_code,t.tenant_name FROM entries e JOIN properties p ON p.id=e.property_id LEFT JOIN tenants t ON t.id=e.tenant_id WHERE e.id=?',[eid])});}));
  app.delete(`${BASE}/entries/:id`,asyncRoute(async(req,res)=>{const eid=id(req.params.id),r=await get('SELECT id,status FROM entries WHERE id=?',[eid]);if(!r)throw fail('Entry not found.',404);await run("UPDATE entries SET status='VOID',updated_at=CURRENT_TIMESTAMP WHERE id=?",[eid]);res.json({success:true,message:'Entry voided; excluded from reports but preserved in history.'});}));

  // ---------------- Dropdown/master APIs ----------------
  app.get(`${BASE}/masters`,asyncRoute(async(req,res)=>{const properties=await all("SELECT id,property_code,property_name,location FROM properties WHERE status='ACTIVE' ORDER BY property_name");const tenants=await all("SELECT id,tenant_name,property_id,rent_amount FROM tenants WHERE status='ACTIVE' ORDER BY tenant_name");res.json({success:true,data:{properties,tenants,entryTypes:types,categories,paymentModes}});}));
  app.get(`${BASE}/masters/tenants`,asyncRoute(async(req,res)=>{let sql="SELECT t.id,t.tenant_name,t.property_id,t.rent_amount,p.property_name,p.property_code FROM tenants t JOIN properties p ON p.id=t.property_id WHERE t.status='ACTIVE' AND p.status='ACTIVE'",p=[];if(req.query.property_id){sql+=' AND t.property_id=?';p.push(id(req.query.property_id));}sql+=' ORDER BY t.tenant_name';res.json({success:true,data:await all(sql,p)});}));

  // ---------------- Dashboard ----------------
  const summary=async(where,p)=>{const r=await get(`SELECT COALESCE(SUM(CASE WHEN entry_type='COLLECTION' AND status='POSTED' THEN amount ELSE 0 END),0) collection,COALESCE(SUM(CASE WHEN entry_type='EXPENSE' AND status='POSTED' THEN amount ELSE 0 END),0) expense FROM entries WHERE ${where}`,p);return {collection:Number(r.collection||0),expense:Number(r.expense||0),net:Number(r.collection||0)-Number(r.expense||0)};};
  app.get(`${BASE}/dashboard/monthly`,asyncRoute(async(req,res)=>{const m=month(req.query.month),s=await summary('substr(entry_date,1,7)=?',[m]),property_wise=await all(`SELECT p.id property_id,p.property_name,p.property_code,COALESCE(SUM(CASE WHEN e.entry_type='COLLECTION' AND e.status='POSTED' THEN e.amount ELSE 0 END),0) collection,COALESCE(SUM(CASE WHEN e.entry_type='EXPENSE' AND e.status='POSTED' THEN e.amount ELSE 0 END),0) expense FROM properties p LEFT JOIN entries e ON e.property_id=p.id AND substr(e.entry_date,1,7)=? GROUP BY p.id ORDER BY collection DESC,p.property_name`,[m]);property_wise.forEach(x=>{x.collection=Number(x.collection);x.expense=Number(x.expense);x.net=x.collection-x.expense;});const recent_entries=await all(`SELECT e.*,p.property_name,t.tenant_name FROM entries e JOIN properties p ON p.id=e.property_id LEFT JOIN tenants t ON t.id=e.tenant_id WHERE substr(e.entry_date,1,7)=? ORDER BY e.entry_date DESC,e.id DESC LIMIT 10`,[m]);res.json({success:true,data:{month:m,summary:s,property_wise,recent_entries}});}));
  app.get(`${BASE}/dashboard/yearly`,asyncRoute(async(req,res)=>{const y=year(req.query.year),s=await summary('substr(entry_date,1,4)=?',[y]),monthly=await all(`SELECT substr(entry_date,1,7) month,COALESCE(SUM(CASE WHEN entry_type='COLLECTION' AND status='POSTED' THEN amount ELSE 0 END),0) collection,COALESCE(SUM(CASE WHEN entry_type='EXPENSE' AND status='POSTED' THEN amount ELSE 0 END),0) expense FROM entries WHERE substr(entry_date,1,4)=? GROUP BY substr(entry_date,1,7) ORDER BY month`,[y]);monthly.forEach(x=>{x.collection=Number(x.collection);x.expense=Number(x.expense);x.net=x.collection-x.expense;});res.json({success:true,data:{year:y,summary:s,monthly}});}));
  app.get(`${BASE}/dashboard/property-wise`,asyncRoute(async(req,res)=>{const period=req.query.month?month(req.query.month):year(req.query.year),cond=req.query.month?"substr(e.entry_date,1,7)=?":"substr(e.entry_date,1,4)=?";const rows=await all(`SELECT p.id property_id,p.property_code,p.property_name,p.location,COALESCE(SUM(CASE WHEN e.entry_type='COLLECTION' AND e.status='POSTED' THEN e.amount ELSE 0 END),0) collection,COALESCE(SUM(CASE WHEN e.entry_type='EXPENSE' AND e.status='POSTED' THEN e.amount ELSE 0 END),0) expense FROM properties p LEFT JOIN entries e ON e.property_id=p.id AND ${cond} GROUP BY p.id ORDER BY collection DESC,p.property_name`,[period]);rows.forEach(x=>{x.collection=Number(x.collection);x.expense=Number(x.expense);x.net=x.collection-x.expense;});res.json({success:true,period,data:rows});}));

  function monthsInclusive(start,end){const a=new Date(`${start}T00:00:00Z`),b=new Date(`${end}T00:00:00Z`);if(b<a)return 0;return (b.getUTCFullYear()-a.getUTCFullYear())*12+(b.getUTCMonth()-a.getUTCMonth())+1;}
  async function expectedRent(t){let end=t.agreement_end_date||new Date().toISOString().slice(0,10);const today=new Date().toISOString().slice(0,10);if(end>today)end=today;if(end<t.agreement_start_date)return 0;return Math.round(monthsInclusive(t.agreement_start_date,end)*Number(t.rent_amount||0)*100)/100;}
  app.get(`${BASE}/dashboard/tenant-overdue`,asyncRoute(async(req,res)=>{const s=status(req.query.status,['ACTIVE','ENDED','INACTIVE'],'ACTIVE'),rows=await all(`SELECT t.*,p.property_name,p.property_code FROM tenants t JOIN properties p ON p.id=t.property_id WHERE t.status=? ORDER BY t.tenant_name`,[s]);for(const t of rows){t.expected_rent=await expectedRent(t);const c=await get("SELECT COALESCE(SUM(amount),0) total FROM entries WHERE tenant_id=? AND entry_type='COLLECTION' AND category='RENT_COLLECTION' AND status='POSTED'",[t.id]);t.total_rent_collected=Number(c.total||0);t.overdue_amount=Math.max(0,t.expected_rent-t.total_rent_collected);}rows.sort((a,b)=>b.overdue_amount-a.overdue_amount);res.json({success:true,data:rows});}));

  app.get(`${BASE}/tenant-rent/health`,asyncRoute(async(req,res)=>{await get('SELECT 1');res.json({success:true,module:'tenant-rent-management',database:'sqlite'});}));

  const ready=init().then(()=>console.log('[tenantRentManagement] tables ready')).catch(e=>console.error('[tenantRentManagement] init failed',e));
  app.tenantRentManagementReady=ready;
  return {ready,apiBasePath:BASE};
};
