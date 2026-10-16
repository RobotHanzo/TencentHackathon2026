import type { CaseRecord, Knowledge, Skill } from '../shared/types.ts';
import type { Workspace } from './store.ts';
import { localReview } from './advisor.ts';

export function seedWorkspace(now: Date): Workspace {
  const date = now.toISOString();
  const day = (offset: number) =>
    new Date(now.getTime() + offset * 86_400_000).toLocaleDateString('en-CA', {
      timeZone: 'Asia/Singapore',
    });
  const users = [
    { id: 'manager-sarah', name: 'Sarah Tan', role: 'manager' as const, initials: 'ST' },
    { id: 'employee-amir', name: 'Amir Rahman', role: 'employee' as const, initials: 'AR' },
    { id: 'employee-chloe', name: 'Chloe Lim', role: 'employee' as const, initials: 'CL' },
    { id: 'manager-daniel', name: 'Daniel Wong', role: 'manager' as const, initials: 'DW' },
  ];
  const skills: Skill[] = [
    {
      id: 'electronics',
      name: 'Electronics & telecoms',
      category: 'Electronics',
      jurisdiction: 'Singapore',
      description:
        'Route wireless and telecommunications equipment to applicable IMDA checks. Confirm product scope before requesting licence evidence.',
      tags: ['IMDA', 'Wireless devices', 'TradeNet'],
      status: 'Active',
      updatedAt: date,
    },
    {
      id: 'food',
      name: 'Food & fresh produce',
      category: 'Food & produce',
      jurisdiction: 'Singapore',
      description:
        'Distinguish fresh produce from processed food and check the appropriate SFA importer licensing or registration route.',
      tags: ['SFA', 'Fresh produce', 'Cold chain'],
      status: 'Active',
      updatedAt: date,
    },
    {
      id: 'automotive',
      name: 'Automotive & components',
      category: 'Automotive',
      jurisdiction: 'Singapore',
      description:
        'Review vehicle parts and wireless accessories, shipment evidence and cross-category requirements.',
      tags: ['Vehicle parts', 'Wireless accessories', 'HS review'],
      status: 'Active',
      updatedAt: date,
    },
    {
      id: 'general',
      name: 'General cargo & declarations',
      category: 'General cargo',
      jurisdiction: 'Singapore',
      description:
        'Check Singapore import readiness, document consistency and carefully worded customer communications.',
      tags: ['Singapore Customs', 'TradeNet', 'Customer communication'],
      status: 'Active',
      updatedAt: date,
    },
  ];
  const entry = (
    id: string,
    title: string,
    skillId: string,
    content: string,
    sourceName: string,
    tags: string[],
    sourceType: Knowledge['sourceType'] = 'Playbook',
  ): Knowledge => ({
    id,
    title,
    skillId,
    content,
    sourceName,
    tags,
    sourceType,
    category: skills.find((skill) => skill.id === skillId)!.category,
    jurisdiction: 'Singapore',
    status: 'Approved',
    createdAt: date,
    author: 'Sarah Tan',
  });
  const knowledge = [
    entry(
      'kb-customs',
      'Singapore import readiness',
      'general',
      'Singapore importers need a UEN and an activated Customs Account. Check whether goods are controlled and identify the relevant competent authority. Customs import permits are applied for through TradeNet. Verify the applicable requirements using the official source for each shipment. Official reference: https://www.customs.gov.sg/doing-business/import-operations/import-operations-overview/',
      'Singapore Customs · Import operations overview',
      ['UEN', 'Customs Account', 'TradeNet'],
    ),
    entry(
      'kb-imda',
      'Check telecoms scope before requesting IMDA evidence',
      'electronics',
      'IMDA provides dealer licensing routes for telecommunication equipment. Determine whether the actual product falls within the relevant telecommunications scope and verify the applicable licence or registration route. Do not assume that every electronic product requires the same IMDA approval. Official reference: https://eservice.imda.gov.sg/tls/tls/viewLicenceSelection.action',
      'IMDA · Telecommunications licensing portal',
      ['IMDA', 'telecoms', 'wireless', 'Bluetooth'],
    ),
    entry(
      'kb-food',
      'Match the SFA route to the food category',
      'food',
      'Fresh fruit and vegetable imports and processed food imports have different SFA licensing or registration routes. Confirm the importer status and exact product category before proceeding. Official reference: https://www.sfa.gov.sg/food-import-export/licence-permit-registration/application-process-fees-for-licence-permit-registration-for-import-export',
      'SFA · Import licence, permit and registration',
      ['SFA', 'fresh produce', 'processed food'],
    ),
    entry(
      'kb-processed',
      'Fresh or processed: clarify the product',
      'food',
      'Confirm whether produce is fresh or has been processed; do not select an import route from the commercial product name alone. Preparation and processing affect the SFA food category. Official reference: https://ask.gov.sg/sfa/questions/cmh9uy1zi01muot5sms1xg208',
      'SFA · Fresh and processed food guidance',
      ['fresh', 'processed', 'classification'],
    ),
    entry(
      'kb-expiry',
      'Verify the date, not just the permit number',
      'general',
      'INTERNAL DEMO SOP, not a statement of legislation: Where permit or licence validity is relevant, compare the recorded expiry against both today in Singapore and the planned shipment date. A populated number alone is insufficient evidence. Ask for corrected evidence if validity is missing or expired.',
      'Instill internal SOP · Permit validity',
      ['permit', 'expiry', 'licence', 'dates'],
    ),
    entry(
      'kb-warehouse',
      'Confirm receiving and storage readiness',
      'food',
      'INTERNAL DEMO SOP: Confirm the receiving warehouse and any agreed cold-chain or handling arrangements before promising delivery for fresh produce. Record who confirmed the arrangement. This is an operational checklist, not an assertion that all food requires a particular warehouse licence.',
      'Instill internal SOP · Receiving arrangements',
      ['warehouse', 'cold chain', 'delivery'],
    ),
    entry(
      'kb-auto',
      'Vehicle accessories may cross product categories',
      'automotive',
      'INTERNAL DEMO SOP: For automotive remote controls, Bluetooth modules or radio accessories, inspect the technical specifications and consult the electronics skill for potential IMDA checks. Confirm the applicable HS classification from product facts; do not copy a previous classification blindly.',
      'Instill internal SOP · Automotive accessories',
      ['automotive', 'remote control', 'Bluetooth', 'IMDA'],
    ),
    entry(
      'kb-communication',
      'Separate planned clearance from confirmed clearance',
      'general',
      'INTERNAL DEMO SOP: Before sending a customer email, check invoice, packing list and shipment facts. Do not state that clearance is guaranteed or completed without evidence. Use conditional timing and explain outstanding documents. Senior approval is an internal approval; it does not submit a declaration or send an email.',
      'Instill internal SOP · Customer communications',
      ['customer email', 'invoice', 'packing list', 'clearance'],
    ),
    {
      ...entry(
        'kb-previous-decision',
        'Wireless sensor documentation: approved precedent',
        'electronics',
        'Accepted advice from a fictional prior case: check the product specification and the applicable IMDA route for wireless sensors before clearance. Reviewer rationale: a customer description saying electronic accessory is insufficient to determine telecommunications scope. Internal case precedent; verify applicability for the new shipment.',
        'Senior review · CP-SG-1027 (demo)',
        ['wireless', 'sensor', 'precedent'],
        'Decision',
      ),
      decision: 'accepted' as const,
      caseId: 'demo-prior-case',
    },
  ];
  const base: CaseRecord = {
    id: '',
    reference: '',
    title: '',
    customer: '',
    category: 'Electronics',
    jurisdiction: 'Singapore',
    documentType: 'Customs declaration',
    content: '',
    permitNumber: '',
    permitExpiry: '',
    shipmentDate: day(2),
    warehouseConfirmed: false,
    status: 'Draft',
    createdAt: date,
    updatedAt: date,
    ownerId: 'employee-amir',
    ownerName: 'Amir Rahman',
    review: null,
  };
  const cases: CaseRecord[] = [
    {
      ...base,
      id: 'case-wireless',
      reference: 'CP-SG-1042',
      title: 'Wireless sensors · import declaration',
      customer: 'Straits IoT Pte Ltd',
      content:
        'Shipment of 240 Bluetooth environmental sensors from Shenzhen to Singapore. Customer supplied an IMDA-related licence reference. Commercial invoice and packing list are available. Confirm validity and technical scope before declaration.',
      permitNumber: 'DEMO-IMDA-2408',
      permitExpiry: day(-2),
      status: 'In review',
    },
    {
      ...base,
      id: 'case-produce',
      reference: 'CP-SG-1041',
      title: 'Fresh produce · customer update',
      customer: 'Orchard Fresh Pte Ltd',
      category: 'Food & produce',
      documentType: 'Customer email',
      content:
        'Dear customer, your fresh mango shipment is scheduled to arrive at Changi Airfreight Centre. We guarantee clearance and delivery tomorrow. Receiving warehouse confirmation is pending. Please share the SFA importer licence and packing list.',
      permitNumber: 'DEMO-SFA-7182',
      permitExpiry: day(60),
      status: 'In review',
      ownerId: 'employee-chloe',
      ownerName: 'Chloe Lim',
    },
    {
      ...base,
      id: 'case-auto',
      reference: 'CP-SG-1040',
      title: 'Vehicle remote controls · document check',
      customer: 'Meridian Auto Parts Pte Ltd',
      category: 'Automotive',
      content:
        '120 wireless car remote controls to be imported into Singapore. Technical radio specifications are pending. Invoice received; final packing list to follow.',
      status: 'Draft',
    },
    {
      ...base,
      id: 'case-food',
      reference: 'CP-SG-1039',
      title: 'Frozen berries · importer onboarding',
      customer: 'Little Red Dot Foods Pte Ltd',
      category: 'Food & produce',
      documentType: 'Contract',
      content:
        'Draft brokerage agreement covering frozen berries. Confirm whether the product is fresh or processed and identify the relevant SFA registration or licensing route. Customer responsibilities include accurate product specifications.',
      permitNumber: 'DEMO-SFA-3319',
      permitExpiry: day(90),
      warehouseConfirmed: true,
      status: 'Changes requested',
      ownerId: 'employee-chloe',
      ownerName: 'Chloe Lim',
    },
    {
      ...base,
      id: 'case-general',
      reference: 'CP-SG-1038',
      title: 'Office furniture · import declaration',
      customer: 'Harbour Workspace Pte Ltd',
      category: 'General cargo',
      content:
        'Commercial invoice, packing list, HS classification review and importer Customs Account confirmation recorded for office chairs. Shipment details reconciled with the supplier. Internal demo approved case.',
      permitNumber: 'DEMO-TN-12093',
      permitExpiry: day(30),
      warehouseConfirmed: true,
      status: 'Approved',
    },
    {
      ...base,
      id: 'case-email',
      reference: 'CP-SG-1037',
      title: 'Audio equipment · clearance estimate',
      customer: 'Soundwave Asia Pte Ltd',
      documentType: 'Customer email',
      content:
        'Dear customer, we are checking the equipment specifications and supporting documents. We will update the expected clearance date after the outstanding information is confirmed.',
      permitNumber: 'DEMO-TN-12092',
      permitExpiry: day(30),
      warehouseConfirmed: true,
    },
  ];
  const workspace: Workspace = {
    users,
    skills,
    knowledge,
    cases,
    chats: [],
    comments: [],
    activity: [],
  };
  for (const item of cases.filter((record) => record.status !== 'Draft'))
    item.review = localReview(workspace, item, now);
  const approved = cases.find((record) => record.status === 'Approved')!;
  approved.review!.suggestions.forEach((suggestion) => {
    suggestion.decision = 'accepted';
    suggestion.comment = 'Demo evidence checked by Sarah Tan.';
    suggestion.decidedBy = 'Sarah Tan';
  });
  workspace.activity = [
    {
      id: 'activity-review',
      type: 'review',
      title: 'Wireless sensor declaration reviewed',
      detail: 'The local advisor flagged permit validity and telecoms scope for senior review.',
      actor: 'Instill advisor',
      createdAt: date,
      caseId: 'case-wireless',
    },
    {
      id: 'activity-approved',
      type: 'approval',
      title: 'Office furniture declaration approved',
      detail: 'Sarah completed the internal review. No external declaration was sent.',
      actor: 'Sarah Tan',
      createdAt: date,
      caseId: 'case-general',
    },
    {
      id: 'activity-knowledge',
      type: 'import',
      title: 'Singapore playbooks ready',
      detail: 'Official references and internal demo SOPs are labelled separately.',
      actor: 'Sarah Tan',
      createdAt: date,
    },
  ];
  workspace.comments = [
    {
      id: 'comment-demo',
      caseId: 'case-wireless',
      author: 'Amir Rahman',
      content:
        'The customer has been asked for an updated validity document. Please verify the product scope as well.',
      createdAt: date,
    },
  ];
  return workspace;
}
