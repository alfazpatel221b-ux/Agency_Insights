/**
 * Smoke checks for KPI direction + RAG colors.
 * Run: npx tsx src/lib/kpi-rag.smoke.ts
 */
import {
  getMonthlyStatus,
  getWeeklyStatus,
  meetsTarget,
  parseKpiDirection,
} from './kpi-rag';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(parseKpiDirection('DESC') === 'DESC', 'DESC token');
assert(parseKpiDirection('Lower is better') === 'DESC', 'lower is better');
assert(parseKpiDirection('down') === 'DESC', 'down');
assert(parseKpiDirection('Higher is better') === 'ASC', 'higher is better');
assert(parseKpiDirection('', 'CPA') === 'DESC', 'CPA infers DESC');
assert(parseKpiDirection('', 'Leads') === 'ASC', 'Leads infers ASC');

// String Firestore values must not use lexicographic compare ("1200" >= "999" is false)
assert(meetsTarget('1200', '999', 'ASC') === true, 'string met ASC');
assert(getMonthlyStatus('1200', '999', 'ASC') === 'Green', 'string monthly green');
assert(getMonthlyStatus('800', '1000', 'ASC') === 'Red', 'string monthly red');

// DESC: lower achieved vs target is a met KPI (CPA)
assert(getMonthlyStatus(80, 100, 'DESC') === 'Green', 'DESC met is green');
assert(getMonthlyStatus(140, 100, 'DESC') === 'Red', 'DESC miss is red');

// Weekly mixed = Amber (hit target, down vs last week) for ASC volume
assert(getWeeklyStatus(3713, 3000, 4368, 'ASC') === 'Amber', 'wow drop amber');
assert(getWeeklyStatus(4368, 3000, 4097, 'ASC') === 'Green', 'hit both green');
assert(getWeeklyStatus(2000, 3000, 2889, 'ASC') === 'Red', 'miss both red');

console.log('kpi-rag.smoke.ts: OK');
