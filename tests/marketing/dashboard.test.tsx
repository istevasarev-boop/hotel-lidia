// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MarketingDashboard } from '@/components/MarketingDashboard';
import type { Snapshot, Campaign } from '@/components/MarketingView';
const campaign:Campaign={id:'1',name:'Test',status:'active',currency:'EUR',cost:10,clicks:5,impressions:100,conversions:1};
const data:Snapshot={period:'old website period',updatedAt:'2026-10-18',campaignPeriod:'new campaign period',hostname:'example.test',campaigns:[campaign],metaCampaigns:[{...campaign,id:'2',currency:'USD',conversions:null}],campaignDaily:[{...campaign,date:'2026-10-01'},{...campaign,id:'3',date:'2026-10-01'}],metaDaily:[],website:{sessions:10,users:8,newUsers:7,engagedSessions:5,views:20,averageSessionSeconds:60},devices:[['mobile',8],['desktop',2]],cities:[],sources:[['google / cpc',7],['facebook / referral',3]],events:[]};
afterEach(cleanup);
it('aggregates actual daily rows and switches to missing Meta data without inventing zero days',()=>{
 render(<MarketingDashboard data={data} tab="campaigns" campaignDetails={<p>details</p>}/>);
 expect(screen.getByText('new campaign period')).toBeTruthy();
 expect(screen.getByRole('button',{name:'2026-10-01: 10'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Meta Ads',exact:true}));
 expect(screen.getByText('Няма налична дневна разбивка за този канал.')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Website leads —'})).toBeTruthy();
});
it('preserves website dates and filters sources and device selection',()=>{
 render(<MarketingDashboard data={data} tab="website" campaignDetails={null}/>);
 expect(screen.getByText('old website period')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Източници'),{target:{value:'social'}});
 expect(screen.queryByRole('button',{name:/google \/ cpc/})).toBeNull();
 expect(screen.getByRole('button',{name:/facebook \/ referral/})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:/desktop/}));
 expect(screen.getByRole('button',{name:/desktop/}).getAttribute('aria-pressed')).toBe('true');
});
