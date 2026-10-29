import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('gives the reservation linker and conversation distinct sibling identities for each enquiry', () => {
 const source = readFileSync('components/HotelApp.tsx','utf8');
 const keys = ['EnquiryReservationLink','EnquiryConversation'].map(name => source.match(new RegExp('<'+name+' key=\\{([^}]+)\\}'))?.[1]);
 expect(keys.every(Boolean)).toBe(true);
 expect(new Set(keys).size).toBe(2);
 keys.forEach(key=>expect(key).toContain('selected.id'));
});
