// Smoke test for index.html — run:  node tests/smoke.js
// Needs Playwright (npm i -D playwright && npx playwright install chromium).
// GitHub's gist API and the cdnjs QR library are faked, so nothing leaves the machine.
const {chromium}=require('playwright');
const path=require('path'),fs=require('fs');
const FILE='file://'+path.resolve(__dirname,'..','index.html');
const QR_LIB=process.env.QR_LIB; // optional local copy of qrcode-generator 1.4.4

let failures=0;
const ok=(cond,msg)=>{console.log(`${cond?'✓':'✗'} ${msg}`);if(!cond)failures++;};

function fakeGitHub(){
  const gists={};let seq=0;
  return async route=>{
    const req=route.request(),url=new URL(req.url()),m=req.method();
    const id=url.pathname.split('/')[2];
    const json=(b,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(b)});
    if(url.pathname==='/gists'&&m==='GET')return json(Object.values(gists));
    if(url.pathname==='/gists'&&m==='POST'){const b=JSON.parse(req.postData());const g={id:'g'+(++seq),description:b.description,public:b.public,updated_at:new Date().toISOString(),files:Object.fromEntries(Object.entries(b.files).map(([k,v])=>[k,{content:v.content}]))};gists[g.id]=g;return json(g,201);}
    if(id&&m==='GET')return json(gists[id]);
    if(id&&m==='PATCH'){const b=JSON.parse(req.postData());const g=gists[id];if(b.description)g.description=b.description;if(b.files)for(const[k,v]of Object.entries(b.files))g.files[k]={content:v.content};g.updated_at=new Date().toISOString();return json(g);}
    if(id&&m==='DELETE'){delete gists[id];return route.fulfill({status:204});}
    return json({message:'not found'},404);
  };
}

(async()=>{
  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width:1100,height:1400}});
  const gh=fakeGitHub();
  await ctx.route('https://api.github.com/**',gh);
  const thirdParty=[];
  await ctx.route('https://cdnjs.cloudflare.com/**',route=>{
    if(QR_LIB&&route.request().url().includes('qrcode-generator'))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(QR_LIB,'utf8')});
    return route.abort();
  });
  await ctx.route(u=>!/^(file:|https:\/\/(api\.github\.com|cdnjs\.cloudflare\.com)|data:|about:)/.test(u.href),route=>{thirdParty.push(route.request().url());route.abort();});
  await ctx.addInitScript(()=>{try{localStorage.setItem('pru_pin','246810');localStorage.setItem('pru_gh_token','test-token');}catch(e){}});

  const pg=await ctx.newPage();const errs=[];pg.on('pageerror',e=>errs.push(e.message));
  await pg.goto(FILE);
  await pg.evaluate(()=>enterApp());

  // ── build a client and save it
  await pg.evaluate(()=>{
    S.fname='測試家庭';const d=new Date();d.setDate(d.getDate()+10);S.nreview=d.toISOString().slice(0,10);
    const m=newMember();m.insured='陳先生';m.role='父親/Father';m.dob='1990-03-01';m.annualIncome='240,000';m.debt='0';
    const mk=(t,o)=>Object.assign(newPolicy(),{type:t,currency:'HKD'},o);
    m.policies=[
      mk('critical',{planName:'「誠保一生」危疾保 (CIM3, 1-65)',premium:'18,000',sumAssured:'1,000,000',effectiveDate:'2020-01-01',paymentTerm:'25年',critDis:'127種',critExtra:'50',crit65:'1,555,000',sa65:'2,389,000',sa85:'6,000,000'}),
      mk('medical',{planName:'終身保醫療計劃 (MLP, 1-75)',ward:'私家病房',annualLimit:'不設上限',premium:'3,000',effectiveDate:'2021-01-01'}),
      mk('savings',{premium:'2,000',mode:'monthly',effectiveDate:'2024-01-01',paymentTerm:'5年',sv65:'500,000',sv75:'800,000',sv85:'1,200,000'}),
    ];
    S.members=[m];loadForm();
  });
  await pg.evaluate(()=>saveGist());await pg.waitForTimeout(300);

  // ── what GitHub sees must not contain personal data
  const stored=await pg.evaluate(()=>fetch('https://api.github.com/gists').then(r=>r.json()));
  const raw=JSON.stringify(stored);
  ok(stored.length===1,'client saved to gist');
  ok(stored[0].description.startsWith('PRU_CLIENT:e1:'),'gist description is encrypted');
  ok(!/測試家庭|陳先生|240,000|1990-03-01|CIM3/.test(raw),'no client name, income, DOB or plan in plain text on GitHub');
  ok(stored[0].public===false,'gist is not public');

  // ── list shows the decrypted name and the review reminder
  const sb=await pg.locator('#sb-list').innerText();
  ok(sb.includes('測試家庭'),'client list shows decrypted name');
  ok(/1 位客戶 30 日內要檢視/.test(sb)&&/10日後檢視/.test(sb),'review reminder shown');

  // ── reload from GitHub and compare
  const before=await pg.evaluate(()=>{collectState();return JSON.stringify(S.members);});
  await pg.evaluate(()=>{newClient(true);});
  await pg.evaluate(id=>loadGist(id),stored[0].id);await pg.waitForTimeout(300);
  const after=await pg.evaluate(()=>{collectState();return JSON.stringify(S.members);});
  if(before!==after){const a=JSON.parse(before)[0],b=JSON.parse(after)[0];for(const k of Object.keys(a))if(JSON.stringify(a[k])!==JSON.stringify(b[k]))console.log('  diff',k,k==='policies'?a[k].map((p,i)=>Object.keys(p).filter(x=>JSON.stringify(p[x])!==JSON.stringify(b[k][i][x])).map(x=>x+':'+JSON.stringify(p[x])+'→'+JSON.stringify(b[k][i][x]))):JSON.stringify(a[k])+'→'+JSON.stringify(b[k]));}
  ok(before===after,'save → load round trip keeps every field');

  // ── old plain-text record gets upgraded
  await pg.evaluate(()=>fetch('https://api.github.com/gists',{method:'POST',body:JSON.stringify({description:'PRU_CLIENT:舊客戶',public:false,files:{'client.json':{content:JSON.stringify({fname:'舊客戶',nreview:'2020-01-01',members:[]})}}})}));
  await pg.evaluate(()=>loadGists());await pg.waitForTimeout(500);
  const st2=await pg.evaluate(()=>fetch('https://api.github.com/gists').then(r=>r.json()));
  ok(st2.every(g=>g.description.startsWith('PRU_CLIENT:e1:'))&&!JSON.stringify(st2).includes('舊客戶'),'old plain-text record re-encrypted');
  ok((await pg.locator('#sb-list').innerText()).includes('已過檢視'),'overdue review flagged');

  // ── 4-digit PIN → 6-digit PIN: everything re-encrypted, old PIN forgotten
  await pg.evaluate(()=>{localStorage.setItem('pru_pin','1357');});
  // re-save the records under the 4-digit PIN to simulate an existing user
  await pg.evaluate(async()=>{const gs=await fetch('https://api.github.com/gists').then(r=>r.json());for(const g of gs){const full=await fetch('https://api.github.com/gists/'+g.id).then(r=>r.json());const fn=Object.keys(full.files)[0];const d=await decryptWithPin('246810',full.files[fn].content);await fetch('https://api.github.com/gists/'+g.id,{method:'PATCH',body:JSON.stringify({description:await encDesc({n:d.fname,r:d.nreview||''}),files:{[fn]:{content:await encryptWithPin('1357',d)}}})});}});
  await pg.evaluate(()=>enterApp());await pg.waitForSelector('#newpin-modal');
  await pg.fill('#np1','111111');await pg.fill('#np2','111111');await pg.click('#np-ok');
  ok(/太易估/.test(await pg.locator('#np-err').innerText()),'weak new PIN rejected');
  await pg.fill('#np1','802461');await pg.fill('#np2','802461');await pg.click('#np-ok');
  await pg.waitForFunction(()=>!localStorage.getItem('pru_pin_old'),null,{timeout:10000}).catch(()=>{});
  const reenc=await pg.evaluate(async()=>{const gs=await fetch('https://api.github.com/gists').then(r=>r.json());const out=[];for(const g of gs){const full=await fetch('https://api.github.com/gists/'+g.id).then(r=>r.json());const c=Object.values(full.files)[0].content;try{await decryptWithPin('802461',c);out.push(true);}catch(e){out.push(false);}}return out;});
  ok(reenc.length===2&&reenc.every(Boolean),'all records re-encrypted with the new 6-digit PIN');
  ok(await pg.evaluate(()=>localStorage.getItem('pru_pin')==='802461'&&!localStorage.getItem('pru_pin_old')),'old PIN forgotten after re-encryption');
  ok((await pg.locator('#sb-list').innerText()).includes('測試家庭'),'client list readable with the new PIN');

  // ── transfer QR must not call a third-party service
  await pg.evaluate(()=>openTransfer());await pg.waitForTimeout(300);
  ok(!thirdParty.some(u=>u.includes('qrserver')),'transfer code not sent to a QR website');
  if(QR_LIB)ok((await pg.locator('#qr-img').getAttribute('src')||'').startsWith('data:image'),'QR drawn locally');
  await pg.evaluate(()=>closeTransfer());

  // ── product table + 方案總結 prefill
  ok(await pg.evaluate(()=>Object.keys(CRIT_DEFAULTS).length===4),'critical illness defaults built from 產品資料表');
  const pre=await pg.evaluate(()=>{const mk=(t,o)=>Object.assign(newPolicy(),{type:t,currency:'HKD'},o);const m=newMember();
    m.policies=[mk('critical',{planName:'「誠保一生」危疾保 (CIM3, 1-65)'}),mk('critical',{planName:'「自主健康」危疾保 (ECI, 1-65)'}),mk('medical',{})];return genSummaryText(m);});
  ok(/儲蓄型危疾同消費型危疾/.test(pre.sumCost)&&/每5年調整保費/.test(pre.sumCost),'方案付出 prefill uses plan types');
  ok(/轉為一份免核保嘅儲蓄型危疾/.test(pre.advice),'Lily建議 prefill suggests conversion for 自主健康');

  // ── printed report
  await pg.evaluate(id=>loadGist(id),stored[0].id);await pg.waitForTimeout(300);
  const [pop]=await Promise.all([ctx.waitForEvent('page'),pg.evaluate(()=>doPrint())]);
  pop.on('pageerror',e=>errs.push('report: '+e.message));
  await pop.waitForTimeout(800);
  const rep=await pop.locator('#pdf-content').innerText();
  ok(/危疾保額\s*HKD 1,000,000/.test(rep)&&/危疾保額（頭10年）\s*HKD 1,500,000/.test(rep),'保障總覽 shows base and first-10-year sum assured');
  ok(/65歲保額\*/.test(rep)&&/85歲保額\*/.test(rep),'sum assured by age printed');
  ok(rep.indexOf('醫療')<rep.indexOf('危疾保障詳情'),'policies grouped by type (medical before critical)');
  ok(!/投保人: —/.test(rep),'empty owner/beneficiary hidden');
  ok(/參考匯率：USD 7.78/.test(rep),'footer lists the reference FX rates');
  if(process.env.SHOT)await pop.screenshot({path:process.env.SHOT,fullPage:true});

  ok(errs.length===0,'no page errors'+(errs.length?': '+errs.join(' | '):''));
  await browser.close();
  console.log(failures?`\n${failures} check(s) failed`:'\nAll checks passed');
  process.exit(failures?1:0);
})();
