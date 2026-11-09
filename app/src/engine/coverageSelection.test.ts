import {describe,it,expect} from 'vitest';
import {formatCoverageSelection,parseCoverageSelection} from './coverageSelection';
describe('page and sheet selection',()=>{
 it('parses and formats ranges including localized digits, deduplicating and sorting',()=>{
  expect(parseCoverageSelection('۳-۵، 1, ٤, 9',10)).toEqual([1,3,4,5,9]);
  expect(formatCoverageSelection([9,1,3,4,5,3])).toBe('1, 3-5, 9');
 });
 it.each(['','0','1-0','2-1','1-9999999999','4,','NaN','1.5','2--3'])('rejects %s without expanding unbounded ranges',value=>{
  expect(()=>parseCoverageSelection(value,3)).toThrow();
 });
});
