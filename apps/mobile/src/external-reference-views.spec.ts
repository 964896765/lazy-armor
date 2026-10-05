import {describe,it,expect} from 'vitest';
import {matchesExternalServiceView} from './external-reference-views';
describe('external service kind and domain isolation',()=>{
 it.each(['PRODUCT','PLACE','CONTENT','DOCUMENT','EVENT','OTHER'])('excludes %s even with a service domain',kind=>{expect(matchesExternalServiceView({kind,domain:'life'},'全部')).toBe(false);expect(matchesExternalServiceView({kind,domain:'life'},'生活')).toBe(false);});
 it('filters domain independently and leaves an unset domain visible in all',()=>{expect(matchesExternalServiceView({kind:'SERVICE',domain:'work'},'工作')).toBe(true);expect(matchesExternalServiceView({kind:'SERVICE',domain:'work'},'生活')).toBe(false);expect(matchesExternalServiceView({kind:'SERVICE'},'全部')).toBe(true);});
 it('recent requires a real nonfuture timestamp within 30 days',()=>{const now=Date.parse('2026-10-05T00:00:00Z');expect(matchesExternalServiceView({kind:'SERVICE',createdAt:'2026-10-04T00:00:00Z'},'最近',now)).toBe(true);for(const createdAt of [undefined,'bad','2026-10-06T00:00:00Z','2026-08-01T00:00:00Z'])expect(matchesExternalServiceView({kind:'SERVICE',createdAt},'最近',now)).toBe(false);});
});
