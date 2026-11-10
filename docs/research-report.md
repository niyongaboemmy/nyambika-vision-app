# Nyambika Vision — Research Report

**AI-Powered Virtual Fashion Fitting Room**

| | |
|---|---|
| Document type | Research & Analysis Report |
| Prepared by | Project Management Office |
| Date | 10 November 2026 |
| Subject | Analysis of the *Nyambika Vision* project proposal ([proposal.md](proposal.md)) |
| Companion document | [feasibility-study.md](feasibility-study.md) |
| Status | Draft v1.1 for steering-committee review (updated to keep Nyambika's member-page management model) |

---

## Executive Summary

Nyambika Vision proposes a mobile-first platform where Rwandan shoppers upload a photo, pick garments from local sellers and tailors, and see an AI-generated image of themselves wearing them, linked to purchase via MTN MoMo and Airtel Money.

**Baseline: how Nyambika already works.** Nyambika hosts **tailors, sewing cooperatives and sellers**, and each one has **their own page** where they promote their clothing. Nyambika is the host and curator. Each page owner manages their own products, customers and sales. **This management model stays in place.** Nyambika Vision modernises it by adding AI try-on, AI product photos, digital payments and analytics *to every member's page*. It does not replace the pages with a centralised marketplace.

**What the research supports**

1. **The technology is ready to buy, not build.** Commercial virtual try-on (VTON) APIs from FASHN, Google (Vertex AI, generally available since January 2026) and others now produce usable results for about **US$0.06–0.08 per image** (about RWF 90–120). A focused team can ship a working try-on MVP without training any models.
2. **The global category is growing.** Analyst estimates put the virtual fitting room market at roughly **US$4–7 billion in 2025**, growing at **16–27% a year**.
3. **The local whitespace is real for now.** Google's built-in Shopping try-on covers about 10 countries (US, UK, India, Japan, parts of Latin America) and **does not include Rwanda or East Africa**. No confirmed VTON-led fashion platform operates in Rwanda. The nearest African examples are single-brand launches in Nigeria (2026).
4. **Policy favours local fashion.** Rwanda's "Made in Rwanda" policy and its 2016 tariffs on second-hand clothing, which cut imports by a reported 97%, have helped a growing SME and tailor sector that has few digital tools.

**What the research challenges**

1. **The addressable market is small today.** About **38% of Rwandans are online**, only **34% of households own a smartphone**, and estimates of total Rwandan e-commerce range from **US$81M to US$374M** (2025). Online fashion is a fraction of that.
2. **Buying happens on social channels.** Small sellers sell through WhatsApp, Instagram and Facebook, with MoMo paid before delivery. A standalone marketplace checkout goes against how people already buy.
3. **The data protection law is a gating issue.** Rwanda's Law No. 058/2021 requires controllers to **register with NCSA before processing**, generally requires **personal data to be stored in Rwanda** unless cross-border transfer is authorised, and may treat body data as sensitive. Sending customer photos to US-hosted AI APIs is a cross-border transfer and needs clearance first.
4. **Model quality on African users and garments is unproven.** A 2026 benchmark (AfriVTON-Bench) found try-on quality **drops 17–19 points on Kente and Ankara prints** compared with Western garments. Production systems report skin-tone-correlated failures, including outputs that show a lighter-skinned person in place of the user. For a Rwandan product this is a core risk, not a side issue.
5. **Unit economics are tight.** At about RWF 110 per generation, a free and uncapped try-on experience can cost more than the commission earned on the sale. The business model has to move try-on cost onto sellers or cap it.
6. **The proposal's scope and timeline don't match.** The proposal lists seven feature areas, including 3D, AR and an AI assistant, but allows a 7-week MVP. The research supports a narrower MVP (try-on, catalogue, seller tools, MoMo) delivered in about **12 weeks plus a 4-week pilot**.

**Overall assessment:** The concept is viable and timely. The proposal should be refocused as a **modernisation of Nyambika's member pages**:

- (a) Each tailor's, cooperative's and seller's page gains AI product photos, a "Try it on me" button and shareable links for WhatsApp and Instagram.
- (b) Shoppers try on clothes on any member's page.
- (c) Orders and payments go **to the page owner**, as they do today.

**Regulatory clearance and a local model-quality benchmark are gate conditions** before the full build. Nyambika's existing member base is also its biggest advantage. Onboarding becomes **migrating and upgrading** existing members rather than recruiting from scratch, which lowers adoption risk. See the [feasibility study](feasibility-study.md) for the go/no-go recommendation.

---

## 1. Research Scope and Method

### 1.1 Objectives
- Validate the problem and market assumptions in the proposal.
- Assess technology maturity, cost and licensing of the proposed stack.
- Map competitors and substitutes, global and local.
- Identify regulatory, ethical and operational constraints specific to Rwanda.
- Give the feasibility study evidence to work from.

### 1.2 Method
- Review of the proposal, section by section.
- Desk research (November 2026) on market reports, vendor documentation and pricing, academic benchmarks, Rwandan legal summaries, telecom and payments sources, and the local press.
- PMO analysis and modelling: unit economics, budget and schedule.

### 1.3 Limitations
- **No primary research has been done yet.** There have been no interviews with Rwandan shoppers, sellers or tailors. Section 10 lists the validation work required.
- Market-size figures for Rwanda come from secondary sources that **disagree by up to 4.6×**. We show ranges rather than single figures.
- Return-reduction figures for virtual try-on are mostly **vendor-reported**. No independent controlled study was found.
- Legal points come from secondary summaries of Law No. 058/2021 (DLA Piper, Hogan Lovells, DataGuidance) and must be confirmed by Rwandan counsel.

---

## 2. Review of the Proposal Against Nyambika's Operating Model

### 2.1 Baseline: how Nyambika works today
| Element | Traditional Nyambika model | Must be preserved in Nyambika Vision |
|---|---|---|
| Members | Tailors, sewing cooperatives and independent sellers, all hosted by Nyambika | ✅ The same three member types. Nothing is merged into a generic "vendor". |
| Presence | **Each member has their own page** promoting their clothing | ✅ The page stays the member's storefront and identity. Vision features are added to it. |
| Management | Each page owner manages their own content, products and customer relationships. Nyambika hosts, curates and promotes. | ✅ Decentralised page management with central hosting, verification and standards |
| Selling | Customers discover a member's page and deal with that member (contact, order, pay) | ✅ Orders and payments go to the page owner. Nyambika checkout is an optional convenience, not a requirement. |
| Cooperatives | A cooperative presents its members' work collectively | ✅ A cooperative page with member profiles and attribution of each item to its maker |

**Modernisation principle:** *same pages, same owners, same relationships, with better tools.* Every Vision feature (try-on, AI photos, size profiles, payments, analytics) is a **capability switched on inside a member's page**. None of them is a separate destination that competes with the pages.

### 2.2 Strengths
| Area | Observation |
|---|---|
| Problem framing | The fit, visualisation and returns problems are well documented internationally. Size and fit cause an estimated 53–70% of online apparel returns. |
| Build-vs-buy stance | The proposal says it will "combine existing AI services rather than developing every AI model from scratch". This is the right call. |
| Honest caveat | It acknowledges that try-on is "a visual approximation, not a guarantee of physical fit". This should become product copy and appear in the terms of service. |
| Local payments | MTN MoMo and Airtel Money are the right payment rails for Rwanda. |
| Ecosystem positioning | The strategic recommendation to make Vision the *try-on layer* of the broader Nyambika ecosystem, rather than a separate marketplace, is sound and is supported by the social-commerce findings in §5.3. |
| Inclusion of tailors | This is a distinctive, under-served local segment with no direct competitor. |
| Existing member base | Nyambika already hosts tailors, cooperatives and sellers on their own pages. That gives it a ready supply side and established trust, which new entrants lack. |

### 2.3 Gaps and weaknesses
| # | Gap | Why it matters |
|---|---|---|
| G1 | **No data-protection or consent plan.** | Photos of people, and possibly body measurements, fall under Law 058/2021. Registration, localisation and cross-border rules apply before launch (§7). |
| G2 | **No market sizing, customer evidence or pricing.** | Investors and the steering committee can't assess the revenue model without them. |
| G3 | **Scope exceeds the timeline.** | Seven feature areas, including 3D, AR and an AI assistant, in 7 weeks. 3D and AR alone are each multi-month efforts (§4.4). |
| G4 | **No unit economics.** | Each try-on has a real cost (about RWF 110). Without caps or seller-paid credits, margins can go negative (§8). |
| G5 | **Model bias and local garments not addressed.** | Kitenge, imishanana and other African prints are where current models perform worst (§4.3). |
| G6 | **Catalogue quality assumed.** | Try-on output depends on clean garment images. Small sellers and tailors often have only phone photos on cluttered backgrounds. |
| G7 | **Size recommendation lacks data.** | It depends on seller size charts. Tailors and many local brands don't have standardised ones. |
| G8 | **No team, budget, KPIs or success criteria.** | The proposal points to a budget as a "next step". The feasibility study supplies one. |
| G9 | **No model licensing check.** | Popular open-source VTON models (IDM-VTON, CatVTON) are **non-commercial** (CC BY-NC-SA 4.0). |
| G10 | **The proposal describes a marketplace, not Nyambika's page model.** | "Browse clothing uploaded by sellers", "Shopping Integration" and a single checkout imply a central catalogue. This risks weakening members' own pages and their relationships with customers. |
| G11 | **Cooperatives aren't modelled.** | Cooperatives need a shared page, several members with roles, item-to-maker attribution, and possibly a shared MoMo account. None of this is in the proposal. |
| G12 | **No migration plan for existing pages and members.** | Existing pages, products and member accounts must move into the new platform without downtime or loss of content. |
| G13 | **Document hygiene.** | The proposal contains leftover AI-chat artefacts: externally hosted image links, `utm_source=chatgpt.com` tracking links, a stray "12", and a "Tap to set up" prompt. These must be removed before the document goes to any investor or partner. |

---

## 3. Market Research

### 3.1 Global virtual fitting room market
| Source | 2025 value | 2030 value | CAGR |
|---|---|---|---|
| Knowledge Sourcing Intelligence | US$5.33B | US$17.66B | ~27% |
| 360iResearch | US$6.24B | US$15.0B | 19.1% |
| ResearchAndMarkets (2024 base) | US$6.6B (2024) | US$18.9B | 19.3% |
| Lucintel | — | US$15.12B | 20.5% |
| LP Information | US$3.9B | US$9.8B (2031) | 16.6% |

**Working range:** about US$4–7B (2025), growing 16–27% a year to about US$15–18B by 2030. Publishers define the market differently, so these figures show that the category is real and growing. They are not a basis for revenue forecasting.

### 3.2 Rwanda digital-commerce fundamentals
| Indicator | Value | Source / note |
|---|---|---|
| Population | ~14.4 million | ITU via TechCabal, 2025 |
| Internet users | ~5.5 million (**38%**), up from 34% in 2024 | ITU via TechCabal, 2025. Trade.gov cites "nearly 50%". |
| Mobile internet users | ~20% of population | TechCabal, 2025 |
| Households owning a smartphone | **34%** | TechCabal, 2025 |
| Typical smartphone price | ~US$160 | TechCabal, 2025. Cost is the main barrier. |
| Mobile data price | US$0.41 (Airtel) – US$0.81 (MTN) per GB | 2025. Among the cheapest in Africa. RAMP Q1 2025: US$0.72. |
| E-commerce revenue 2025 | **US$81M** (ECDB) to **US$374M** (Trade.gov) | 4.6× gap between sources. Trade.gov cites >25% annual growth. |
| E-commerce trust mark holders | 13 (Jan 2023) → 31 (Mar 2024) | ICT Chamber Trust Seal |
| Exchange rate | ~RWF 1,477 / US$ | 5 Nov 2026 |

### 3.3 Sizing the opportunity (PMO estimate)
Using top-down assumptions, all of which need validation:

| Layer | Assumption | Estimate |
|---|---|---|
| Rwanda e-commerce (2025) | Range from §3.2 | US$81M – 374M |
| Fashion share of e-commerce | 15–25% (typical global category share; *assumption*) | US$12M – 94M |
| Share influenced by try-on, years 1–3 | 2–5% of online fashion GMV | **US$0.25M – 4.7M GMV/yr** |
| Platform take (commission + subscriptions) | 8–12% effective | **US$20k – 560k revenue/yr** |

**Implication:** In Rwanda alone, a try-on platform is more likely a **sustainable small business or a launchpad** than a venture-scale outcome. Venture scale depends on **East African expansion** (Kenya, Uganda, Tanzania) and **B2B/API licensing**, both already in the proposal's revenue model. Kigali startups raised only about **US$12M in total in 2025**, so fundraising plans should be modest.

### 3.4 Fashion industry context in Rwanda
- **Made in Rwanda policy and second-hand clothing tariffs (2016).** Imports of used clothing fell by about 97% (ILO, 2018). The government says it promoted local production rather than banning sales outright. The number of new fashion businesses has risen since the policy began (Fashionomics Africa).
- **The sector is SME-led and imports most of its textiles.** Many producers are small boutiques, designers and tailors, many of them informal.
- **There was trade friction.** The US suspended Rwanda's AGOA apparel benefits in 2018 over the policy. This is relevant to the proposal's export ambitions.
- **Cooperatives are a key production model.** Sewing and craft cooperatives are common, especially among women. More than 50 cooperatives were formed in Kigali's three districts under the Agaseke programme, with training that included tailoring. In cross-border trade, 63 women's cooperatives with over 3,000 members were trained, and some sew clothing for DRC buyers. Typical cooperatives have 15–25 members sharing machines. They have **limited digital skills, shared ownership and collective decision-making**, all of which shape how page management and payments must work.
- **Data gap:** We found no national count of tailors, fashion SMEs or textile cooperatives (the Rwanda Cooperative Agency registry should be queried), and no data on their digital adoption. **Nyambika's own member records are the best available baseline.** Pages, active members and products per page should be profiled in Phase 0 (§10).

### 3.5 Customer segments (proposal vs. evidence)
Nyambika has two customer groups. **Page owners** (members) are the supply side and the paying customers. **Shoppers** visit members' pages.

| Segment | Proposal | Research view |
|---|---|---|
| Individual shoppers | Primary | Urban, young, smartphone-owning Kigali residents. A small but reachable group, concentrated on social media. Price-sensitive (data and device cost). They reach members' pages through shared links and Nyambika's directory. |
| **Member: independent sellers and boutiques** | Primary | **The best first paying segment.** They need better product imagery and lack the budget for photo shoots. AI model photos on their page give them value on day one. |
| **Member: tailors and designers** | Primary | A distinctive niche. Their value is in visualising a **design before it is sewn** and in storing **customer measurements**, not standard sizing. Their page acts as a portfolio and a way to take orders. |
| **Member: sewing cooperatives** | *Not separated in the proposal* | Shared page, several members, collective selling. They need simple tools, Kinyarwanda UX, member-level attribution, shared payment accounts and **training support**. Their ability to pay is lower, so sponsored or partner-funded plans may be needed. |
| Online fashion businesses | Primary | Candidates for an embeddable widget or API. |
| Diaspora and international buyers | Mentioned in impact | A longer-term export channel. They need cross-border payments (Stripe) and shipping. |

---

## 4. Technology Research

### 4.1 Virtual try-on (VTON) options
| Option | Commercial use | Indicative cost | Notes |
|---|---|---|---|
| **FASHN API** | Yes | ~US$0.075/image on demand. Volume tiers down to ~US$0.049. "Max" quality tier ~US$0.30. | Mature developer API. Also offers AI model and product-to-model photo generation (useful for sellers). |
| **Google Vertex AI Virtual Try-On** | Yes | ~US$0.063–0.075/image (via resellers; check list price) | GA January 2026. Enterprise-grade. Hosted in Google Cloud regions, so cross-border. |
| Kling and other hosted models | Yes (check terms) | ~US$0.07/image via third parties | Quality varies. Aggregators (fal.ai, Replicate) make it easy to switch. |
| **IDM-VTON, CatVTON (open source)** | **No: CC BY-NC-SA 4.0** | GPU self-hosting | **Can't be used in a commercial product.** Some vendor blogs say otherwise; the model card is authoritative. |
| DCI-VTON (MIT), ViViD (Apache 2.0) | Yes | GPU self-hosting | Permissive but older or lower quality. A possible Phase 3 option for data localisation and cost control. |

**Recommendation:** Use a **provider-agnostic try-on gateway** in the backend. Start with one hosted API, benchmark two or three during discovery, and keep the option to self-host a permissively licensed model later.

### 4.2 Typical performance characteristics
- **Latency:** Hosted VTON returns in roughly 5–20 seconds. This needs an **asynchronous job queue** and an "in progress" state in the user experience, not a blocking request.
- **Input sensitivity:** Quality depends heavily on (a) a full-body, front-facing, well-lit user photo and (b) clean garment images. Validating photos on the device saves both API cost and user frustration.
- **Garment coverage:** Tops, dresses and full outfits work well. Layered, very loose, traditional draped or heavily patterned garments do worst.

### 4.3 Bias and local fit-for-purpose (critical)
- **AfriVTON-Bench (NeurIPS 2026 track):** On 111 African garments, try-on quality (gSSIM) dropped **9.4–9.6 points** overall. **Kente (0.460) and Ankara (0.474) scored 17–19 points below the Western control (0.640).** Visual complexity drives the drop. The benchmark's African subjects skewed toward lighter skin tones, which suggests real-world performance on darker skin may be worse than reported.
- **Production evidence (StyleMyCrown):** Failures correlate with skin tone, and one failure mode replaces the user with a **lighter-skinned person**.
- **Implication for Nyambika:** Kitenge and other wax prints are central to Rwandan fashion. **A local benchmark (100+ local garments × diverse Rwandan subjects, scored by a local panel) must be a Phase 0 gate.** Every provider must be scored on it before selection. A product that "whitewashes" users would cause reputational damage beyond a simple quality complaint.

### 4.4 Supporting features in the proposal
| Feature | Maturity for this context | Recommendation |
|---|---|---|
| AI Virtual Try-On | **High** (hosted APIs) | Core of the MVP |
| **Member page management** (multi-tenant pages, roles, catalogue) | High (standard web) | MVP. One page per tailor, cooperative or seller. Owner and staff roles. Cooperative admin and member roles. |
| Shopping + MoMo payments | High (MTN Collections API; aggregators available) | MVP. **Payments go to the page owner's MoMo or Airtel account by default.** "Contact on WhatsApp" is a first-class option, and Nyambika checkout is optional. |
| Smart size recommendation | **Medium–Low.** Photo-based body measurement: vendor claims of 1.5–3 cm error (3DLOOK); little independent validation. Needs seller size charts. | Phase 2. Start with **manual measurement entry and a measurement profile**, mapped to seller size charts. |
| 3D Fashion Viewer (Three.js, Tripo) | Medium. Tripo image-to-3D costs ~US$0.10–1.00 per model, but generated garment meshes are display-quality, not wearable simulations. | Phase 3, optional. Low impact on purchase decisions in this market. |
| AR fitting | **Low** for full-body garments on mid-range Android phones. Heavy on device and data. | Phase 3+. Pilot only on accessories (hats, glasses, jewellery) if at all. |
| AI fashion assistant | High (LLM APIs) | Phase 2. Cheap to add once the catalogue has structured data. |
| MediaPipe in browser | Medium on low-end phones | Use only for lightweight photo-quality checks (pose, framing). Hosted VTON handles its own segmentation. |

### 4.5 Proposed stack assessment
| Layer | Proposed | Assessment |
|---|---|---|
| Frontend | React + TypeScript + Tailwind | ✅ Appropriate. Build as a **PWA** first: no app-store friction, works on low-end Android, shareable links. |
| 3D | Three.js / R3F | ⏸ Defer to Phase 3. |
| Backend | Node.js + NestJS + PostgreSQL + REST | ✅ Appropriate and widely skilled in Kigali. Design it **multi-tenant around member pages**: every product, order, try-on allowance and analytics record belongs to a page, with role-based access. Include a **migration path** for existing pages and content. |
| Storage | Supabase Storage / S3 | ⚠ **Data residency.** Both are hosted outside Rwanda by default. Needs NCSA transfer authorisation or local hosting (§7). |
| AI infrastructure | Own GPU inference, Python/PyTorch | ⏸ Not needed for the MVP. Hosted APIs replace it. Revisit at scale or for localisation. |
| Queues | Background processing | ✅ Required (BullMQ/Redis or equivalent). |
| Payments | MTN MoMo, Airtel Money, Stripe | ✅ MoMo/Airtel for the MVP. Stripe only when international sales start. |

---

## 5. Competitive Landscape

### 5.1 Global
| Player | Model | Relevance to Rwanda |
|---|---|---|
| Google Shopping / Search try-on | Free, built into Search, needs Merchant Center enrolment | **Not available in Rwanda** (about 10 countries as of mid-2026). Google closed its Doppl app (30 Apr 2026) and moved try-on into Search. **This is the biggest long-term substitute threat** if it reaches East Africa. |
| FASHN, Kling, Photta, Fitroom | B2B APIs and seller tools | Possible suppliers *and* competitors: any local seller could use them directly. |
| 3DLOOK, Kleep, Fit Analytics-type sizing | Size and fit SaaS for enterprise brands | Priced for large brands. Not relevant to Rwandan SMEs. |

### 5.2 Africa
| Player | Country | Notes |
|---|---|---|
| Luciana Womenswear | Nigeria | Single-brand AI try-on launched July 2026 ("Nigeria's first", self-described). |
| Maiyaah | Nigeria | Design, visualisation and try-on platform for African fashion. |
| Kenya, South Africa | — | No confirmed VTON-led platform found. |

### 5.3 Rwanda (direct and indirect)
| Player | Category | Relevance |
|---|---|---|
| WhatsApp, Instagram, Facebook sellers | Social commerce | **The main substitute and the main channel.** Sellers take MoMo in advance and deliver. This is close to how Nyambika members already sell from their pages. Vision should fit into this flow, not replace it. |
| Vuba Vuba | On-demand delivery | A possible **logistics partner**. Jumia's earlier exit from Rwanda (reported 2019) shows how hard a marketplace model is here. |
| Kasha | Women's health and personal care e-commerce | Shows a niche vertical model can work in Rwanda and expand to Kenya. |
| Physical markets and tailors (e.g., Kimironko, Nyabugogo) | Offline | The real "fitting room" competitor: trying on in person is cheap and normal. |

### 5.4 Competitive positioning
A defensible position for Nyambika is built on things a global API can't copy:
1. **Nyambika's existing hosted network of tailors, cooperatives and sellers, each with their own page.** This supply side and its trust already exist. A global API can't copy it.
2. **Benchmarked performance on Rwandan users and African garments** (quality moat).
3. **Local rails:** MoMo, Kinyarwanda/English/French UX, WhatsApp-native sharing.
4. **A tailor workflow:** visualise a custom design and keep a digital measurement profile for each customer.
5. **Compliance:** NCSA-registered, privacy-first handling of photos as a trust signal.

---

## 6. Customer and Behavioural Insights (secondary)
- **Returns:** International data: apparel return rates are 20–40%, and size or fit causes 53–70% of returns. In Rwanda's social-commerce model, where MoMo is paid in advance and returns are informal, the main pain is more likely **uncertainty that stops people buying** and **disputes after delivery** than formal returns logistics. *Validate this in interviews.*
- **Try-on impact (vendor-reported, directional):** Size-related returns fell 10–20% with fit tools (ETAM −16%, Showroomprivé −11%). Try-on users show higher conversion. No independent controlled studies were found.
- **Data cost sensitivity:** Even at US$0.41–0.81/GB, image-heavy experiences matter. Compress uploads (~300–500 KB) and results, and use lazy-loaded catalogues.
- **Privacy sensitivity:** Uploading a full-body photo is an act of trust. Clear consent, automatic deletion and "your photo is never shown to sellers" messaging should be tested in user research.

---

## 7. Regulatory and Legal Research (Rwanda)

**Law No. 058/2021 on the Protection of Personal Data and Privacy** (in force 15 Oct 2021). Regulator: **National Cyber Security Authority (NCSA)**.

| Requirement | Impact on Nyambika Vision | Action |
|---|---|---|
| **Registration** of controllers and processors before processing (certificate in about 30 days) | Nyambika can't legally process user photos before registering. | Apply to NCSA during Phase 0. This is on the **critical path**. |
| **Sensitive data:** summaries list biometric/genetic data as sensitive (sources disagree on biometric definitions) | Face and body images, and especially **derived body measurements**, may be treated as sensitive, which allows narrower processing grounds. | Get a legal opinion. Design for **explicit, specific consent**. Don't build face templates or identification. |
| **Data localisation:** personal data stored in Rwanda unless the registration certificate permits storage or transfer abroad | Sending photos to FASHN or Google (US/EU) and storing them in Supabase/S3 abroad is a **cross-border transfer**. | Request transfer authorisation in the NCSA application. Choose vendors with data-processing agreements and no-retention or no-training terms. Consider local hosting for stored photos. |
| **Data Protection Officer** (Art. 40) | Required role. | Appoint a DPO (outsourcing is acceptable at this stage). |
| **Penalties:** criminal sanctions for unlawful processing of sensitive data (per PwC alert) | High personal and company exposure. | Run a DPIA before launch. |
| E-commerce Trust Seal (ICT Chamber) | Optional, but builds trust. | Apply after launch. |
| **Payment flows** (National Bank of Rwanda oversight of payment services) | If Nyambika **collects money on behalf of members** and pays it out later, that may count as a regulated payment service. | Default to **direct payment to the page owner's MoMo or Airtel merchant account**, which also matches the traditional model. Take legal advice before offering central checkout with payouts. |
| **Page-owner responsibilities** | Each member controls their own page content and customer data. | Hosting/membership agreement with each member covering content rules, IP in product photos, data-sharing and who handles disputes. Cooperatives sign as a legal entity. |
| Consumer protection / AI disclosure | The try-on is an approximation. | Label results "AI-generated preview", add fit disclaimers to terms, and set a seller dispute policy. |

*This is a summary of secondary sources, not legal advice. Engage Rwandan counsel to confirm.*

---

## 8. Economic Research: Unit Economics

**Inputs (assumptions to validate)**
- Try-on cost: US$0.075 ≈ **RWF 111 per generation** (FASHN on-demand at RWF 1,477/US$).
- Average order value (AOV): **RWF 30,000** (~US$20) for local fashion items.
- Commission: **8%** → RWF 2,400 per order.
- Mobile-money collection fee: about 1–1.5% (third-party estimates; confirm with MTN and Airtel) → ~RWF 450 if Nyambika absorbs it.

**Contribution per order vs. try-ons used**
| Try-ons generated per completed order | Try-on cost | Net commission after MoMo fee | Contribution |
|---|---|---|---|
| 5 | RWF 555 | RWF 1,950 | **+RWF 1,395** |
| 10 | RWF 1,110 | RWF 1,950 | **+RWF 840** |
| 15 | RWF 1,665 | RWF 1,950 | **+RWF 285** |
| 20 | RWF 2,220 | RWF 1,950 | **−RWF 270** |
| 30 | RWF 3,330 | RWF 1,950 | **−RWF 1,380** |

**Findings**
1. A commission-only model breaks even at roughly **17 try-ons per order**. Window-shopping behaviour, where people try many outfits and buy none, can easily go past that.
2. Viability levers, in order of impact:
   - **Page-funded try-ons.** Each member's page plan includes a try-on allowance, so try-on becomes the page owner's marketing cost. This also fits the traditional model, where members pay for and benefit from their own page. Commission applies only when the optional Nyambika checkout is used, because by default payments go straight to the page owner.
   - **A free quota per shopper** (e.g., 5 per week), with paid credits after that. The proposal already lists credits.
   - **Caching and reuse:** the same user photo and garment pair is never generated twice.
   - **Quality gating on the device** to avoid wasted failed generations.
   - **Volume pricing** (FASHN tiers down to ~US$0.049) and a later self-hosted permissive model.
3. **AI product photography for sellers** (product-to-model images) earns revenue on day one, before any consumer demand exists. It's the strongest first revenue line.

---

## 9. Key Risks Identified by Research
| # | Risk | Likelihood | Impact |
|---|---|---|---|
| R1 | NCSA registration or cross-border authorisation delayed or refused | Medium | **Critical** |
| R2 | VTON quality poor on Rwandan users or kitenge garments (bias) | **High** | **High** |
| R3 | Low consumer demand or willingness to upload photos | Medium | High |
| R4 | Negative unit economics from uncapped free try-ons | High (if unmanaged) | High |
| R5 | Seller catalogue images too poor for try-on | **High** | Medium |
| R6 | Google Shopping try-on launches in East Africa | Low–Medium (2–3 yrs) | High |
| R7 | Supplier dependency: API price changes or shutdown | Medium | Medium |
| R8 | Scope creep (3D, AR, assistant) delays the MVP | **High** | Medium |
| R9 | Small market limits growth and fundraising | Medium | Medium |
| R10 | Existing members resist change or lack digital skills (especially cooperatives) | Medium | High |
| R11 | Migration of existing pages disrupts members' visibility or loses content | Medium | High |
| R12 | Disputes inside cooperatives over page control, attribution or shared payments | Medium | Medium |

The mitigation plan is in the [feasibility study §9](feasibility-study.md#9-risk-assessment-and-mitigation).

---

## 10. Primary Research Required (Phase 0)
| Activity | Sample | Output |
|---|---|---|
| **Member base audit** | All existing Nyambika pages | Number of pages by type (tailor, cooperative, seller), active vs. dormant, products per page, image quality, contact and payment details. This is the migration inventory. |
| Member interviews (existing hosted members) | 20–30, including **≥ 5 cooperatives**, ≥ 8 tailors, ≥ 8 sellers | How they use their page today, pain points, willingness to pay for page upgrades, catalogue readiness, **letters of intent** |
| Shopper interviews and survey | 15 interviews + 200 survey responses (18–35, Kigali) | Willingness to upload a photo, privacy concerns, purchase behaviour, price sensitivity |
| **Local VTON benchmark** | 100+ local garments (≥30% kitenge/patterned) × 30+ Rwandan subjects across skin tones and body types; 2–3 providers | Acceptability score from a local panel, failure-mode catalogue, provider selection |
| Payments discovery | MTN MoMo and Airtel (direct vs. aggregator) | Confirmed fees, settlement time, onboarding timeline |
| Legal opinion | Rwandan data-protection counsel | Sensitive-data classification, transfer path, consent design |
| Usability test of a clickable prototype | 8–10 shoppers | Validated core journey |

---

## 11. Conclusions and Recommendations
1. **Keep Nyambika's management model.** Tailors, cooperatives and sellers keep **their own pages** and manage them themselves. Nyambika stays the host and curator. Every new capability is added inside the member's page.
2. **Proceed, with a reframed scope.** Make the MVP *modernised member pages with AI try-on, AI product photos, and payment to the page owner or WhatsApp*. Move 3D, AR, size recommendation and the AI assistant to later phases.
3. **Start with existing members.** Migrate and upgrade current members first, with cooperatives included from the pilot onward and supported by training. This builds supply, revenue and catalogue quality before consumer marketing.
4. **Make compliance a feature.** Register with NCSA, secure the transfer path, and publish a short, plain-language photo-privacy promise.
5. **Own local quality.** Build and publish a Rwandan try-on benchmark. It's both a risk control and a marketing advantage.
6. **Design the economics in.** Cap free try-ons, fund try-ons through page plans, cache results, and keep a provider-agnostic gateway.
7. **Keep the ecosystem positioning.** Vision should be the try-on layer inside Nyambika's member pages and the social channels members already use.
8. **Clean up the proposal** (remove AI-chat artefacts and tracking links) before it goes to any external audience.

---

## Sources
**Market and Rwanda context**
- [Trade.gov – Rwanda Country Commercial Guide: eCommerce](https://trade.gov/country-commercial-guides/rwanda-ecommerce)
- [ECDB – E-Commerce Industry in Rwanda](https://ecdb.com/resources/sample-data/market/rw/all)
- [TechCabal – Rwanda hits 38% internet penetration (Jun 2025)](https://techcabal.com/2025/06/12/rwanda-internet-penetration-rate/)
- [Research ICT Africa – RAMP Index Q1 2025](https://researchictafrica.net/2025/03/31/ramp-index-insights-quarter-1-2025/)
- [Statista – Price for mobile data in Rwanda](https://statista.com/statistics/1272762/price-for-mobile-data-in-rwanda)
- [Living in Kigali – Online shopping in Rwanda](https://livinginkigali.com/online-shopping-in-rwanda/)
- [AllAfrica – How Rwanda's e-commerce sector grew in 2023](https://allafrica.com/stories/202404090409.html)
- [CNBC Africa – Vuba Vuba eyes Africa expansion](https://www.cnbcafrica.com/2020/rwandan-e-commerce-platform-vuba-vuba-eyes-africa-expansion)
- [The EastAfrican – Kasha sets up in Kenya](https://www.theeastafrican.co.ke/tea/business/rwanda-e-retailer-for-women-products-sets-up-in-kenya-1417704)
- [Fashionomics Africa – Rwanda fashion sector document](https://fashionomicsafrica.org/documents/uploads/dfa64267f6916ed4b8261d6a23855092.pdf)
- [Fibre2Fashion – Rwanda has not banned sale of second-hand clothes](https://www.fibre2fashion.com/news/apparel-news/rwanda-has-not-banned-sale-of-second-hand-clothes-minister-241025-newsdetails.htm?amp=true)
- [Quartz – US suspends Rwanda AGOA eligibility](https://qz.com/africa/1245015/trump-trade-war-us-suspends-rwanda-agoa-eligibility-over-secondhand-clothes-ban)
- [Currency.Wiki – USD/RWF](https://currency.wiki/usd-rwf?amount=50)
- [City of Kigali – Agaseke craft cooperatives](https://www.kigalicity.gov.rw/1/agaseke-craft)
- [TradeMark Africa – Cross-border trade lifts women out of poverty in Rwanda](https://trademarkafrica.com/roaring-cross-border-trade-lifts-thousands-of-women-out-of-poverty-in-rwanda/)
- [The New Times – How Muhanga women use cooperatives to fight poverty](https://newtimes.co.rw/article/131888/News/how-muhanga-women-are-using-co-operatives-to-fight-poverty)
- [The New Times – Mama Rwanda sewing project](https://www.newtimes.co.rw/section/read/195886)
- [Fundsforngos – Rwanda's path from startup ambition to digital business success (Jan 2026)](https://news.fundsforngos.org/2026/01/13/rwandas-path-from-startup-ambition-to-digital-business-success/)
- [MINICT – Rwanda Innovation Fund investment criteria](https://www.minict.gov.rw/news-detail/investment-criteria-for-the-rwanda-innovation-fund-managed-by-angaza-capital)

**Virtual fitting market and evidence**
- [GII / Knowledge Sourcing – Virtual fitting room market forecast](https://www.giiresearch.com/report/ksi1878262-virtual-fitting-room-market-forecasts-from.html)
- [GII / 360iResearch – Virtual fitting room market](https://www.giiresearch.com/report/ires1806595-virtual-fitting-room-market-by-technology-pricing.html)
- [Business Wire / ResearchAndMarkets – Virtual Fitting Rooms 2024–2030](https://www.businesswire.com/news/home/20250212547360/en)
- [MarketResearch.com – Global Virtual Fitting Room Market 2025–2031](https://marketresearch.com/LP-Information-Inc-v4134/Global-Virtual-Fitting-Room-Growth-39249165)
- [IMARC – Global virtual fitting room market](https://www.imarcgroup.com/global-virtual-fitting-room-market)
- [AI Frame – Does virtual try-on actually work? Industry data](https://intercom.help/ai-frame/en/articles/15908603-does-virtual-try-on-actually-work-what-the-industry-data-says)
- [Kleep – How to reduce returns in e-commerce](https://kleep.ai/blog/how-to-reduce-returns-ecommerce-12-tactics)
- [Fashion Mannuscript – YourFit lowers return rates by 47%](https://www.mannpublications.com/fashionmannuscript/2022/11/08/yourfit-virtual-fitting-room-lowers-return-rates-by-47/)

**Technology, pricing and licensing**
- [FASHN – API pricing](https://help.fashn.ai/plans-and-pricing/api-pricing)
- [FASHN – Try-On Max docs](https://docs.fashn.ai/api-reference/tryon-max)
- [FASHN – Comparing top open-source VTON models](https://fashn.ai/blog/comparing-the-top-4-open-source-virtual-try-on-viton-models)
- [fal.ai – Google Virtual Try-On](https://fal.ai/models/google/virtual-try-on/llms.txt)
- [fal.ai – Best virtual try-on APIs 2026](https://fal.ai/learn/tools/best-virtual-try-on-apis-2026)
- [Pixazo – Google Virtual Try-On API](https://www.pixazo.ai/blog/introducing-google-virtual-try-on-api-on-pixazo-api)
- [Google Cloud – Vertex AI virtual try-on](https://cloud.google.com/vertex-ai/generative-ai/docs/models/imagen/virtual-try-on-preview-08-04?hl=zh-cn)
- [Hugging Face – IDM-VTON model card (CC BY-NC-SA 4.0)](https://huggingface.co:443/yisol/IDM-VTON/blob/main/README.md)
- [Tripo – Developer docs v3.1](https://developers.tripo3d.com/en/models/v3-1)
- [Sloyd – 3D AI pricing comparison 2026](https://sloyd.ai/blog/3d-ai-price-comparison)
- [3DLOOK – Body scanning technology comparison](https://3dlook.ai/content-hub/body-scanning-technology-comparison/)
- [Frontiers in Medicine – Smartphone body measurement study (2024)](https://frontiersin.org/journals/medicine/articles/10.3389/fmed.2024.1485450/pdf)

**Bias and fairness**
- [NeurIPS 2026 – AfriVTON-Bench](https://neurips.cc/virtual/2026/179355)
- [AfriVTON project page](https://dev-tyta.github.io/projects/afrivton.html)
- [IJERT – Why AI gets Black hair wrong (StyleMyCrown)](https://www.ijert.org/why-ai-gets-black-hair-wrong-documented-failure-modes-and-architectural-fixes-in-a-production-try-on-system-ijertv15is070651)

**Competitors**
- [TechCrunch – Google launches Doppl](https://techcrunch.com/2025/06/26/google-launches-doppl-a-new-app-that-lets-you-visualize-how-an-outfit-might-look-on-you)
- [Google Labs – Doppl shutdown notice](https://support.google.com/labs/answer/16537062?hl=en)
- [Google Try On launches in Latin America (May 2026)](https://pasqualepillitteri.it/en/news/2404/google-try-on-virtual-fitting-room-ai-latam-2026)
- [Techpoint Africa – Luciana Womenswear AI try-on](https://techpoint.africa/brandpress/luciana-womenswear-introduces-nigerias-first-ai-virtual-try-on/)
- [VC4A – Maiyaah](https://vc4a.com/ventures/maiyaah/)

**Legal and payments**
- [DLA Piper – Data Protection in Rwanda](https://www.dlapiperdataprotection.com/?c=RW&t=law)
- [Hogan Lovells – Key features of the new Rwandan data protection law](https://hoganlovells.com/en/publications/key-features-of-the-new-rwandan-data-protection-law)
- [DataGuidance – Rwanda overview](https://www.dataguidance.com/notes/rwanda-data-protection-overview)
- [PwC Rwanda – Regulatory alert: consent & legitimate interest](https://www.pwc.com/rw/en/assets/pdf/regulatory-alert-consent-legitimate-interest.pdf)
- [MINICT – Rwanda passes new law protecting personal data](https://minict.gov.rw/news-detail/rwanda-passes-new-law-protecting-personal-data)
- [MTN Rwanda MoMo Developer – Products](https://momodeveloper.mtn.co.rw/products)
- [Kolonell – MTN & Airtel MoMo API fees in Kigali (2026)](https://kolonell.com/en/blog/rwanda-mtn-airtel-momo-api-fees-kigali-2026)
- [Mctaba – MoMo API integration Rwanda](https://mctaba.com/learn/rwanda/momo-api-integration-rwanda)
- [Mctaba – Software developer salaries in Rwanda](https://mctaba.com/learn/rwanda/software-developer-salaries-rwanda)
- [Levels.fyi – Software engineer pay, Kigali](https://www.levels.fyi/t/software-engineer/locations/kigali-rwa)
