/*
  Findings that need no model: JSON-LD, tel and mailto links, social links,
  logo and award images, and the home page canonical. The quote is the raw
  value (or the JSON of the node) so the review screen can show where it came
  from.
*/
import type { Json, JsonLdBlock, PageImage, PageLinks } from "@/lib/db/types";
import type { AddressValue, EvidenceSource, FactValue, Finding, ListItem } from "@/lib/facts/types";
import { platformFromUrl } from "./normalize";

export interface CleanedMeta {
  title?: string | null;
  metaDescription?: string | null;
  canonical?: string | null;
  lang?: string | null;
  ogImage?: string | null;
}

type JsonObject = { [key: string]: Json | undefined };

function isObject(v: Json | undefined): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Every string a JSON-LD value holds: strings, numbers, and the name/@value/url of objects. */
function stringsOf(v: Json | undefined): string[] {
  if (v == null) return [];
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  if (typeof v === "number") return [String(v)];
  if (Array.isArray(v)) return v.flatMap(stringsOf);
  if (isObject(v)) {
    const inner = v["@value"] ?? v.name ?? v.url;
    return inner === undefined ? [] : stringsOf(inner);
  }
  return [];
}

function firstString(v: Json | undefined): string | null {
  return stringsOf(v)[0] ?? null;
}

function nodesOf(v: Json | undefined): JsonObject[] {
  if (Array.isArray(v)) return v.filter(isObject);
  return isObject(v) ? [v] : [];
}

function quoteOf(v: Json | undefined): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v ?? null);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function typesOf(node: JsonObject): string[] {
  return stringsOf(node["@type"]).map((t) => t.replace(/^.*[/#:]/, ""));
}

const ORG_TYPES = new Set([
  "Organization", "Corporation", "LocalBusiness", "OnlineBusiness", "OnlineStore", "NGO",
  "EducationalOrganization", "CollegeOrUniversity", "School", "Preschool", "ElementarySchool",
  "MiddleSchool", "HighSchool", "MedicalOrganization", "MedicalBusiness", "MedicalClinic",
  "Dentist", "Physician", "Pharmacy", "Hospital", "Optician", "Physiotherapy", "VeterinaryCare",
  "DiagnosticLab", "ProfessionalService", "LegalService", "Attorney", "Notary",
  "FinancialService", "AccountingService", "InsuranceAgency", "BankOrCreditUnion",
  "RealEstateAgent", "AutomotiveBusiness", "AutoRepair", "AutoDealer", "AutoBodyShop",
  "AutoWash", "GasStation", "ChildCare", "DryCleaningOrLaundry", "EmploymentAgency",
  "EntertainmentBusiness", "ArtGallery", "Casino", "MovieTheater", "NightClub",
  "FoodEstablishment", "Restaurant", "Bakery", "BarOrPub", "Brewery", "CafeOrCoffeeShop",
  "FastFoodRestaurant", "IceCreamShop", "Winery", "Distillery", "HealthAndBeautyBusiness",
  "BeautySalon", "DaySpa", "HairSalon", "HealthClub", "NailSalon", "TattooParlor",
  "HomeAndConstructionBusiness", "Electrician", "GeneralContractor", "HVACBusiness",
  "HousePainter", "Locksmith", "MovingCompany", "Plumber", "RoofingContractor",
  "InternetCafe", "Library", "LodgingBusiness", "Hotel", "Motel", "Resort", "Hostel",
  "BedAndBreakfast", "Campground", "VacationRental", "RadioStation", "TelevisionStation",
  "RecyclingCenter", "SelfStorage", "ShoppingCenter", "SportsActivityLocation", "ExerciseGym",
  "FitnessCenter", "GolfCourse", "SportsClub", "StadiumOrArena", "Store", "BikeStore",
  "BookStore", "ClothingStore", "ComputerStore", "ConvenienceStore", "DepartmentStore",
  "ElectronicsStore", "Florist", "FurnitureStore", "GardenStore", "GroceryStore",
  "HardwareStore", "HobbyShop", "HomeGoodsStore", "JewelryStore", "LiquorStore",
  "MensClothingStore", "MobilePhoneStore", "MusicStore", "OfficeEquipmentStore", "OutletStore",
  "PawnShop", "PetStore", "ShoeStore", "SportingGoodsStore", "TireShop", "ToyStore",
  "WholesaleStore", "TouristInformationCenter", "TravelAgency", "AnimalShelter",
  "ArchiveOrganization", "GovernmentOrganization", "GovernmentOffice", "PostOffice",
  "NewsMediaOrganization", "PerformingGroup", "SportsOrganization", "ResearchOrganization",
  "WorkersUnion", "Consortium", "Airline", "LibrarySystem", "FundingScheme", "Project",
]);

const ORG_SUFFIX = /(Business|Organization|Store|Shop|Agency|Dealer|Salon|Clinic|Contractor|Company|Practice|Firm|Studio)$/;

function isOrgType(type: string): boolean {
  if (ORG_TYPES.has(type)) return true;
  if (type === "Service" || type === "Product" || type === "Offer") return false;
  return ORG_SUFFIX.test(type);
}

/** Types that say nothing about the kind of business beyond the fallback the schema uses anyway. */
const GENERIC_ORG_TYPES = new Set(["Organization", "Corporation", "Thing"]);

/**
 * The site's own schema.org type for the business, when it says more than
 * Organization: a LocalBusiness block, or a subtype such as RoofingContractor.
 * The generic types are left to the model and the owner, since an SEO plugin
 * writes Organization on every site whatever the business is.
 */
function mapBusinessType(types: string[], node: JsonObject, c: Collector): void {
  const specific = types.find((t) => isOrgType(t) && !GENERIC_ORG_TYPES.has(t));
  if (specific) c.add("business_type", specific, quoteOf(node["@type"]));
}

/** Keys under which an Organization node describes some other organization, not this business. */
const OTHER_ORG_KEYS = new Set([
  "memberOf", "parentOrganization", "subOrganization", "brand", "sponsor", "funder",
  "affiliation", "alumniOf", "worksFor", "manufacturer", "department", "recipient",
  "issuedBy", "hiringOrganization", "award", "partner", "competitor",
]);

type Visited = { node: JsonObject; parentKey: string | null };

function walk(data: Json | undefined, parentKey: string | null, out: Visited[], depth: number): void {
  if (depth > 16 || data == null || typeof data !== "object") return;
  if (Array.isArray(data)) {
    for (const item of data) walk(item, parentKey, out, depth + 1);
    return;
  }
  out.push({ node: data, parentKey });
  for (const [key, value] of Object.entries(data)) {
    if (key === "@context") continue;
    walk(value, key === "@graph" ? parentKey : key, out, depth + 1);
  }
}

class Collector {
  readonly findings: Finding[] = [];
  private readonly seen = new Set<string>();

  constructor(
    private readonly url: string,
    private readonly source: EvidenceSource,
    private readonly confidence: number,
  ) {}

  get pageUrl(): string {
    return this.url;
  }

  add(fieldId: string, value: FactValue, quote: string, extra?: Partial<Pick<Finding, "derived" | "note" | "confidence">>): void {
    if (value == null) return;
    if (typeof value === "string" && !value.trim()) return;
    const key = `${fieldId}\u0000${JSON.stringify(value)}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const finding: Finding = {
      fieldId,
      value: typeof value === "string" ? value.trim() : value,
      quote,
      url: this.url,
      source: this.source,
      confidence: extra?.confidence ?? this.confidence,
    };
    if (extra?.derived) finding.derived = true;
    if (extra?.note) finding.note = extra.note;
    this.findings.push(finding);
  }
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_ABBREVIATIONS: Record<string, string> = {
  mo: "Monday", tu: "Tuesday", we: "Wednesday", th: "Thursday", fr: "Friday", sa: "Saturday", su: "Sunday",
};

function dayName(raw: string): string | null {
  const s = raw.trim().replace(/^.*[/#]/, "");
  if (!s) return null;
  if (/^publicholidays$/i.test(s)) return "Public holidays";
  const full = WEEK.find((d) => d.toLowerCase() === s.toLowerCase());
  if (full) return full;
  return DAY_ABBREVIATIONS[s.slice(0, 2).toLowerCase()] ?? null;
}

/** "Monday to Friday" for a run of three or more days, otherwise the days joined with commas. */
function joinDays(days: string[]): string {
  const unique = [...new Set(days)];
  const indexes = unique.map((d) => WEEK.indexOf(d));
  const consecutive =
    indexes.length >= 3 &&
    indexes.every((i) => i >= 0) &&
    indexes.every((i, n) => n === 0 || i === indexes[n - 1] + 1);
  if (consecutive) return `${unique[0]} to ${unique[unique.length - 1]}`;
  return unique.join(", ");
}

/** "09:00" to "9:00 AM", "20:00" to "8:00 PM". Anything else is returned as written. */
function formatClockTime(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return raw.trim();
  const hours = Number(m[1]);
  if (hours > 23) return raw.trim();
  const suffix = hours >= 12 ? "PM" : "AM";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${m[2]} ${suffix}`;
}

function expandDayRange(token: string): string[] {
  const parts = token.split("-").map((p) => dayName(p)).filter((d): d is string => d !== null);
  if (parts.length === 2) {
    const a = WEEK.indexOf(parts[0]);
    const b = WEEK.indexOf(parts[1]);
    if (a >= 0 && b >= a) return WEEK.slice(a, b + 1);
  }
  return parts;
}

/** Parses the openingHours string form, "Mo-Th 09:00-20:00". */
function hoursFromString(spec: string): ListItem | null {
  const m = spec.trim().match(/^([A-Za-z,\-\s]+?)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-\u2013]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i);
  if (!m) return null;
  const days = m[1].split(/[,\s]+/).filter(Boolean).flatMap(expandDayRange);
  if (!days.length) return null;
  return { days: joinDays(days), opens: formatClockTime(m[2]), closes: formatClockTime(m[3]) };
}

function hoursFromNode(node: JsonObject): ListItem | null {
  const days = stringsOf(node.dayOfWeek).map(dayName).filter((d): d is string => d !== null);
  if (!days.length) return null;
  const opens = firstString(node.opens);
  const closes = firstString(node.closes);
  if (!opens && !closes) return null;
  const item: ListItem = { days: joinDays(days) };
  if (opens) item.opens = formatClockTime(opens);
  if (closes) item.closes = formatClockTime(closes);
  return item;
}

function addressFromNode(node: JsonObject): AddressValue | null {
  const addr: AddressValue = {};
  const street = firstString(node.streetAddress);
  const locality = firstString(node.addressLocality);
  const region = firstString(node.addressRegion);
  const postal = firstString(node.postalCode);
  const country = firstString(node.addressCountry);
  if (street) addr.streetAddress = street;
  if (locality) addr.addressLocality = locality;
  if (region) addr.addressRegion = region;
  if (postal) addr.postalCode = postal;
  if (country) addr.addressCountry = country;
  const parts = [street, locality, region, postal, country].filter((p): p is string => !!p);
  const text = parts.join(", ") || firstString(node.name) || firstString(node.description);
  if (!text) return null;
  addr.text = text;
  return addr;
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", it: "Italian",
  zh: "Chinese", ja: "Japanese", ko: "Korean", ar: "Arabic", hi: "Hindi", pa: "Punjabi",
  ru: "Russian", uk: "Ukrainian", pl: "Polish", nl: "Dutch", tl: "Tagalog", vi: "Vietnamese",
  fa: "Persian", tr: "Turkish", ur: "Urdu", he: "Hebrew", el: "Greek", sv: "Swedish",
  da: "Danish", no: "Norwegian", fi: "Finnish", cs: "Czech", hu: "Hungarian", ro: "Romanian",
  th: "Thai", id: "Indonesian", ms: "Malay", bn: "Bengali", ta: "Tamil", te: "Telugu",
  gu: "Gujarati", sw: "Swahili",
};

function languageName(raw: string): string {
  const code = raw.trim().toLowerCase().split(/[-_]/)[0];
  return LANGUAGE_NAMES[code] ?? raw.trim();
}

const PERSON_SOCIAL_KEYS: Record<string, string> = {
  linkedin: "linkedin",
  youtube: "youtube",
  x: "x",
  facebook: "facebook",
  instagram: "instagram",
  website: "website",
};

function personName(p: JsonObject): string {
  const given = firstString(p.givenName);
  const family = firstString(p.familyName);
  return firstString(p.name) ?? [given, family].filter(Boolean).join(" ");
}

function personItem(p: JsonObject | string, roleKey: "title" | "role", withSocial: boolean): ListItem | null {
  if (typeof p === "string") return p.trim() ? { name: p.trim() } : null;
  const name = personName(p);
  if (!name) return null;
  const item: ListItem = { name };
  const role = firstString(p.jobTitle);
  if (role) item[roleKey] = role;
  const credentials = firstString(p.honorificSuffix);
  if (credentials) item.credentials = credentials;
  const url = firstString(p.url);
  if (url) item.url = url;
  if (withSocial) {
    const bio = firstString(p.description);
    if (bio) item.bio = stripHtml(bio);
    for (const link of stringsOf(p.sameAs)) {
      const platform = platformFromUrl(link);
      const key = platform ? PERSON_SOCIAL_KEYS[platform] : undefined;
      if (key && !item[key]) item[key] = link;
    }
  }
  return item;
}

function peopleOf(v: Json | undefined): (JsonObject | string)[] {
  if (v == null) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(peopleOf);
  return isObject(v) ? [v] : [];
}

function teamSizeOf(v: Json | undefined): string | null {
  if (typeof v === "number" || typeof v === "string") return String(v).trim() || null;
  for (const node of nodesOf(v)) {
    const value = firstString(node.value);
    if (value) return value;
    const min = firstString(node.minValue);
    const max = firstString(node.maxValue);
    if (min && max) return `${min} to ${max}`;
    if (min) return `${min}+`;
    if (max) return `up to ${max}`;
  }
  return null;
}

function mapOrganization(node: JsonObject, c: Collector): void {
  for (const name of stringsOf(node.name)) c.add("company_name", name, quoteOf(node.name));
  for (const legal of stringsOf(node.legalName)) c.add("legal_name", legal, quoteOf(node.legalName));
  for (const alt of stringsOf(node.alternateName)) c.add("alternate_names", [{ name: alt }], alt);
  for (const phone of stringsOf(node.telephone)) c.add("phone", phone, phone);
  for (const email of stringsOf(node.email)) c.add("email", email.replace(/^mailto:/i, ""), email);
  for (const contact of nodesOf(node.contactPoint)) {
    for (const phone of stringsOf(contact.telephone)) c.add("phone", phone, phone);
    for (const email of stringsOf(contact.email)) c.add("email", email.replace(/^mailto:/i, ""), email);
  }
  const url = firstString(node.url);
  if (url) c.add("website_url", url, quoteOf(node.url));
  const logoNodes = Array.isArray(node.logo) ? node.logo : [node.logo];
  for (const logo of logoNodes) {
    if (typeof logo === "string") c.add("logo_url", logo, logo);
    else if (isObject(logo)) {
      const src = firstString(logo.url) ?? firstString(logo.contentUrl);
      if (src) c.add("logo_url", src, JSON.stringify(logo));
    }
  }
  const founded = firstString(node.foundingDate);
  if (founded) c.add("founded_date", founded, quoteOf(node.foundingDate));
  const addressValues = Array.isArray(node.address) ? node.address : [node.address];
  for (const a of addressValues) {
    if (typeof a === "string" && a.trim()) c.add("headquarters", { text: a.trim() }, a);
    else if (isObject(a)) {
      const addr = addressFromNode(a);
      if (addr) c.add("headquarters", addr, JSON.stringify(a));
    }
  }
  for (const geo of nodesOf(node.geo)) {
    const point = nodesOf(geo.geoMidpoint)[0] ?? geo;
    const lat = firstString(point.latitude);
    const lng = firstString(point.longitude);
    if (lat && lng) c.add("geo", `${lat}, ${lng}`, JSON.stringify(geo));
  }
  const mapValues = Array.isArray(node.hasMap) ? node.hasMap : [node.hasMap];
  for (const m of mapValues) {
    if (typeof m === "string") c.add("map_url", m, m);
    else if (isObject(m)) {
      const src = firstString(m.url);
      if (src) c.add("map_url", src, JSON.stringify(m));
    }
  }
  // The organization's own node: its sameAs links are the business's profiles.
  for (const link of stringsOf(node.sameAs)) {
    const platform = platformFromUrl(link);
    if (!platform) continue;
    c.add("social_profiles", [{ platform, url: link, owner: "business" }], link);
  }
  const awardValues = Array.isArray(node.award) ? node.award : [node.award];
  for (const a of awardValues) {
    const name = firstString(a);
    if (name) c.add("awards", [{ name }], quoteOf(a));
  }
  const areaValues = Array.isArray(node.areaServed) ? node.areaServed : [node.areaServed];
  for (const a of areaValues) {
    if (typeof a === "string") {
      if (a.trim()) c.add("area_served", [{ name: a.trim() }], a);
    } else if (isObject(a)) {
      const name = firstString(a.name);
      if (name) c.add("area_served", [{ name }], JSON.stringify(a));
    }
  }
  for (const spec of nodesOf(node.openingHoursSpecification)) {
    const item = hoursFromNode(spec);
    if (item) c.add("hours", [item], JSON.stringify(spec));
  }
  for (const spec of stringsOf(node.openingHours)) {
    const item = hoursFromString(spec);
    if (item) c.add("hours", [item], spec);
  }
  const priceRange = firstString(node.priceRange);
  if (priceRange) c.add("price_range", priceRange, quoteOf(node.priceRange));
  for (const key of ["founder", "founders"]) {
    for (const p of peopleOf(node[key])) {
      const item = personItem(p, "title", true);
      if (item) c.add("founders", [item], quoteOf(p));
    }
  }
  for (const key of ["employee", "employees"]) {
    for (const p of peopleOf(node[key])) {
      const item = personItem(p, "role", false);
      if (item) c.add("team_members", [item], quoteOf(p));
    }
  }
  for (const lang of stringsOf(node.knowsLanguage)) {
    c.add("languages", [{ name: languageName(lang) }], lang);
  }
  const teamSize = teamSizeOf(node.numberOfEmployees);
  if (teamSize) c.add("team_size", teamSize, quoteOf(node.numberOfEmployees));
  const memberValues = Array.isArray(node.memberOf) ? node.memberOf : [node.memberOf];
  for (const m of memberValues) {
    const name = firstString(m);
    if (name) c.add("memberships", [{ name }], quoteOf(m));
  }
}

/** A Person node's sameAs links are that person's profiles, wherever the node sits (founder, employee, author). */
function mapPersonProfiles(node: JsonObject, c: Collector): void {
  const owner = personName(node);
  if (!owner) return;
  for (const link of stringsOf(node.sameAs)) {
    const platform = platformFromUrl(link);
    if (!platform) continue;
    c.add("social_profiles", [{ platform, url: link, owner }], link);
  }
}

function mapQuestion(node: JsonObject, c: Collector): void {
  const question = firstString(node.name) ?? firstString(node.text);
  if (!question) return;
  const answers = [...nodesOf(node.acceptedAnswer), ...nodesOf(node.suggestedAnswer)];
  for (const answer of answers) {
    const text = firstString(answer.text);
    if (!text) continue;
    c.add("existing_faqs", [{ question: stripHtml(question), answer: stripHtml(text), url: c.pageUrl }], JSON.stringify(node));
    return;
  }
}

function mapService(node: JsonObject, c: Collector): void {
  const name = firstString(node.name) ?? firstString(node.serviceType);
  if (!name) return;
  const item: ListItem = { name };
  const description = firstString(node.description);
  if (description) item.description = stripHtml(description);
  const url = firstString(node.url);
  if (url) item.url = url;
  c.add("services", [item], JSON.stringify(node));
}

/**
 * Findings from every parsed JSON-LD block on a page, including @graph arrays
 * and nested nodes. Organization and LocalBusiness nodes feed the basics,
 * Question nodes feed existing_faqs, Service nodes feed services.
 */
export function findingsFromJsonLd(blocks: JsonLdBlock[], url: string): Finding[] {
  const c = new Collector(url, "jsonld", 0.9);
  for (const block of blocks ?? []) {
    if (!block || block.data == null) continue;
    const visited: Visited[] = [];
    walk(block.data, null, visited, 0);
    for (const { node, parentKey } of visited) {
      const types = typesOf(node);
      if (!types.length) continue;
      const otherOrg = parentKey !== null && OTHER_ORG_KEYS.has(parentKey);
      if (!otherOrg && types.some(isOrgType)) {
        mapOrganization(node, c);
        mapBusinessType(types, node, c);
      }
      if (types.includes("Person")) mapPersonProfiles(node, c);
      if (types.includes("Question")) mapQuestion(node, c);
      if (!otherOrg && types.includes("Service")) mapService(node, c);
    }
  }
  return c.findings;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

const NON_PROFILE_SOCIAL = [
  /facebook\.com\/(?:sharer|share|dialog|plugins|login|hashtag|photo|watch|reel|events)\b/i,
  /facebook\.com\/[^/?#]+\/(?:posts|photos|videos)\b/i,
  /(?:twitter|x)\.com\/(?:intent|share|home|search|hashtag|i)\b/i,
  /(?:twitter|x)\.com\/[^/?#]+\/status\b/i,
  /linkedin\.com\/(?:share|sharing|shareArticle|pulse|posts|feed|jobs)\b/i,
  /pinterest\.[a-z.]+\/pin\b/i,
  /instagram\.com\/(?:p|reel|reels|explore|stories)\b/i,
  /youtube\.com\/(?:watch|embed|shorts|playlist|results)\b/i,
  /youtu\.be\//i,
  /tiktok\.com\/[^?#]*\/video\b/i,
  /threads\.(?:net|com)\/[^?#]*\/post\b/i,
];

const PLACEHOLDER_EMAIL_HOSTS = new Set(["example.com", "email.com", "domain.com", "yourdomain.com", "mysite.com", "sentry.io"]);

function isProfileLink(url: string): boolean {
  if (NON_PROFILE_SOCIAL.some((re) => re.test(url))) return false;
  try {
    const u = new URL(url);
    const platform = platformFromUrl(url);
    if (platform === "google") return true;
    return u.pathname.replace(/\/+$/, "").length > 0;
  } catch {
    return false;
  }
}

/** "/about" for a page, "the home page" for the root. */
function pageLabel(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    return path ? safeDecode(path) : "the home page";
  } catch {
    return url;
  }
}

/**
 * tel and mailto links, social profile links, and map links. A profile link on
 * a page can belong to the business, the founder, or a guest author, so it
 * carries no owner and is marked derived with a note; the merge sets the owner
 * from JSON-LD, or to the business when the link is on two or more pages.
 */
export function findingsFromLinks(links: PageLinks, url: string): Finding[] {
  const c = new Collector(url, "link", 0.8);
  for (const href of links?.tel ?? []) {
    const value = safeDecode(href.trim().replace(/^tel:/i, "")).trim();
    if (value.replace(/\D+/g, "").length < 7) continue;
    c.add("phone", value, href);
  }
  for (const href of links?.mailto ?? []) {
    const value = safeDecode(href.trim().replace(/^mailto:/i, "")).split("?")[0].trim();
    const host = value.split("@")[1]?.toLowerCase();
    if (!host || !value.includes("@") || PLACEHOLDER_EMAIL_HOSTS.has(host)) continue;
    c.add("email", value, href);
  }
  for (const social of links?.social ?? []) {
    const link = social?.url?.trim();
    if (!link || !isProfileLink(link)) continue;
    const given = (social.platform ?? "").trim().toLowerCase();
    const platform = (given === "twitter" ? "x" : given) || platformFromUrl(link);
    if (!platform) continue;
    c.add("social_profiles", [{ platform, url: link, owner: "" }], link, {
      derived: true,
      note: `linked from ${pageLabel(url)}; confirm whose profile this is`,
    });
  }
  for (const href of links?.maps ?? []) {
    const link = href.trim();
    if (!link || /\/maps\/embed|maps\.googleapis\.com/i.test(link)) continue;
    c.add("map_url", link, href);
  }
  return c.findings;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

function resolveSrc(src: string, base: string): string {
  try {
    return new URL(src, base).toString();
  } catch {
    return src;
  }
}

function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** "canadian-choice-2024.png" to "Canadian Choice 2024". */
export function nameFromFileName(src: string): string {
  let file = src.split(/[?#]/)[0].split("/").pop() ?? "";
  file = safeDecode(file);
  return titleCase(
    file
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .replace(/-\d{2,4}x\d{2,4}$/i, "")
      .replace(/@\dx$/i, "")
      .replace(/-e\d{10,}$/i, "")
      .replace(/[-_+]+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

const WEAK_ALT = /^(?:award|awards|badge|image|img|logo|icon|photo|picture|banner|untitled)?$/i;

/** The first logo image feeds logo_url; award images feed awards, marked derived. */
export function findingsFromImages(images: PageImage[], url: string): Finding[] {
  const c = new Collector(url, "image", 0.6);
  const logo = (images ?? []).find((i) => i?.kind === "logo" && i.src?.trim());
  if (logo) {
    const src = resolveSrc(logo.src.trim(), url);
    c.add("logo_url", src, src);
  }
  for (const image of images ?? []) {
    if (image?.kind !== "award" || !image.src?.trim()) continue;
    const src = resolveSrc(image.src.trim(), url);
    const alt = (image.alt ?? "").replace(/\s+/g, " ").trim();
    const fromAlt = !WEAK_ALT.test(alt);
    const name = fromAlt ? alt : nameFromFileName(src);
    if (!name || WEAK_ALT.test(name)) continue;
    const item: ListItem = { name };
    const year = name.match(/\b(19\d{2}|20\d{2})\b/);
    if (year) item.year = year[1];
    c.add("awards", [item], src, {
      confidence: 0.4,
      derived: true,
      note: fromAlt
        ? "from image alt text; confirm the award and year"
        : "from image file name; confirm the award and year",
    });
  }
  return c.findings;
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

/** On the home page only: the canonical URL is the website URL. Titles are not facts. */
export function findingsFromMeta(cleaned: CleanedMeta, url: string, isHome: boolean): Finding[] {
  if (!isHome) return [];
  const c = new Collector(url, "meta", 0.9);
  const canonical = (cleaned?.canonical ?? "").trim();
  if (canonical) {
    c.add("website_url", canonical, canonical);
    return c.findings;
  }
  try {
    const home = `${new URL(url).origin}/`;
    c.add("website_url", home, url, {
      confidence: 0.5,
      derived: true,
      note: "no canonical tag on the home page; this is the address that was crawled",
    });
  } catch {
    // not a URL; nothing to report
  }
  return c.findings;
}
