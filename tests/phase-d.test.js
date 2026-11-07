import { describe, expect, it } from 'vitest';
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
