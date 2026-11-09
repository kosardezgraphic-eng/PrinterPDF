/** Parse one-based page or sheet ranges without changing print selection. */
export function parseCoverageSelection(value:string, count:number):number[] {
  const normalized=value.replace(/[۰-۹٠-٩]/g,d=>String(d.charCodeAt(0)-(d<='٩'?0x660:0x6f0))).replace(/[،;]/g,',').trim();
  if(!normalized)throw new Error('Empty selection');
  const selected=new Set<number>();
  for(const part of normalized.split(',')) {
    const match=part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if(!match)throw new Error('Invalid selection');
    const start=Number(match[1]),end=Number(match[2]??match[1]);
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start||end>count)throw new Error('Selection out of range');
    for(let index=start;index<=end;index++)selected.add(index);
  }
  return [...selected].sort((a,b)=>a-b);
}
export function formatCoverageSelection(indices:number[]):string {
  const sorted=[...new Set(indices.filter(n=>Number.isSafeInteger(n)&&n>0))].sort((a,b)=>a-b);
  const parts:string[]=[];
  for(let i=0;i<sorted.length;i++) {
    const first=sorted[i];let last=first;
    while(i+1<sorted.length && sorted[i+1]===last+1)last=sorted[++i];
    parts.push(first===last?String(first):`${first}-${last}`);
  }
  return parts.join(', ');
}
