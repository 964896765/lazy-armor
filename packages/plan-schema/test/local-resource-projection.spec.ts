import {it,expect} from 'vitest';
import {projectLocalResources} from '../src/local-resource-projection';
it('presents OS permission evidence without promoting execution readiness',()=>{const rows=projectLocalResources({acquiredAt:'2026-10-04T00:00:00Z',acquisition:false,notifications:true,background:false});expect(rows.map(r=>r.status)).toEqual(['开启','已开启','开启']);expect(rows.every(r=>r.health==='UNKNOWN'&&r.capabilities.length===0)).toBe(true);expect(rows.every(r=>r.sourceRef.type==='NativePermission')).toBe(true);});
