import fs from 'node:fs/promises';
import { buildRadarReport } from '../src/radar-rules.mjs';
import { createReportHtml } from '../src/report-export.mjs';
const output = new URL('../docs/assignment-3/经营巡检日报.html',import.meta.url);
await fs.writeFile(output,createReportHtml(['2026-11-12','2026-11-13','2026-11-14'].map(date=>buildRadarReport(date)),[],{selectedDate:'2026-11-14'}));
console.log(`已生成 ${output.pathname}`);
