/*
  The install instructions, as markdown, for the owner's platform, with notes
  on the schema the site already has. Pure: no network, no database, so vitest
  runs it in node. The markdown stays inside what
  src/components/app/generate/markdown.ts parses: headings, paragraphs, bullet
  and numbered lists, fenced code, inline code, bold, and links.

  The schema notes compare every organization node in the site's JSON-LD with
  the fact sheet on name, phone, email, web address, address, and social
  profiles (sameAs). A node that repeats on many pages (theme or SEO plugin
  output) is reported once, with the pages it appears on.
*/
import type { Json, PlatformT } from "@/lib/db/types";
import { normalizeAddress, normalizeEmail, normalizePhone, normalizeText, normalizeUrl } from "@/lib/extract/normalize";
import type { AddressValue, FactSheetData, FactValue, ListItem } from "@/lib/facts/types";
import { formatAddress, isEmptyValue } from "@/lib/projects/view";
import { ABOUT_V1, TEMPLATES } from "@/templates/about-v1";
import type { InstructionsInput } from "./types";

export type ExistingSchemaBlock = InstructionsInput["existingSchema"][number];

export type CompareProperty = "name" | "telephone" | "email" | "url" | "address" | "sameAs";

export interface SchemaDisagreement {
  property: CompareProperty;
  /** What the site's block says, for people. */
  site: string;
  /** What the fact sheet says, for people. */
  fact: string;
  /** Extra context, such as the site's name being the fact sheet's legal name. */
  note?: string;
}

export interface SchemaGap {
  property: CompareProperty;
  site: string;
}

export interface SchemaBlockReport {
  /** An organization node, a block about something else (a page, a post), or one that did not parse. */
  kind: "organization" | "other" | "broken";
  /** The node's types for an organization, every type in the block otherwise. */
  types: string[];
  /** Paths of the pages the block was found on, first page first. */
  pages: string[];
  error?: string;
  disagreements: SchemaDisagreement[];
  agreements: CompareProperty[];
  gaps: SchemaGap[];
}

export const PLATFORM_NAMES: Record<PlatformT, string> = {
  wordpress: "WordPress",
  shopify: "Shopify",
  wix: "Wix",
  squarespace: "Squarespace",
  webflow: "Webflow",
  other: "a custom site",
  unknown: "your site",
};

export const RICH_RESULTS_TEST_URL = "https://search.google.com/test/rich-results";
export const SCHEMA_VALIDATOR_URL = "https://validator.schema.org/";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type JsonObject = { [key: string]: Json | undefined };

function oneLine(s: unknown): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
}

function isJsonObject(v: Json | undefined): v is JsonObject {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** "a, b, and c" */
function joinWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function originOf(pageUrl: string): string {
  const raw = oneLine(pageUrl);
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).origin;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function hostOfOrigin(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./i, "");
  } catch {
    return origin.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  }
}

/** "/" for the home page, else the decoded path without its trailing slash. */
export function pagePath(url: string | undefined): string {
  const raw = oneLine(url);
  if (!raw) return "";
  try {
    const u = new URL(raw);
    let path = u.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // keep the encoded path
    }
    path = path.replace(/\/+$/, "");
    return path || "/";
  } catch {
    return raw;
  }
}

function pageLabel(path: string): string {
  if (!path) return "a page";
  if (path === "/") return "the home page";
  return `\`${path}\``;
}

// ---------------------------------------------------------------------------
// The fact sheet's side
// ---------------------------------------------------------------------------

export interface FactContact {
  name: string;
  legalName: string;
  alternateNames: string[];
  telephone: string;
  email: string;
  url: string;
  address: AddressValue | null;
  /** The business's own profiles, as the new schema's sameAs lists them. */
  sameAs: string[];
  /** Profiles of named people, so a block that claims one of them can be called out. */
  personProfiles: { owner: string; url: string }[];
}

/**
 * The field's value when it has one: found, user-provided, or the merged value
 * of a conflict (never a candidate). A missing field, or an empty value, is null.
 */
function fieldValue(data: FactSheetData, id: string): FactValue {
  const field = data.fields?.[id];
  if (!field || field.status === "missing") return null;
  const value = field.value;
  if (value === null || value === undefined || isEmptyValue(value)) return null;
  return value;
}

function fieldText(data: FactSheetData, id: string): string {
  const value = fieldValue(data, id);
  return typeof value === "string" ? oneLine(value) : "";
}

function fieldList(data: FactSheetData, id: string): ListItem[] {
  const value = fieldValue(data, id);
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function fieldAddress(data: FactSheetData, id: string): AddressValue | null {
  const value = fieldValue(data, id);
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/** A social profile with no owner, "business", "the company", or the company's own name belongs to the business. */
function isBusinessOwner(owner: string | undefined, companyName: string): boolean {
  const o = oneLine(owner).toLowerCase();
  if (!o || o === "business" || o === "the business" || o === "company" || o === "the company") return true;
  const c = oneLine(companyName).toLowerCase();
  return c.length > 0 && o === c;
}

export function factContactOf(data: FactSheetData, companyName: string): FactContact {
  const name = fieldText(data, "company_name") || oneLine(companyName);
  const profiles = fieldList(data, "social_profiles");
  const sameAs: string[] = [];
  const personProfiles: { owner: string; url: string }[] = [];
  for (const p of profiles) {
    const url = oneLine(p.url);
    if (!url) continue;
    if (isBusinessOwner(p.owner, name)) sameAs.push(url);
    else personProfiles.push({ owner: oneLine(p.owner), url });
  }
  return {
    name,
    legalName: fieldText(data, "legal_name"),
    alternateNames: fieldList(data, "alternate_names")
      .map((item) => oneLine(item.name))
      .filter(Boolean),
    telephone: fieldText(data, "phone"),
    email: fieldText(data, "email").replace(/^mailto:/i, ""),
    url: fieldText(data, "website_url"),
    address: fieldAddress(data, "headquarters"),
    sameAs: uniq(sameAs),
    personProfiles,
  };
}

// ---------------------------------------------------------------------------
// The site's side: the organization nodes in its JSON-LD
// ---------------------------------------------------------------------------

/** Keys under which a nested node still describes the business itself, not another organization. */
const SELF_KEYS = new Set([
  "@graph",
  "publisher",
  "provider",
  "mainEntity",
  "about",
  "author",
  "creator",
  "seller",
  "offeredBy",
  "organizer",
  "brand",
  "manufacturer",
  "copyrightHolder",
  "sourceOrganization",
  "worksFor",
  "itemReviewed",
]);

/** Types that describe a page, a post, a person, a product, or a part of a node, never the business. */
const NON_ORG_TYPES = new Set([
  "WebPage",
  "AboutPage",
  "ContactPage",
  "FAQPage",
  "CollectionPage",
  "ItemPage",
  "ProfilePage",
  "SearchResultsPage",
  "CheckoutPage",
  "MedicalWebPage",
  "QAPage",
  "RealEstateListing",
  "WebSite",
  "SiteNavigationElement",
  "WPHeader",
  "WPFooter",
  "WPSideBar",
  "Article",
  "NewsArticle",
  "BlogPosting",
  "TechArticle",
  "ScholarlyArticle",
  "Blog",
  "CreativeWork",
  "Thing",
  "Person",
  "Product",
  "ProductGroup",
  "Offer",
  "AggregateOffer",
  "PriceSpecification",
  "UnitPriceSpecification",
  "BreadcrumbList",
  "ListItem",
  "ItemList",
  "ImageObject",
  "VideoObject",
  "AudioObject",
  "MediaObject",
  "Event",
  "Review",
  "AggregateRating",
  "Rating",
  "Question",
  "Answer",
  "SearchAction",
  "ReadAction",
  "EntryPoint",
  "PostalAddress",
  "ContactPoint",
  "GeoCoordinates",
  "OpeningHoursSpecification",
  "Place",
  "Service",
  "Brand",
  "HowTo",
  "HowToStep",
  "Recipe",
  "Course",
  "JobPosting",
  "SoftwareApplication",
  "MobileApplication",
  "WebApplication",
  "Book",
  "Movie",
  "Audience",
  "DefinedTerm",
  "SpeakableSpecification",
  "QuantitativeValue",
  "PropertyValue",
  "Language",
  "Country",
  "City",
  "State",
  "AdministrativeArea",
  "VirtualLocation",
  "OfferCatalog",
  "Menu",
  "MenuItem",
  "Dataset",
  "Comment",
  "DiscussionForumPosting",
  "SocialMediaPosting",
  "Occupation",
]);

/** Common schema.org organization and local business types without a telling suffix. */
const KNOWN_ORG_TYPES = new Set([
  "Corporation",
  "NGO",
  "GovernmentOrganization",
  "NewsMediaOrganization",
  "MedicalOrganization",
  "SportsOrganization",
  "SportsTeam",
  "Consortium",
  "Airline",
  "Dentist",
  "Physician",
  "Attorney",
  "Notary",
  "Electrician",
  "Plumber",
  "Locksmith",
  "HousePainter",
  "GeneralContractor",
  "Florist",
  "Bakery",
  "Pharmacy",
  "Hospital",
  "Optician",
  "VeterinaryCare",
  "AnimalShelter",
  "AutoDealer",
  "AutoRepair",
  "AutoBodyShop",
  "AutoWash",
  "GasStation",
  "MotorcycleDealer",
  "CafeOrCoffeeShop",
  "BarOrPub",
  "Brewery",
  "Winery",
  "Distillery",
  "FastFoodRestaurant",
  "IceCreamShop",
  "Hotel",
  "Motel",
  "Resort",
  "BedAndBreakfast",
  "Hostel",
  "Campground",
  "TravelAgency",
  "RealEstateAgent",
  "InsuranceAgency",
  "BankOrCreditUnion",
  "EmploymentAgency",
  "ChildCare",
  "DryCleaningOrLaundry",
  "SelfStorage",
  "ShoppingCenter",
  "SportsActivityLocation",
  "StadiumOrArena",
  "BowlingAlley",
  "GolfCourse",
  "SkiResort",
  "TennisComplex",
  "PublicSwimmingPool",
  "Casino",
  "NightClub",
  "MovieTheater",
  "AmusementPark",
  "ArtGallery",
  "Museum",
  "Zoo",
  "Aquarium",
  "Library",
  "RadioStation",
  "TelevisionStation",
  "TouristInformationCenter",
  "InternetCafe",
  "HairSalon",
  "BeautySalon",
  "DaySpa",
  "NailSalon",
  "TattooParlor",
  "HealthClub",
  "ExerciseGym",
  "MedicalClinic",
  "Physiotherapy",
  "MovingCompany",
  "Preschool",
  "School",
  "ElementarySchool",
  "MiddleSchool",
  "HighSchool",
  "CollegeOrUniversity",
  "WorkersUnion",
  "PerformingGroup",
  "MusicGroup",
  "TheaterGroup",
  "DanceGroup",
  "OnlineBusiness",
  "OnlineStore",
  "ResearchOrganization",
  "ArchiveOrganization",
  "FundingAgency",
  "LibrarySystem",
  "PoliticalParty",
  "Cooperative",
]);

/** A type that ends in one of these words names a business or organization ("RoofingContractor", "HVACBusiness"). */
const ORG_SUFFIX =
  /\w(?:Organization|Business|Store|Shop|Corporation|Company|Agency|Contractor|Practice|Clinic|Studio|Salon|Center|Centre|Church|Restaurant|Dealer|Repair|Care|Spa|Gym|Bank|Firm|Office|Station|Shelter)$/;

function typesOf(node: JsonObject): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t.trim()].filter(Boolean);
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
  return [];
}

function stringsOf(v: Json | undefined): string[] {
  if (typeof v === "string") {
    const s = oneLine(v);
    return s ? [s] : [];
  }
  if (Array.isArray(v)) return v.flatMap((x) => stringsOf(x));
  return [];
}

function arrayOf(v: Json | undefined): Json[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Every typed node in the block: the top level, @graph entries, and nodes nested under keys that still mean the business. */
export function nodesOf(data: Json | null): JsonObject[] {
  const out: JsonObject[] = [];
  const walk = (v: Json | undefined, depth: number) => {
    if (depth > 8 || v === undefined || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }
    if (typesOf(v).length) out.push(v);
    for (const [key, value] of Object.entries(v)) {
      if (SELF_KEYS.has(key)) walk(value, depth + 1);
    }
  };
  walk(data, 0);
  return out;
}

function orgTypesOf(data: FactSheetData): Set<string> {
  const spec = TEMPLATES[data.templateId] ?? ABOUT_V1;
  return new Set(spec.schema.orgTypes);
}

function isOrgType(t: string, orgTypes: Set<string>): boolean {
  if (t === "Organization" || t === "LocalBusiness") return true;
  if (orgTypes.has(t) || KNOWN_ORG_TYPES.has(t)) return true;
  return ORG_SUFFIX.test(t);
}

/**
 * A node describes the business when one of its types is an organization or
 * local business type, or when it is not a page, post, person, or product and
 * still carries a name with contact details.
 */
export function isOrgNode(node: JsonObject, orgTypes: Set<string>): boolean {
  const types = typesOf(node);
  if (!types.length) return false;
  if (types.some((t) => isOrgType(t, orgTypes))) return true;
  if (types.some((t) => NON_ORG_TYPES.has(t))) return false;
  const hasName = stringsOf(node.name).length > 0;
  return hasName && ["telephone", "address", "email", "sameAs", "legalName"].some((k) => node[k] !== undefined && node[k] !== null);
}

const ADDRESS_PART_KEYS = ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"] as const;

function addressesOf(v: Json | undefined): (AddressValue | string)[] {
  if (typeof v === "string") {
    const s = oneLine(v);
    return s ? [s] : [];
  }
  if (Array.isArray(v)) return v.flatMap((x) => addressesOf(x));
  if (!isJsonObject(v)) return [];
  const out: AddressValue = {};
  for (const key of ADDRESS_PART_KEYS) {
    const raw = v[key];
    const text = typeof raw === "string" ? oneLine(raw) : isJsonObject(raw) ? oneLine(raw.name) : "";
    if (text) out[key] = text;
  }
  if (Object.keys(out).length) return [out];
  const name = stringsOf(v.name)[0] ?? stringsOf(v.description)[0];
  return name ? [name] : [];
}

interface SiteContact {
  types: string[];
  name: string[];
  telephone: string[];
  email: string[];
  url: string[];
  address: (AddressValue | string)[];
  sameAs: string[];
}

function siteContactOf(node: JsonObject, orgTypes: Set<string>): SiteContact {
  const contactPoints = arrayOf(node.contactPoint).filter(isJsonObject);
  const types = typesOf(node);
  const orgFirst = [...types.filter((t) => isOrgType(t, orgTypes)), ...types.filter((t) => !isOrgType(t, orgTypes))];
  return {
    types: orgFirst,
    name: uniq(stringsOf(node.name)),
    telephone: uniq([...stringsOf(node.telephone), ...contactPoints.flatMap((cp) => stringsOf(cp.telephone))]),
    email: uniq(
      [...stringsOf(node.email), ...contactPoints.flatMap((cp) => stringsOf(cp.email))].map((e) =>
        e.replace(/^mailto:/i, ""),
      ),
    ),
    url: uniq(stringsOf(node.url)),
    address: addressesOf(node.address),
    sameAs: uniq(stringsOf(node.sameAs)),
  };
}

// ---------------------------------------------------------------------------
// Comparing the two sides
// ---------------------------------------------------------------------------

function sameName(a: string, b: string): boolean {
  const x = normalizeText(a);
  return x.length > 0 && x === normalizeText(b);
}

function samePhone(a: string, b: string): boolean {
  const x = normalizePhone(a);
  return x.length > 0 && x === normalizePhone(b);
}

function sameEmail(a: string, b: string): boolean {
  const x = normalizeEmail(a);
  return x.length > 0 && x === normalizeEmail(b);
}

function sameUrl(a: string, b: string): boolean {
  const x = normalizeUrl(a);
  return x.length > 0 && x === normalizeUrl(b);
}

const TRAILING_COUNTRY = /[\s,]+(?:usa|u\.s\.a\.|u\.s\.|us|united states(?: of america)?|canada|uk|u\.k\.|united kingdom|australia|new zealand|ireland)\.?$/i;

function addressPartsLine(a: AddressValue): string {
  return [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].map(oneLine).filter(Boolean).join(" ");
}

function addressLineOf(a: AddressValue | string): string {
  if (typeof a === "string") return a.replace(TRAILING_COUNTRY, "");
  const parts = addressPartsLine(a);
  return parts || oneLine(a.text).replace(TRAILING_COUNTRY, "");
}

/** Parts against parts when both sides have them (street abbreviations and region codes are normalized), text otherwise. */
export function sameAddress(site: AddressValue | string, fact: AddressValue): boolean {
  if (typeof site !== "string" && addressPartsLine(site) && addressPartsLine(fact)) {
    return normalizeAddress(site) === normalizeAddress(fact);
  }
  const a = normalizeAddress(addressLineOf(site));
  return a.length > 0 && a === normalizeAddress(addressLineOf(fact));
}

function formatSiteAddress(a: AddressValue | string): string {
  return typeof a === "string" ? a : formatAddress(a);
}

function nameNote(siteName: string, fact: FactContact): string | undefined {
  if (fact.legalName && sameName(siteName, fact.legalName)) {
    return "the fact sheet lists that as the legal name, and the new schema puts it in legalName";
  }
  if (fact.alternateNames.some((n) => sameName(siteName, n))) {
    return "the fact sheet lists that as an alternate name";
  }
  return undefined;
}

interface Comparison {
  disagreements: SchemaDisagreement[];
  agreements: CompareProperty[];
  gaps: SchemaGap[];
}

function compareContact(site: SiteContact, fact: FactContact): Comparison {
  const out: Comparison = { disagreements: [], agreements: [], gaps: [] };

  const scalar = (
    property: CompareProperty,
    siteValues: string[],
    factValue: string,
    same: (a: string, b: string) => boolean,
    note?: (siteValue: string) => string | undefined,
  ) => {
    if (!siteValues.length) return;
    if (!factValue) {
      out.gaps.push({ property, site: siteValues.join(", ") });
      return;
    }
    if (siteValues.some((v) => same(v, factValue))) {
      out.agreements.push(property);
      return;
    }
    const n = note?.(siteValues[0]);
    out.disagreements.push({ property, site: siteValues.join(", "), fact: factValue, ...(n ? { note: n } : {}) });
  };

  scalar("name", site.name, fact.name, sameName, (v) => nameNote(v, fact));
  scalar("telephone", site.telephone, fact.telephone, samePhone);
  scalar("email", site.email, fact.email, sameEmail);
  scalar("url", site.url, fact.url, sameUrl);

  if (site.address.length) {
    const siteText = site.address.map(formatSiteAddress).join("; ");
    const factAddress = fact.address;
    if (!factAddress) out.gaps.push({ property: "address", site: siteText });
    else if (site.address.some((a) => sameAddress(a, factAddress))) out.agreements.push("address");
    else out.disagreements.push({ property: "address", site: siteText, fact: formatAddress(factAddress) });
  }

  if (site.sameAs.length) {
    const factKeys = new Set(fact.sameAs.map(normalizeUrl));
    const extra = site.sameAs.filter((u) => !factKeys.has(normalizeUrl(u)));
    const personHits = extra.flatMap((u) => {
      const owner = fact.personProfiles.find((p) => sameUrl(p.url, u))?.owner;
      return owner ? [{ url: u, owner }] : [];
    });
    if (!extra.length) out.agreements.push("sameAs");
    else if (!fact.sameAs.length && !personHits.length) out.gaps.push({ property: "sameAs", site: extra.join(", ") });
    else {
      const note = personHits.length
        ? personHits.map((h) => `${h.url} is the profile of ${h.owner} in the fact sheet`).join("; ")
        : undefined;
      out.disagreements.push({
        property: "sameAs",
        site: extra.join(", "),
        fact: fact.sameAs.length ? fact.sameAs.join(", ") : "no profiles for the business",
        ...(note ? { note } : {}),
      });
    }
  }

  return out;
}

function blockKey(block: ExistingSchemaBlock): string {
  if (block.data !== null && block.data !== undefined) {
    try {
      return `data:${JSON.stringify(block.data)}`;
    } catch {
      // fall through to the raw text
    }
  }
  return `raw:${oneLine(block.raw)}`;
}

function addPage(pages: string[], path: string): void {
  if (!pages.includes(path)) pages.push(path);
}

/**
 * One report per organization node found on the site (identical nodes on many
 * pages count once), one per block that did not parse, and one per block that
 * describes something else.
 */
export function compareExistingSchema(
  existingSchema: ExistingSchemaBlock[],
  data: FactSheetData,
  companyName: string,
): SchemaBlockReport[] {
  const fact = factContactOf(data, companyName);
  const orgTypes = orgTypesOf(data);
  const reports = new Map<string, SchemaBlockReport>();

  for (const block of existingSchema ?? []) {
    if (!block || typeof block !== "object") continue;
    const path = pagePath(block.url);

    if (block.data === null || block.data === undefined) {
      const key = `broken:${blockKey(block)}`;
      const existing = reports.get(key);
      if (existing) {
        addPage(existing.pages, path);
        continue;
      }
      reports.set(key, {
        kind: "broken",
        types: [],
        pages: [path],
        error: oneLine(block.error) || "it is not valid JSON",
        disagreements: [],
        agreements: [],
        gaps: [],
      });
      continue;
    }

    const nodes = nodesOf(block.data).filter((n) => isOrgNode(n, orgTypes));
    if (!nodes.length) {
      const key = `other:${blockKey(block)}`;
      const existing = reports.get(key);
      if (existing) {
        addPage(existing.pages, path);
        continue;
      }
      const types = Array.isArray(block.types) && block.types.length ? block.types : uniq(nodesOf(block.data).flatMap(typesOf));
      reports.set(key, { kind: "other", types, pages: [path], disagreements: [], agreements: [], gaps: [] });
      continue;
    }

    for (const node of nodes) {
      const site = siteContactOf(node, orgTypes);
      const key = `org:${JSON.stringify(site)}`;
      const existing = reports.get(key);
      if (existing) {
        addPage(existing.pages, path);
        continue;
      }
      const comparison = compareContact(site, fact);
      reports.set(key, { kind: "organization", types: site.types, pages: [path], ...comparison });
    }
  }

  return [...reports.values()];
}

// ---------------------------------------------------------------------------
// The notes, as markdown lines
// ---------------------------------------------------------------------------

const PROPERTY_LABELS: Record<CompareProperty, string> = {
  name: "name",
  telephone: "phone number",
  email: "email address",
  url: "web address",
  address: "address",
  sameAs: "social profiles",
};

function whereOf(report: SchemaBlockReport): string {
  const type = report.types[0] ?? "JSON-LD";
  const first = pageLabel(report.pages[0] ?? "");
  const more = report.pages.length - 1;
  const pages = more > 0 ? `${first} and ${more} other ${plural(more, "page", "pages")}` : first;
  return `The ${type} block on ${pages}`;
}

function disagreementLine(where: string, d: SchemaDisagreement): string {
  const note = d.note ? ` (${d.note})` : "";
  if (d.property === "sameAs") {
    return (
      `- ${where} lists ${d.site} under sameAs, which the fact sheet does not list as the business's own ` +
      `${plural(d.site.split(", ").length, "profile", "profiles")}${note}; the fact sheet lists ${d.fact}. ` +
      "Remove those links from the block, or add them on the review screen if they do belong to the business, so the two do not contradict each other."
    );
  }
  const label = PROPERTY_LABELS[d.property];
  return (
    `- ${where} gives the ${label} as "${d.site}"; the fact sheet says "${d.fact}"${note}. ` +
    `Change the block to "${d.fact}" or remove the block, so the site and the new page do not contradict each other.`
  );
}

function gapLine(where: string, g: SchemaGap): string {
  if (g.property === "sameAs") {
    return (
      `- ${where} lists ${g.site} under sameAs, and the fact sheet has no profiles for the business. ` +
      "If they are the business's own profiles, add them on the review screen so the new schema lists them too."
    );
  }
  const label = PROPERTY_LABELS[g.property];
  return (
    `- ${where} gives ${label === "address" || label === "email address" ? "an" : "a"} ${label} (${g.site}) that the fact sheet does not have. ` +
    "If it is right, add it on the review screen so the page and its schema carry it too."
  );
}

function agreementLine(where: string, report: SchemaBlockReport): string {
  if (!report.agreements.length) return `- ${where} states nothing the fact sheet contradicts and can stay.`;
  const labels = uniq(report.agreements.map((p) => PROPERTY_LABELS[p]));
  return `- ${where} agrees with the fact sheet on the ${joinWords(labels)} and can stay.`;
}

function otherBlocksLine(reports: SchemaBlockReport[]): string {
  const types = uniq(reports.map((r) => r.types[0] ?? "untyped"));
  const shown = types.slice(0, 6);
  const rest = types.length - shown.length;
  const list = rest > 0 ? `${shown.join(", ")}, and ${rest} more` : joinWords(shown);
  const n = reports.length;
  return `- The ${list} ${plural(n, "block", "blocks")} on the site ${plural(n, "describes", "describe")} pages, posts, or people rather than the business, and can stay.`;
}

function brokenLine(report: SchemaBlockReport): string {
  const first = pageLabel(report.pages[0] ?? "");
  const more = report.pages.length - 1;
  const pages = more > 0 ? `${first} and ${more} other ${plural(more, "page", "pages")}` : first;
  return `- A JSON-LD block on ${pages} did not parse (${report.error}). Fix it or remove it; search engines and AI crawlers skip a broken block.`;
}

/** The markdown lines of the existing-schema section, without its heading. */
export function schemaNoteLines(existingSchema: ExistingSchemaBlock[], data: FactSheetData, companyName: string): string[] {
  const reports = compareExistingSchema(existingSchema, data, companyName);
  if (!reports.length) {
    return [
      "The scan found no JSON-LD on the site, so the new page's schema is the only structured data to install. There is nothing to reconcile.",
    ];
  }

  const lines: string[] = [
    "The scan read the JSON-LD already on the site and compared every block that describes the business with the fact sheet on the name, phone number, email address, web address, address, and social profiles. A block that agrees can stay. A block that disagrees has to change or go, or search engines and AI systems see two versions of the business.",
    "",
  ];

  for (const report of reports.filter((r) => r.kind === "organization")) {
    const where = whereOf(report);
    if (report.disagreements.length) {
      for (const d of report.disagreements) lines.push(disagreementLine(where, d));
    } else {
      lines.push(agreementLine(where, report));
    }
    for (const g of report.gaps) lines.push(gapLine(where, g));
  }

  for (const report of reports.filter((r) => r.kind === "broken")) lines.push(brokenLine(report));

  const others = reports.filter((r) => r.kind === "other");
  if (others.length) lines.push(otherBlocksLine(others));

  return lines;
}

// ---------------------------------------------------------------------------
// Platform steps
// ---------------------------------------------------------------------------

interface StepContext {
  company: string;
  pageUrl: string;
  origin: string;
  host: string;
}

const SCRIPT_SNIPPET = [
  "```html",
  '<script type="application/ld+json">',
  "  ... the contents of schema.json ...",
  "</script>",
  "```",
];

function wordpressSteps(c: StepContext): string[] {
  return [
    "1. Sign in to the WordPress admin, open Pages, and click Add New Page. If the site already has an About page, open that one instead and replace its content.",
    `2. Set the title to "About ${c.company}" and the URL slug to \`about\` (in the page settings panel under Link), so the page lives at ${c.pageUrl}.`,
    "3. Add a Custom HTML block: click the plus, search for \"Custom HTML\", and paste the whole of `about-wordpress.html` into it.",
    "4. Preview the page. The JSON-LD script at the top of the file stays in a Custom HTML block when the signed-in user is an administrator, because WordPress lets administrators save script tags. If the preview shows the script as text, or the block drops it on save, the site strips scripts: delete the script lines from the block and use step 6 for the schema.",
    `5. Publish, then open ${c.pageUrl} in a private window to check it.`,
    "6. If the schema has to go in on its own, paste the contents of `schema.json` into the page's custom schema in the SEO plugin (Rank Math: the Schema tab on the page, Custom Schema; Yoast SEO Premium: the Schema tab), or into a header snippet limited to this page with a plugin such as WPCode. In a snippet, wrap it in the script tag shown above.",
    "7. A page template with no sidebar (often called Blank, Full Width, or Canvas) keeps the site's header and footer around the article; pick it under Template in the page settings. Page builders (Elementor, Divi, Beaver Builder) take the same paste in their HTML widget or module.",
  ];
}

function shopifySteps(c: StepContext): string[] {
  return [
    "1. In the Shopify admin open Online Store, then Pages, then Add page.",
    `2. Set the title to "About ${c.company}". In the content editor click the Show HTML button (the \`<>\` icon) and paste the whole of \`about-wordpress.html\`.`,
    "3. Shopify's page editor removes script tags when it saves, so the JSON-LD at the top of the paste does not survive. Delete those script lines from the paste and add the schema with step 5.",
    `4. Under Search engine listing, set the URL handle to \`about\`. Shopify serves pages under /pages/, so the page's address is ${c.origin}/pages/about. Either add a redirect from /about to /pages/about (Online Store, Navigation, URL redirects), or change the two page addresses in \`schema.json\` (the \`url\` and \`@id\` of the AboutPage entry) and the canonical link in \`about.html\` to the /pages/about address.`,
    "5. For the schema, open the theme editor (Online Store, Themes, Customize), go to the About page, and add a Custom Liquid section or block. Paste the script tag shown above with the contents of `schema.json` inside it. Themes built on Online Store 2.0 have Custom Liquid; on an older theme, add the same script to `theme.liquid` inside `{% if page.handle == 'about' %}` and `{% endif %}`.",
    `6. Save, then open the page in a private window to check it.`,
  ];
}

function wixSteps(c: StepContext): string[] {
  return [
    `1. In the Wix editor open Pages and Menu, add a blank page, and name it About. In the page's SEO settings set the URL slug to \`about\`, so the page lives at ${c.pageUrl}.`,
    "2. For a quick preview of the HTML as it is: Add Elements, Embed Code, then Embed HTML. Paste the whole of `about-wordpress.html` into the code box and stretch the element to fit. Wix shows embedded HTML inside an iframe, so search engines and AI crawlers read it as a separate document, not as the page's own text. Use it to see the page, not as the final page.",
    "3. For the final page, either rebuild the sections with Wix's own text elements (copy each heading and paragraph from `about.html`, in order), or turn on Dev Mode and have the page's Velo code set a text element's html from the article in `about-wordpress.html`. Both keep the text inside the page itself.",
    "4. The schema goes in the page's SEO settings, not in the embed: Page settings, SEO, Advanced SEO, Structured data markup, Add new markup. Paste the contents of `schema.json`. Wix adds the script tag itself, so do not include it.",
    "5. Publish, then open the page in a private window to check it.",
  ];
}

function squarespaceSteps(c: StepContext): string[] {
  return [
    `1. In the Pages panel add a blank page and name it About. In Page settings, General, set the URL slug to \`about\`, so the page lives at ${c.pageUrl}.`,
    "2. Edit the page and add a Code block (Add block, Code). Set the block's type to HTML, turn off Display source, and paste the whole of `about-wordpress.html`.",
    "3. A Code block keeps script tags, so the JSON-LD at the top of the paste works as it is. If the editor says the plan does not allow scripts in Code blocks when it saves, delete the script lines from the block and use step 4.",
    "4. The schema can also go in the page header: Page settings, Advanced, Page Header Code Injection. Paste the script tag shown above with the contents of `schema.json` inside it. Code Injection needs a Business plan or higher.",
    "5. Save, then open the page in a private window to check it.",
  ];
}

function webflowSteps(c: StepContext): string[] {
  return [
    `1. In the Designer open the Pages panel, add a new static page, name it About, and set its slug to \`about\`, so the page lives at ${c.pageUrl}.`,
    "2. Drag an Embed element onto the page (Add panel, Advanced, Embed) and paste the whole of `about-wordpress.html` into it. If the Embed element refuses the paste because it is too long, split the article at a section heading into two or three Embed elements, one after another.",
    "3. The Embed element keeps script tags, so the JSON-LD at the top of the paste works as it is. To keep the schema out of the body instead, delete those script lines from the embed and use step 4.",
    "4. The schema can also go in the page head: Page settings (the gear on the page), Custom code, Inside <head> tag. Paste the script tag shown above with the contents of `schema.json` inside it. Webflow publishes custom code on paid site plans.",
    "5. Publish, then open the page in a private window to check it.",
  ];
}

function customSteps(c: StepContext): string[] {
  return [
    `1. Make a page at ${c.pageUrl}. On a static site, save \`about.html\` as the page itself (as \`about/index.html\`, or as \`about.html\` with a rewrite to /about). The file is complete: it has the head, the schema, a small preview style, and the article.`,
    "2. On a site with its own templates, keep the site's header and footer and put the article where the page content goes: paste `about-wordpress.html` into the page's content area as HTML. The site's own styles apply; the preview style block in `about.html` is not needed.",
    "3. The JSON-LD script is at the top of `about-wordpress.html` and may sit anywhere on the page, head or body. If the editor strips script tags, add the script tag shown above to the page's head with the contents of `schema.json`, through the template or the CMS's custom head code for this page.",
    `4. Deploy, then open ${c.pageUrl} in a private window to check it.`,
  ];
}

function unknownSteps(c: StepContext): string[] {
  return [
    `The scan could not tell which platform runs ${c.host}. The steps below work for any site; if it runs on one of the five platforms listed after them, use that platform's own place for the HTML and for the schema.`,
    "",
    ...customSteps(c),
    "",
    "- WordPress: a Custom HTML block on the page takes `about-wordpress.html`; if the block strips scripts, the schema goes in the SEO plugin's custom schema for the page.",
    "- Shopify: Pages, with Show HTML, takes the article; the schema goes in a Custom Liquid section in the theme editor, because the page editor strips script tags.",
    "- Wix: Embed HTML takes the article for a preview and Velo for the real page; the schema goes in the page's SEO settings under Structured data markup.",
    "- Squarespace: a Code block takes the article; the schema goes in Page Header Code Injection.",
    "- Webflow: an Embed element takes the article; the schema goes in the page settings under Custom code, Inside <head> tag.",
  ];
}

function platformSteps(platform: PlatformT, c: StepContext): string[] {
  switch (platform) {
    case "wordpress":
      return wordpressSteps(c);
    case "shopify":
      return shopifySteps(c);
    case "wix":
      return wixSteps(c);
    case "squarespace":
      return squarespaceSteps(c);
    case "webflow":
      return webflowSteps(c);
    case "other":
      return customSteps(c);
    default:
      return unknownSteps(c);
  }
}

function stepsHeading(platform: PlatformT): string {
  switch (platform) {
    case "other":
      return "Steps for a custom site";
    case "unknown":
      return "Steps for your site";
    default:
      return `Steps for ${PLATFORM_NAMES[platform]}`;
  }
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export function buildInstructions(input: InstructionsInput): string {
  const company = oneLine(input.companyName) || "the business";
  const pageUrl = oneLine(input.pageUrl) || "/about";
  const origin = originOf(pageUrl);
  const host = hostOfOrigin(origin) || "the site";
  const platform: PlatformT = input.platform in PLATFORM_NAMES ? input.platform : "unknown";
  const c: StepContext = { company, pageUrl, origin, host };
  const platformPhrase = platform === "unknown" ? "the site" : `a ${PLATFORM_NAMES[platform].replace(/^a /, "")} site`;

  const lines: string[] = [
    `# Install the About page for ${company}`,
    "",
    `The download has the page, its schema, and the facts behind both. This file says where each file goes on ${platformPhrase}, what to do about the schema the site already has, how to check the result, and how to keep the page true.`,
    "",
    "## What is in the download",
    "",
    "- `about.html`: the complete page, with its head, schema, and a small preview style. Open it in a browser to see the page, or use it where the site takes a whole HTML page.",
    "- `about-wordpress.html`: the article alone, with the JSON-LD script at the top. This is the file to paste into an editor block that takes HTML.",
    "- `schema.json`: the JSON-LD on its own, for a platform with a separate place for structured data, or for an editor that strips script tags.",
    "- `instructions.md`: this file.",
    "- `fact-sheet.json`: the facts the page was written from, each with the quote and the page it came from.",
    "",
    `The page goes at ${pageUrl}. The schema goes on the same page, inside a script tag:`,
    "",
    ...SCRIPT_SNIPPET,
    "",
    "The script may sit in the head or in the body. `about-wordpress.html` already has it at the top, so pasting that file does both jobs when the editor keeps script tags.",
    "",
    `## ${stepsHeading(platform)}`,
    "",
    ...platformSteps(platform, c),
    "",
    "## The schema already on the site",
    "",
    ...schemaNoteLines(input.existingSchema ?? [], input.data, company),
    "",
    "## How to check",
    "",
    `1. Open ${pageUrl} in a private window. The article should be there with its headings, the Key facts table, and the questions. View the page source and search for \`application/ld+json\` to confirm the schema is on the page.`,
    `2. Paste ${pageUrl} into the [Rich Results Test](${RICH_RESULTS_TEST_URL}). It should read the page without errors and list the structured data it found. Warnings about optional fields can be ignored; errors mean a tag was cut or changed in the paste.`,
    `3. Paste ${pageUrl} into the [Schema Markup Validator](${SCHEMA_VALIDATOR_URL}). It lists every entity on the page: expect one organization entry for ${company} and one page entry with the questions and answers. Two organization entries with different facts mean the site's old block is still there; go back to the notes above.`,
    "4. Read the page once as a visitor. The name, phone number, address, and prices on it must match the rest of the site.",
    "",
    "## Keep the page true",
    "",
    `The page and its schema state facts: the name, prices, team, address, and hours. When one of them changes on the site, change it here too: edit the fact sheet on the review screen, generate the page again, and replace the page and the schema. An About page that disagrees with the rest of the site costs trust with people and with the AI systems that read it. \`fact-sheet.json\` in the download is the record of what the page claims, with the quote behind each fact.`,
  ];

  return `${lines.join("\n")}\n`;
}
