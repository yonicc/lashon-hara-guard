// Refresh computed coverage fields only; preserve all reviewed semantic notes.
// From engine/: node --import tsx ../scripts/refresh-coverage.mts [--check]
import {readFileSync,writeFileSync} from 'node:fs';
import {CC_ALL_DRAFT_PACK} from '../engine/src/chafetzChaim/allPacks.js';
import {FACT_CATALOG} from '../engine/src/lessonScenario.js';
import {exprFactIds} from '../engine/src/evalExpr.js';
const root=new URL('../',import.meta.url);
const mapFile=new URL('engine/src/chafetzChaim/sourceCoverage.json',root);
const docFile=new URL('docs/22-complete-rule-coverage.md',root);
const original=readFileSync(mapFile,'utf8').replace(/\r\n/g,'\n');
const coverage=JSON.parse(original);
coverage.snapshot={...coverage.snapshot,
 ruleCount:CC_ALL_DRAFT_PACK.rules.length,
 vocabularyFactCount:JSON.parse(readFileSync(new URL('rules/chafetz-chaim/facts.json',root),'utf8')).facts.length,
 catalogCount:FACT_CATALOG.length};
for(const s of coverage.sections) {
 const rules=CC_ALL_DRAFT_PACK.rules.filter(r=>r.source?.url===s.url);
 s.status=rules.length?'partial_semantic':'documentary';
 s.ruleIds=rules.map(r=>r.id);
 s.runtimeBindings=rules.map(r=>({id:r.id,source:r.source,titleHe:r.titleHe,
 applicability:r.applicability,conditions:r.conditions,requiredFacts:r.requiredFacts??[],
 reviewStatus:r.reviewStatus,exceptions:r.exceptions??[],
 referencedFactIds:[...new Set([...exprFactIds(r.applicability),...exprFactIds(r.conditions),
 ...(r.exceptions??[]).flatMap(e=>[...exprFactIds(e)]),...(r.requiredFacts??[])])].sort()}));
 s.implementedScopeHe=rules.length
 ?'תזכורות טיוטה בלבד: '+rules.map(r=>r.titleHe.replace(/^טיוטה: /,'')).join('; ')+'. הטריגרים המדויקים והחריגים מופיעים ב־runtimeBindings; אינם כיסוי מלא לסעיף.'
 :'אין כלל בעל מקור ראשי של סעיף זה ב־CC_ALL_DRAFT_PACK. קשר רעיוני לכלל אחר אינו נספר כמימוש הסעיף.';
}
// Keep large computed binding arrays compact to make semantic notes reviewable.
function format(value:any,depth=0,key=''):string {
 if(key==='runtimeBindings'||key==='cardDraftInputs')return JSON.stringify(value);
 const pad='  '.repeat(depth),next='  '.repeat(depth+1);
 if(Array.isArray(value))return value.length?'[\n'+value.map(v=>next+format(v,depth+1)).join(',\n')+'\n'+pad+']':'[]';
 if(value&&typeof value==='object')return '{\n'+Object.entries(value).map(([k,v])=>next+JSON.stringify(k)+': '+format(v,depth+1,k)).join(',\n')+'\n'+pad+'}';
 return JSON.stringify(value);
}
const mapText=format(coverage)+'\n';
const oldDoc=readFileSync(docFile,'utf8').replace(/\r\n/g,'\n');
const marker='| סעיף ומקור |';
const at=oldDoc.indexOf(marker);
if(at<0)throw new Error('coverage table marker missing');
const lines=oldDoc.slice(0,at).trimEnd().split('\n');
const partial=coverage.sections.filter((s:any)=>s.status==='partial_semantic').length;
lines[2]='מיפוי לביקורת; בסיס המקורות וההרחבה: `'+coverage.snapshot.revision+'`: 19 כללים, 177 סעיפים, '+coverage.snapshot.ruleCount+' תזכורות טיוטה, '+coverage.snapshot.vocabularyFactCount+' עובדות מקור ו־'+coverage.snapshot.catalogCount+' פריטי קטלוג. '+partial+' סעיפים מסומנים `partial_semantic` ו־'+(177-partial)+' `documentary`. אין סעיף שמסומן כמימוש הלכתי מלא, ואין פסק או היתר.';
const safe=(s:string)=>s.replace(/\|/g,'&#124;').replace(/\r?\n/g,' ');
const table=[marker+' מימוש ראשי | ענפים סמנטיים | מגבלה שנותרה | ישימות |','|---|---|---|---|---|',
 ...coverage.sections.map((s:any)=>'| ['+s.key+']('+s.url+') | '+(s.ruleIds.length?s.ruleIds.map((id:string)=>'`'+id+'`').join('<br>'):'documentary — ללא כלל ראשי')+' | '+safe(s.semanticBranchesHe)+' | '+safe(s.unimplementedHe)+' | `'+s.chatFeasibility+'` |')].join('\n');
const docText=lines.join('\n')+'\n\n'+table+'\n';
for(const [file,old,text] of [[mapFile,original,mapText],[docFile,oldDoc,docText]] as const) {
 if(old===text)continue;
 if(process.argv.includes('--check'))throw new Error('coverage drift: '+file.pathname);
 writeFileSync(file,text,'utf8');
}
console.log(JSON.stringify({rules:coverage.snapshot.ruleCount,facts:coverage.snapshot.vocabularyFactCount,catalog:coverage.snapshot.catalogCount,partial,documentary:177-partial}));
