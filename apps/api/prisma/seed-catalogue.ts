/**
 * Realistic, fictional seed catalogue (docs/seed-data.md). Eight fictional Kigali makers, checked against public
 * web info for collisions with real businesses; real neighbourhoods; products mapped to openly licensed garment
 * photos (scripts/seed-assets); RWF prices, lead times and size charts from the seed research (§4).
 *
 * Kinyarwanda copy is a draft: every `rw` row is stored with needsReview=true until a native speaker signs it off.
 */
import type { MemberType } from "@prisma/client";

export type L3 = { rw: string; en: string; fr: string };

export interface MakerDef {
  handle: string;
  name: string;
  memberType: MemberType;
  owner: string; // phone (+250…), also the login the crawls use
  ownerName: string;
  district: string;
  sector: string;
  story: string;
  theme: string;
  rating: number;
  reviewCount: number;
  plan: "BASIC" | "PRO" | "BUSINESS" | "COOPERATIVE";
  /** Cooperative makers (attribution on products, FR-COOP-02). The first may have a login. */
  members?: { name: string; phone?: string; momo?: string }[];
}

export interface ProductDef {
  handle: string;
  /** Description template: dress | wrap | umushanana | shirt | skirt | tee | blouse | jacket | fabric | stole */
  kind: string;
  category: string;
  title: L3;
  /** One asset key per colour (scripts/seed-assets/recipes.json); each colour is a real photo or a recolour of one. */
  colours: { asset: string; name: L3 }[];
  priceRwf: number;
  madeToOrder: boolean;
  leadTimeDays: number;
  styles: string[];
  occasions: string[];
  fabric: string;
  featured?: boolean;
  chart?: "women" | "men" | "none";
}

export const MAKERS: MakerDef[] = [
  {
    handle: "umurage-wear",
    name: "Umurage Wear",
    memberType: "TAILOR",
    owner: "+250788100001",
    ownerName: "Mukeshimana Diane",
    district: "Gasabo",
    sector: "Kimihurura",
    story: "A small atelier off KG 7 Avenue. I cut day dresses and wrap pieces to your measurements, with one fitting and free alterations for a week.",
    theme: "terra",
    rating: 4.8,
    reviewCount: 126,
    plan: "PRO",
  },
  {
    handle: "urudodo-collective",
    name: "Urudodo Stitch Collective",
    memberType: "COOPERATIVE",
    owner: "+250788100002",
    ownerName: "Uwamahoro Claudine",
    district: "Nyarugenge",
    sector: "Nyamirambo",
    story: "Twelve tailors sharing one workshop in Nyamirambo. Shirts and skirts made to order; every piece names the member who sewed it and pays them directly.",
    theme: "forest",
    rating: 4.7,
    reviewCount: 58,
    plan: "COOPERATIVE",
    members: [
      { name: "Mukamana Jeanne", phone: "+250788100004", momo: "0788100004" },
      { name: "Uwimana Grace", momo: "0788100007" },
      { name: "Nyirahabimana Alice" },
    ],
  },
  {
    handle: "kanombe-kitenge-corner",
    name: "Kanombe Kitenge Corner",
    memberType: "SELLER",
    owner: "+250788100003",
    ownerName: "Mutoni Grace",
    district: "Kicukiro",
    sector: "Kanombe",
    story: "Fabric by the yard and ready-to-wear pieces near the Kanombe roundabout. Order on WhatsApp, moto delivery across Kigali the same or next day.",
    theme: "indigo",
    rating: 4.5,
    reviewCount: 211,
    plan: "BASIC",
  },
  {
    handle: "inkindi-studio",
    name: "Inkindi Studio",
    memberType: "TAILOR",
    owner: "+250788100005",
    ownerName: "Habimana Eric",
    district: "Nyarugenge",
    sector: "Kiyovu",
    story: "Ceremony wear for gusaba and weddings: umushanana, blouses and gowns, hand-finished in Kiyovu. Book two fittings; we plan around wedding season.",
    theme: "violet",
    rating: 4.6,
    reviewCount: 74,
    plan: "PRO",
  },
  {
    handle: "akeza-couture",
    name: "Akeza Couture",
    memberType: "SELLER",
    owner: "+250788100006",
    ownerName: "Uwera Ange",
    district: "Gasabo",
    sector: "Kacyiru",
    story: "Office dresses and blouses for the working week, in stock in sizes S to XL. New pieces every Friday.",
    theme: "terra",
    rating: 4.4,
    reviewCount: 39,
    plan: "BASIC",
  },
  {
    handle: "isimbi-tailoring",
    name: "Isimbi Tailoring",
    memberType: "TAILOR",
    owner: "+250788100008",
    ownerName: "Ingabire Solange",
    district: "Gasabo",
    sector: "Kimironko",
    story: "A stall in Kimironko market. Bring your kitenge or pick one of ours; most dresses are ready in one to three days.",
    theme: "forest",
    rating: 4.3,
    reviewCount: 88,
    plan: "BASIC",
  },
  {
    handle: "rebero-threads",
    name: "Rebero Threads",
    memberType: "SELLER",
    owner: "+250788100009",
    ownerName: "Niyonsaba Aimée",
    district: "Kicukiro",
    sector: "Kigarama (Rebero)",
    story: "A home studio on Rebero hill printing imigongo-inspired motifs on cotton tees. Small batches, printed by hand.",
    theme: "violet",
    rating: 4.6,
    reviewCount: 27,
    plan: "BASIC",
  },
  {
    handle: "gikondo-makers-coop",
    name: "Gikondo Makers Coop",
    memberType: "COOPERATIVE",
    owner: "+250788100010",
    ownerName: "Nshimiyimana Jean Bosco",
    district: "Kicukiro",
    sector: "Gikondo",
    story: "Men's shirts, work jackets and school or company uniforms, sewn by a cooperative in Gikondo. Bulk orders of ten or more in two to three weeks.",
    theme: "indigo",
    rating: 4.5,
    reviewCount: 41,
    plan: "COOPERATIVE",
    members: [{ name: "Ndayisaba Jean Paul" }, { name: "Mukandayisenga Odette" }],
  },
];

const c = (asset: string, rw: string, en: string, fr: string) => ({ asset, name: { rw, en, fr } });

export const PRODUCTS: ProductDef[] = [
  // ---- Umurage Wear (boutique made to order, 5–10 days)
  {
    handle: "umurage-wear", kind: "dress", category: "dress", featured: true,
    title: { rw: "Ikanzu Ineza (A-line)", en: "Ineza A-line dress", fr: "Robe trapèze Ineza" },
    colours: [c("g32", "Umweru w'indabyo", "Cream floral", "Crème fleurie"), c("g32-indigo", "Ubururu bw'indabyo", "Indigo floral", "Indigo fleurie"), c("g32-teal", "Icyatsi cy'indabyo", "Teal floral", "Sarcelle fleurie")],
    priceRwf: 42000, madeToOrder: true, leadTimeDays: 6, styles: ["elegant", "modern"], occasions: ["wedding", "church", "party"], fabric: "Printed cotton lawn",
  },
  {
    handle: "umurage-wear", kind: "dress", category: "dress",
    title: { rw: "Ikanzu-shati Gisenyi", en: "Gisenyi shirt dress", fr: "Robe chemise Gisenyi" },
    colours: [c("g35", "Iroza", "Fuchsia", "Fuchsia"), c("g35-teal", "Ubururu bw'icyatsi", "Teal", "Sarcelle"), c("g35-gold", "Umuhondo", "Marigold", "Souci")],
    priceRwf: 38500, madeToOrder: true, leadTimeDays: 5, styles: ["modern", "bold"], occasions: ["office", "party", "casual"], fabric: "Cotton poplin",
  },
  {
    handle: "umurage-wear", kind: "dress", category: "dress",
    title: { rw: "Ikanzu y'imitako Akagera", en: "Akagera tiered lace dress", fr: "Robe à volants en dentelle Akagera" },
    colours: [c("g33", "Ubururu bwerurutse", "Slate blue", "Bleu ardoise"), c("g33-plum", "Iroza yijimye", "Plum", "Prune")],
    priceRwf: 56000, madeToOrder: true, leadTimeDays: 9, styles: ["elegant", "traditional"], occasions: ["wedding", "party"], fabric: "Taffeta with lace overlay",
  },
  {
    handle: "umurage-wear", kind: "wrap", category: "wrap", chart: "none",
    title: { rw: "Umukenyero w'adire (m 2)", en: "Adire wrapper, 2 m", fr: "Pagne adire (2 m)" },
    colours: [c("g11", "Ubururu bwijimye", "Indigo", "Indigo"), c("g11-forest", "Icyatsi kibisi", "Forest green", "Vert forêt")],
    priceRwf: 18500, madeToOrder: false, leadTimeDays: 1, styles: ["traditional", "casual"], occasions: ["casual", "traditional-ceremony"], fabric: "Hand-dyed cotton (adire)",
  },

  // ---- Urudodo Stitch Collective (cooperative, made to order)
  {
    handle: "urudodo-collective", kind: "shirt", category: "shirt", featured: true,
    title: { rw: "Ishati y'imitako gakondo", en: "Heritage print shirt", fr: "Chemise imprimé héritage" },
    colours: [c("g07", "Iroza yijimye", "Berry", "Baie"), c("g07-ocean", "Ubururu", "Ocean blue", "Bleu océan")],
    priceRwf: 26500, madeToOrder: true, leadTimeDays: 4, styles: ["modern", "bold"], occasions: ["casual", "party", "office"], fabric: "Cotton print", chart: "men",
  },
  {
    handle: "urudodo-collective", kind: "skirt", category: "skirt",
    title: { rw: "Ijipo ya A-line Nyamirambo", en: "Nyamirambo A-line skirt", fr: "Jupe trapèze Nyamirambo" },
    colours: [c("g25", "Ikigina", "Khaki", "Kaki"), c("g25-terracotta", "Icunga ryijimye", "Terracotta", "Terre cuite"), c("g25-navy", "Ubururu bwijimye", "Navy", "Marine")],
    priceRwf: 18000, madeToOrder: true, leadTimeDays: 3, styles: ["minimal", "casual"], occasions: ["office", "church", "casual"], fabric: "Wool-blend twill",
  },
  {
    handle: "urudodo-collective", kind: "skirt", category: "skirt",
    title: { rw: "Ijipo yagutse y'amabara azunguruka", en: "Swirl print flare skirt", fr: "Jupe évasée à motifs tourbillons" },
    colours: [c("g28", "Icyatsi", "Jade swirl", "Tourbillon jade"), c("g28-cobalt", "Ubururu", "Cobalt swirl", "Tourbillon cobalt")],
    priceRwf: 22000, madeToOrder: true, leadTimeDays: 4, styles: ["bold", "modern"], occasions: ["party", "church"], fabric: "Printed chiffon over cotton",
  },
  {
    handle: "urudodo-collective", kind: "skirt", category: "skirt",
    title: { rw: "Ijipo ndende ifashe", en: "Ankle-length pencil skirt", fr: "Jupe crayon longue" },
    colours: [c("g24", "Umukara", "Black", "Noir")],
    priceRwf: 19500, madeToOrder: true, leadTimeDays: 3, styles: ["elegant", "minimal"], occasions: ["office", "church"], fabric: "Crepe",
  },

  // ---- Kanombe Kitenge Corner (ready to wear + fabric; the first three READY products seed the Kenyan region page)
  {
    handle: "kanombe-kitenge-corner", kind: "dress", category: "dress", featured: true,
    title: { rw: "Ikanzu ndende ya kaftani", en: "Golden kaftan maxi", fr: "Caftan long doré" },
    colours: [c("g12", "Umuhondo wa zahabu", "Gold", "Or"), c("g12-emerald", "Icyatsi kibisi", "Emerald", "Émeraude")],
    priceRwf: 45000, madeToOrder: false, leadTimeDays: 1, styles: ["elegant", "traditional"], occasions: ["wedding", "party", "traditional-ceremony"], fabric: "Brocade",
  },
  {
    handle: "kanombe-kitenge-corner", kind: "shirt", category: "shirt",
    title: { rw: "Ishati y'indabyo, ubururu bwijimye", en: "Navy floral print shirt", fr: "Chemise à fleurs marine" },
    colours: [c("g14", "Ubururu bwijimye", "Navy", "Marine")],
    priceRwf: 21000, madeToOrder: false, leadTimeDays: 1, styles: ["casual", "bold"], occasions: ["casual", "party"], fabric: "Rayon print", chart: "men",
  },
  {
    handle: "kanombe-kitenge-corner", kind: "skirt", category: "skirt",
    title: { rw: "Ijipo y'ubwoya, ibara ry'ivu", en: "Grey wool midi skirt", fr: "Jupe midi en laine grise" },
    colours: [c("g27", "Ibara ry'ivu", "Charcoal grey", "Gris anthracite")],
    priceRwf: 16500, madeToOrder: false, leadTimeDays: 1, styles: ["minimal", "elegant"], occasions: ["office", "church"], fabric: "Wool flannel",
  },
  {
    handle: "kanombe-kitenge-corner", kind: "fabric", category: "fabric", chart: "none",
    title: { rw: "Igitenge, yarida 6", en: "Igitenge print, 6 yards", fr: "Pagne igitenge, 6 yards" },
    colours: [c("s21", "Icyatsi n'umweru", "Lime and lilac", "Citron vert et lilas")],
    priceRwf: 12000, madeToOrder: false, leadTimeDays: 1, styles: ["traditional"], occasions: ["casual"], fabric: "Cotton wax print, 6 yd (5.5 m)",
  },
  {
    handle: "kanombe-kitenge-corner", kind: "fabric", category: "fabric", chart: "none",
    title: { rw: "Kanga ebyiri (leso)", en: "Kanga pair (leso)", fr: "Paire de kangas (leso)" },
    colours: [c("s29", "Ubururu n'iroza", "Teal and magenta", "Sarcelle et magenta")],
    priceRwf: 9000, madeToOrder: false, leadTimeDays: 1, styles: ["traditional"], occasions: ["casual"], fabric: "Printed cotton, 2 × 1.5 m",
  },
  {
    handle: "kanombe-kitenge-corner", kind: "dress", category: "dress",
    title: { rw: "Ikanzu y'igitenge, ubururu", en: "Blue kitenge sundress", fr: "Robe d'été en kitenge bleu" },
    colours: [c("g01", "Ubururu", "Blue print", "Imprimé bleu")],
    priceRwf: 24000, madeToOrder: false, leadTimeDays: 1, styles: ["casual", "bold"], occasions: ["casual", "party"], fabric: "Cotton kitenge",
  },

  // ---- Inkindi Studio (ceremony wear, 7–14 days)
  {
    handle: "inkindi-studio", kind: "umushanana", category: "umushanana", featured: true,
    title: { rw: "Umushanana w'ibirori Inkindi", en: "Inkindi ceremony umushanana", fr: "Umushanana de cérémonie Inkindi" },
    colours: [c("umushanana-kente", "Amabara ya kente", "Kente gold", "Kente doré"), c("umushanana-igitenge", "Igitenge cy'icyatsi", "Lime igitenge", "Igitenge citron vert")],
    priceRwf: 95000, madeToOrder: true, leadTimeDays: 12, styles: ["traditional", "elegant"], occasions: ["traditional-ceremony", "wedding"], fabric: "Woven cotton with sash",
  },
  {
    handle: "inkindi-studio", kind: "blouse", category: "top",
    title: { rw: "Ishati y'abagore idoze imitako", en: "Embroidered gusaba blouse", fr: "Blouse brodée pour gusaba" },
    colours: [c("g21", "Umweru", "White", "Blanc")],
    priceRwf: 32000, madeToOrder: true, leadTimeDays: 7, styles: ["elegant", "traditional"], occasions: ["traditional-ceremony", "church"], fabric: "Embroidered cotton voile",
  },
  {
    handle: "inkindi-studio", kind: "blouse", category: "top",
    title: { rw: "Igice cyo hejuru cy'ibirori, umukara", en: "Black ceremony bodice", fr: "Corsage de cérémonie noir" },
    colours: [c("g38", "Umukara", "Black", "Noir")],
    priceRwf: 36000, madeToOrder: true, leadTimeDays: 8, styles: ["elegant"], occasions: ["wedding", "party"], fabric: "Silk faille",
  },
  {
    handle: "inkindi-studio", kind: "dress", category: "dress",
    title: { rw: "Ikanzu ndende y'indabyo nto", en: "Heirloom sprig gown", fr: "Robe longue à brins fleuris" },
    colours: [c("g36", "Umweru", "Cream", "Crème"), c("g36-rose", "Iroza yerurutse", "Dusty rose", "Vieux rose")],
    priceRwf: 68000, madeToOrder: true, leadTimeDays: 10, styles: ["elegant", "traditional"], occasions: ["wedding", "traditional-ceremony"], fabric: "Printed cotton muslin",
  },
  {
    handle: "inkindi-studio", kind: "stole", category: "accessories", chart: "none",
    title: { rw: "Igitambaro cya kente cyo ku bitugu", en: "Kente stole", fr: "Étole kente" },
    colours: [c("g10", "Amabara menshi", "Multicolour", "Multicolore")],
    priceRwf: 28000, madeToOrder: false, leadTimeDays: 1, styles: ["traditional"], occasions: ["traditional-ceremony", "wedding"], fabric: "Hand-woven kente",
  },

  // ---- Akeza Couture (office wear, in stock)
  {
    handle: "akeza-couture", kind: "dress", category: "dress", featured: true,
    title: { rw: "Ikanzu y'akazi, amaboko maremare", en: "Long-sleeve black office dress", fr: "Robe de bureau noire à manches longues" },
    colours: [c("g31", "Umukara", "Black", "Noir")],
    priceRwf: 34000, madeToOrder: false, leadTimeDays: 1, styles: ["minimal", "elegant"], occasions: ["office", "church"], fabric: "Viscose crepe",
  },
  {
    handle: "akeza-couture", kind: "blouse", category: "top",
    title: { rw: "Ishati y'abagore ifite dantele ku maboko", en: "Lace-cuff linen blouse", fr: "Blouse en lin à poignets de dentelle" },
    colours: [c("g39", "Umweru w'inzovu", "Ivory", "Ivoire")],
    priceRwf: 23500, madeToOrder: false, leadTimeDays: 1, styles: ["elegant", "minimal"], occasions: ["office", "church"], fabric: "Linen with lace",
  },
  {
    handle: "akeza-couture", kind: "blouse", category: "top",
    title: { rw: "Ishati y'abagore y'ipamba, ijosi rya kare", en: "Square-neck cotton blouse", fr: "Blouse en coton à col carré" },
    colours: [c("g40", "Umweru", "Ecru", "Écru")],
    priceRwf: 19500, madeToOrder: false, leadTimeDays: 1, styles: ["minimal", "casual"], occasions: ["office", "casual"], fabric: "Cotton lawn",
  },
  {
    handle: "akeza-couture", kind: "dress", category: "dress",
    title: { rw: "Ikanzu y'igitenge, umutuku wijimye", en: "Burgundy kitenge day dress", fr: "Robe de jour en kitenge bordeaux" },
    colours: [c("g02", "Umutuku wijimye", "Burgundy print", "Imprimé bordeaux")],
    priceRwf: 27500, madeToOrder: false, leadTimeDays: 1, styles: ["casual", "traditional"], occasions: ["casual", "church"], fabric: "Cotton kitenge",
  },

  // ---- Isimbi Tailoring (market stall: shop photos, quick turnaround)
  {
    handle: "isimbi-tailoring", kind: "dress", category: "dress",
    title: { rw: "Ikanzu y'ibice bibiri y'igitenge", en: "Two-piece kitenge dress", fr: "Robe deux pièces en kitenge" },
    colours: [c("g04", "Umuhondo n'ubururu", "Yellow and teal", "Jaune et sarcelle")],
    priceRwf: 22000, madeToOrder: true, leadTimeDays: 2, styles: ["bold", "traditional"], occasions: ["party", "church"], fabric: "Cotton kitenge",
  },
  {
    handle: "isimbi-tailoring", kind: "dress", category: "dress",
    title: { rw: "Ikanzu ndende y'igitenge, umukara n'umuhondo", en: "Black and yellow kitenge maxi", fr: "Robe longue kitenge noir et jaune" },
    colours: [c("g05", "Umukara n'umuhondo", "Black and yellow", "Noir et jaune")],
    priceRwf: 25000, madeToOrder: true, leadTimeDays: 3, styles: ["bold"], occasions: ["party", "wedding"], fabric: "Cotton kitenge",
  },
  {
    handle: "isimbi-tailoring", kind: "dress", category: "dress",
    title: { rw: "Kaftani y'igitenge gisize amabara", en: "Tie-dye kitenge kaftan", fr: "Caftan kitenge tie-dye" },
    colours: [c("g03", "Ubururu n'umuhondo", "Indigo and ochre", "Indigo et ocre")],
    priceRwf: 21000, madeToOrder: true, leadTimeDays: 2, styles: ["casual", "bold"], occasions: ["casual", "party"], fabric: "Tie-dyed cotton",
  },
  {
    handle: "isimbi-tailoring", kind: "shirt", category: "shirt",
    title: { rw: "Ishati y'igitenge, ubururu bwerurutse", en: "Pale blue kitenge shirt", fr: "Chemise kitenge bleu clair" },
    colours: [c("g06", "Ubururu bwerurutse", "Pale blue", "Bleu clair")],
    priceRwf: 16500, madeToOrder: true, leadTimeDays: 1, styles: ["casual"], occasions: ["casual", "office"], fabric: "Cotton", chart: "men",
  },

  // ---- Rebero Threads (printed tees)
  {
    handle: "rebero-threads", kind: "tee", category: "top", featured: true,
    title: { rw: "Umupira ufite imitako y'imigongo", en: "Imigongo chevron tee", fr: "T-shirt motif imigongo à chevrons" },
    colours: [c("g18-imigongo", "Umukara", "Black", "Noir")],
    priceRwf: 13500, madeToOrder: false, leadTimeDays: 1, styles: ["modern", "casual"], occasions: ["casual"], fabric: "Cotton jersey, hand screen-printed",
  },
  {
    handle: "rebero-threads", kind: "tee", category: "top",
    title: { rw: "Umupira w'umukara usanzwe", en: "Essential black tee", fr: "T-shirt noir essentiel" },
    colours: [c("g18", "Umukara", "Black", "Noir")],
    priceRwf: 8500, madeToOrder: false, leadTimeDays: 1, styles: ["minimal", "casual"], occasions: ["casual"], fabric: "Cotton jersey",
  },
  {
    handle: "rebero-threads", kind: "tee", category: "top",
    title: { rw: "Umupira w'ipamba ukomeye", en: "Heavyweight cotton tee", fr: "T-shirt en coton épais" },
    colours: [c("g20", "Umuhondo", "Mustard", "Moutarde"), c("g20-sage", "Icyatsi cyerurutse", "Sage", "Sauge")],
    priceRwf: 11000, madeToOrder: false, leadTimeDays: 1, styles: ["casual", "minimal"], occasions: ["casual"], fabric: "Heavyweight cotton jersey",
  },
  {
    handle: "rebero-threads", kind: "tee", category: "top",
    title: { rw: "Umupira ufite amashusho y'amasura", en: "Mask-print tee", fr: "T-shirt imprimé masques" },
    colours: [c("g09", "Ubururu bw'icyatsi", "Teal print", "Imprimé sarcelle")],
    priceRwf: 14500, madeToOrder: false, leadTimeDays: 1, styles: ["bold", "casual"], occasions: ["casual", "party"], fabric: "Cotton jersey, all-over print",
  },

  // ---- Gikondo Makers Coop (men's shirts, workwear)
  {
    handle: "gikondo-makers-coop", kind: "shirt", category: "shirt", featured: true,
    title: { rw: "Ishati y'akazi, amaboko maremare", en: "Point-collar office shirt", fr: "Chemise de bureau col pointu" },
    colours: [c("g22", "Icunga", "Burnt orange", "Orange brûlé"), c("g22-petrol", "Ubururu bwijimye", "Petrol blue", "Bleu pétrole"), c("g22-wine", "Umutuku wijimye", "Wine", "Lie-de-vin")],
    priceRwf: 27500, madeToOrder: true, leadTimeDays: 5, styles: ["modern", "minimal"], occasions: ["office", "church"], fabric: "Cotton poplin", chart: "men",
  },
  {
    handle: "gikondo-makers-coop", kind: "jacket", category: "jacket",
    title: { rw: "Ikoti ry'akazi (samue)", en: "Samue work jacket", fr: "Veste de travail samue" },
    colours: [c("g13", "Ubururu", "Cornflower", "Bleuet"), c("g13-indigo", "Ubururu bwijimye", "Deep indigo", "Indigo profond")],
    priceRwf: 39000, madeToOrder: true, leadTimeDays: 7, styles: ["minimal", "casual"], occasions: ["office", "casual"], fabric: "Cotton drill", chart: "men",
  },
  {
    handle: "gikondo-makers-coop", kind: "shirt", category: "shirt",
    title: { rw: "Ishati ya kera ifite imitako", en: "Vintage print camp shirt", fr: "Chemise vintage imprimée" },
    colours: [c("g17", "Umweru n'icunga", "Cream and rust", "Crème et rouille")],
    priceRwf: 23000, madeToOrder: true, leadTimeDays: 5, styles: ["casual", "bold"], occasions: ["casual", "party"], fabric: "Cotton print", chart: "men",
  },
];

// ---- size charts (body cm; research §4d)
export const WOMEN_CHART = [
  { size: "XS", uk: "6", eu: "34", bustCm: [80, 83], waistCm: [62, 65], hipsCm: [86, 89] },
  { size: "S", uk: "8–10", eu: "36–38", bustCm: [84, 90], waistCm: [66, 72], hipsCm: [90, 96] },
  { size: "M", uk: "12", eu: "40", bustCm: [91, 96], waistCm: [73, 78], hipsCm: [97, 102] },
  { size: "L", uk: "14–16", eu: "42–44", bustCm: [97, 106], waistCm: [79, 88], hipsCm: [103, 112] },
  { size: "XL", uk: "18", eu: "46", bustCm: [107, 112], waistCm: [89, 96], hipsCm: [113, 120] },
  { size: "XXL", uk: "20–22", eu: "48–50", bustCm: [113, 124], waistCm: [97, 108], hipsCm: [121, 132] },
];
export const MEN_CHART = [
  { size: "S", chestCm: [88, 94], neckCm: [37, 38] },
  { size: "M", chestCm: [95, 101], neckCm: [39, 40] },
  { size: "L", chestCm: [102, 108], neckCm: [41, 42] },
  { size: "XL", chestCm: [109, 116], neckCm: [43, 44] },
  { size: "XXL", chestCm: [117, 124], neckCm: [45, 46] },
];

// ---- trilingual descriptions (research §4e templates)
const FIT: Record<string, L3> = {
  dress: { rw: "Ifashe ku mubiri, ikagera ku ivi cyangwa munsi", en: "Fitted bodice, knee to midi length", fr: "Buste ajusté, longueur genou à mi-mollet" },
  wrap: { rw: "Umwenda wo kuzinga, m 2", en: "A 2 m length to wrap or tie", fr: "Une longueur de 2 m à nouer" },
  umushanana: { rw: "Umwenda muremure n'umukenyero wo ku rutugu", en: "Floor-length drape with a shoulder sash", fr: "Drapé long avec écharpe d'épaule" },
  shirt: { rw: "Ishati iringaniye", en: "Regular fit", fr: "Coupe droite" },
  skirt: { rw: "Ifashe mu rukenyerero", en: "Fitted waist", fr: "Taille ajustée" },
  tee: { rw: "Umupira woroshye", en: "Relaxed fit", fr: "Coupe décontractée" },
  blouse: { rw: "Iringaniye, yoroshye", en: "Soft, easy fit", fr: "Coupe souple" },
  jacket: { rw: "Ikoti rigari ryo kuzirika", en: "Loose wrap-front fit, ties at the waist", fr: "Coupe ample croisée, nouée à la taille" },
  fabric: { rw: "Umwenda wo kudoda", en: "Fabric for tailoring", fr: "Tissu à confectionner" },
  stole: { rw: "Cyambarwa ku bitugu", en: "Worn over the shoulders", fr: "Se porte sur les épaules" },
};

export function describe(p: ProductDef, m: MakerDef): L3 {
  const fit = FIT[p.kind] ?? FIT.dress;
  const days = p.madeToOrder ? p.leadTimeDays : 0;
  if (p.kind === "fabric") {
    return {
      rw: `Umwenda wo kudoda. Biva kuri ${m.name} i ${m.sector}. Bigezwa i Kigali kuri moto umunsi umwe.`,
      en: `${p.fabric}, from ${m.name} in ${m.sector}. Ask for tailoring with it as a bundle. Moto delivery across Kigali within a day.`,
      fr: `Tissu à confectionner, chez ${m.name} à ${m.sector}. Confection possible en lot. Livraison à moto dans Kigali en un jour.`,
    };
  }
  const ill = p.kind === "umushanana" ? { rw: " Ifoto ni igishushanyo: ifoto nyayo iraza vuba.", en: " Image is an illustration until the studio photo is ready.", fr: " L'image est une illustration en attendant la photo." } : { rw: "", en: "", fr: "" };
  return {
    rw: `Yadozwe n'intoki na ${m.name} i ${m.sector}. ${fit.rw}. ${days ? `Itegurwa mu minsi ${days}.` : "Irahari, igezwa umunsi umwe."} Kuyifura: amazi akonje, kuyanika mu gicucu.${ill.rw}`,
    en: `Hand-finished by ${m.name} in ${m.sector}, in ${p.fabric.toLowerCase()}. ${fit.en}. ${days ? `Made to order in ${days} days; free alterations within 7 days.` : "In stock, delivered in Kigali within a day."} Care: cold hand wash, dry in shade.${ill.en}`,
    fr: `Confectionné à la main par ${m.name} à ${m.sector}. ${fit.fr}. ${days ? `Sur commande en ${days} jours ; retouches gratuites sous 7 jours.` : "En stock, livré à Kigali en un jour."} Entretien : lavage à la main à froid, séchage à l'ombre.${ill.fr}`,
  };
}

export function sizesFor(p: ProductDef): string[] {
  if (p.chart === "none") return ["One size"];
  if (p.chart === "men") return ["S", "M", "L", "XL", "XXL"];
  return p.madeToOrder ? ["S", "M", "L", "XL", "XXL"] : ["S", "M", "L", "XL"];
}
