import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import XLSX from 'xlsx';
import { offlineSafePayload } from '../src/lib/offline/queue.ts';

describe('offline ID privacy',()=>{
  it('rejects any draft containing a National ID',()=>{
    expect(()=>offlineSafePayload({client_request_id:'synthetic-id',national_id:'1234567'})).toThrow('must be saved while online');
  });
  it('stores offline-ready fields without an ID property',()=>{
    const payload=offlineSafePayload({client_request_id:'synthetic-id',name:'Synthetic Offline Entry',national_id:''});
    expect(payload).toMatchObject({name:'Synthetic Offline Entry'});
    expect(payload).not.toHaveProperty('national_id');
  });
});


describe('IEBC 2022 historical place import file',()=>{
  const bytes=fs.readFileSync(new URL('../db/reference-data/iebc-lurambi-2022-places.csv',import.meta.url));
  const workbook=XLSX.read(bytes,{type:'buffer',raw:false});
  const rows=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{defval:''});

  it('contains the six canonical wards, 98 centres, and 176 uniquely coded stations',()=>{
    const centres=rows.filter(row=>row.type==='polling_centre');
    const stations=rows.filter(row=>row.type==='polling_station');
    expect(rows).toHaveLength(274);
    expect(centres).toHaveLength(98);
    expect(stations).toHaveLength(176);
    expect(new Set(rows.map(row=>row.ward_name))).toEqual(new Set(['Butsotso East','Butsotso South','Butsotso Central','Sheywe','Mahiakalo','Shirere']));
    expect(new Set(stations.map(row=>row.code)).size).toBe(176);
    expect(rows.slice(0,98).every(row=>row.type==='polling_centre')).toBe(true);
    expect(rows.slice(98).every(row=>row.type==='polling_station')).toBe(true);
    expect(centres.every(row=>String(row.code).match(/^IEBC-037202\d{7}$/))).toBe(true);
  });

  it('disambiguates station rows and provides the fields used by Places import',()=>{
    const stations=rows.filter(row=>row.type==='polling_station');
    for(const row of stations){
      expect(row.name).toBe(row.station_name);
      expect(row.centre_name).toBeTruthy();
      expect(Number(row.station_number)).toBeGreaterThan(0);
      const stationCode=String(row.code).replace(/^IEBC-/,'');
      expect(row.station_name).toContain('Stream '+stationCode.slice(-2));
      expect(stationCode).toMatch(/^037202\d{9}$/);
    }
  });
});
