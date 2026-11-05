import type { TemplateSpec } from "./types";

/*
  about-v1: the eight-point About page.

  Every field carries what the crawler looks for, the question to ask when it is
  missing (written the way the question lists in /examples are written), and
  where it renders. Keep ids stable: fact sheets are keyed by them.
*/

export const ABOUT_V1: TemplateSpec = {
  id: "about-v1",
  // 2: social_profiles conflicts on owner. Raising it re-seeds the templates table.
  version: 2,
  name: "About page (eight sections)",
  description:
    "Value proposition, what the company does, what makes it different, who uses it, the team, how it works, key facts table, and FAQ, with Organization or LocalBusiness schema plus AboutPage and FAQPage.",

  sections: [
    {
      id: "basics",
      title: "The basics",
      description:
        "Name, type, location, contact details, and the one-sentence value proposition. Feeds the intro, the Key facts table, and the schema.",
      order: 1,
    },
    {
      id: "offerings",
      title: "What it does",
      heading: "What [COMPANY] does",
      description:
        "One H3 per service, feature, or product, two to three sentences each. Prices and contract terms feed the Key facts table and the schema offer catalog.",
      order: 2,
    },
    {
      id: "differentiators",
      title: "What makes it different",
      heading: "What makes [COMPANY] different",
      description:
        "About five specific, quantifiable differentiators, naming competitors where the facts support it. Awards, track record, and notable clients live here.",
      order: 3,
    },
    {
      id: "customers",
      title: "Who uses it",
      heading: "Who uses [COMPANY]",
      description: "A bullet list of exact customer segments.",
      order: 4,
    },
    {
      id: "team",
      title: "The team",
      heading: "The team behind [COMPANY]",
      description:
        "Founders with two-sentence backstories, the origin story, team composition, team members with roles and credentials, and social profiles.",
      order: 5,
    },
    {
      id: "process",
      title: "How it works",
      heading: "How [COMPANY] works",
      description:
        "Communication channels, response times, who the customer works with, turnaround, onboarding, and policies.",
      order: 6,
    },
    {
      id: "faq",
      title: "Questions people ask",
      heading: "Frequently asked questions",
      description:
        "Questions already answered on the site. The page gets ten to twelve, each answered in two to three sentences, and the FAQ schema repeats them word for word.",
      order: 7,
    },
    {
      id: "social",
      title: "Links and profiles",
      description:
        "Social profiles for the business and its people. Feeds the Social row and the schema sameAs lists.",
      order: 8,
    },
  ],

  fields: [
    // ---- basics ----
    {
      id: "company_name",
      section: "basics",
      label: "Company name",
      type: "text",
      required: true,
      lookFor:
        "The name the business calls itself in headings, the logo alt text, the title tag, and the footer. Not the legal entity name if that differs.",
      question: "What name should the page use for the business?",
      rendersIn: ["page", "schema"],
      schemaProperty: "name",
    },
    {
      id: "legal_name",
      section: "basics",
      label: "Legal name",
      type: "text",
      required: false,
      lookFor:
        "An entity name with Inc., LLC, Ltd., Pty, GmbH, or similar, usually in the footer, terms, privacy policy, or an award badge.",
      question:
        "Is there a legal entity name (with Inc., LLC, Ltd.) that differs from the name on the site?",
      rendersIn: ["page", "schema"],
      schemaProperty: "legalName",
    },
    {
      id: "alternate_names",
      section: "basics",
      label: "Other names the business goes by",
      type: "list",
      required: false,
      lookFor:
        "Shortened names, old names, or variants used on the site, in existing schema, or in directory listings.",
      question:
        "Does the business go by any other names (a short form, a former name, a trading name)?",
      rendersIn: ["schema"],
      itemShape: [{ key: "name", label: "Name", type: "text", required: true }],
      itemKind: "generic",
      dedupeKey: "name",
      schemaProperty: "alternateName",
    },
    {
      id: "business_type",
      section: "basics",
      label: "Business type (schema.org)",
      type: "text",
      required: true,
      lookFor:
        "The schema.org type that fits: Organization for online companies and platforms; a LocalBusiness subtype such as MedicalBusiness (clinics, counselling, dental, physio), ProfessionalService (agencies, law, accounting, consulting), Store, Restaurant, HomeAndConstructionBusiness, FinancialService, RealEstateAgent, AutoRepair, HealthAndBeautyBusiness, or LocalBusiness when it serves a place but none fits.",
      question:
        "Which best describes the business: an online company or platform, a local service business with an office or shop, a clinic or practice, a store, or a restaurant?",
      rendersIn: ["schema"],
      schemaProperty: "@type",
    },
    {
      id: "category",
      section: "basics",
      label: "Category (a ___)",
      type: "text",
      required: true,
      lookFor:
        "The short noun phrase that completes '[COMPANY] is a ___': 'curated freelance marketplace', 'counselling practice in Langley, BC', 'family-run roofing company'. Take it from the tagline, the hero, or the about page.",
      question:
        "Finish this sentence in a few words: '[COMPANY] is a ___.' (For example: 'curated freelance marketplace', 'counselling practice in Langley, BC'.)",
      rendersIn: ["page", "schema"],
      schemaProperty: "description",
    },
    {
      id: "core_offering",
      section: "basics",
      label: "What it does, in one phrase",
      type: "text",
      required: true,
      lookFor:
        "What the business does for customers in one phrase, from the hero, the tagline, or the first paragraph of the about page: 'provides in-person and online therapy for children, teens, adults, couples, and families'.",
      question:
        "What does the business do for its customers, in one phrase? (For example: 'buy SEO, content, and design work from vetted freelancers, one service at a time'.)",
      rendersIn: ["page", "schema"],
    },
    {
      id: "ideal_customer",
      section: "basics",
      label: "Who it is for",
      type: "text",
      required: true,
      lookFor:
        "Who the business serves, in a phrase: 'business owners and agencies', 'families across British Columbia'. Hero copy, about page, and service pages usually say it.",
      question: "Who is the business for, in a phrase? (For example: 'business owners and agencies'.)",
      rendersIn: ["page"],
    },
    {
      id: "mission",
      section: "basics",
      label: "Mission or goal",
      type: "text",
      required: false,
      lookFor:
        "A stated goal or mission sentence on the about page or home page, quoted as written.",
      question:
        "Is there a mission or goal you want stated on the page, in one sentence? Leave blank to skip it.",
      rendersIn: ["page"],
    },
    {
      id: "website_url",
      section: "basics",
      label: "Website",
      type: "url",
      required: true,
      lookFor: "The canonical home page URL, from the canonical tag or og:url.",
      question: "What is the website address?",
      rendersIn: ["page", "schema"],
      schemaProperty: "url",
    },
    {
      id: "logo_url",
      section: "basics",
      label: "Logo image",
      type: "url",
      required: false,
      lookFor:
        "The URL of the logo image: an img in the header with 'logo' in its src, alt, or class, or the logo in existing Organization schema.",
      question:
        "Which image file is the logo? Paste the image address (right-click the logo on your site and copy the image address).",
      rendersIn: ["schema"],
      schemaProperty: "logo",
    },
    {
      id: "founded_date",
      section: "basics",
      label: "Founded",
      type: "date",
      required: true,
      lookFor:
        "A founding or launch date or year, or 'since 2018', or 'X years in business' (keep the phrase as the quote so the year can be checked). Pages disagree on this often, so keep every mention.",
      question:
        "What year (or full date) did the business start? If the site says 'over 17 years' in one place and 'two decades' in another, one number has to win.",
      rendersIn: ["page", "schema"],
      schemaProperty: "foundingDate",
    },
    {
      id: "years_in_business",
      section: "basics",
      label: "Years in business (as stated)",
      type: "text",
      required: false,
      lookFor:
        "Any 'X+ years', 'over X years', 'two decades' claim. Keep each one; they are checked against the founding date.",
      question: "How many years has the business been operating?",
      rendersIn: ["page"],
    },
    {
      id: "headquarters",
      section: "basics",
      label: "Headquarters or office address",
      type: "address",
      required: true,
      lookFor:
        "A postal address in the footer, contact page, or LocalBusiness schema: street, suite, city, region, postal code, country. Also phrases like 'fully remote' or 'distributed team'.",
      question:
        "What is the main office or headquarters address? If there is no office, say 'remote' and give the city and country the business is registered in.",
      rendersIn: ["page", "schema"],
      addressKeys: ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"],
      schemaProperty: "address",
    },
    {
      id: "geo",
      section: "basics",
      label: "Map coordinates",
      type: "text",
      required: false,
      lookFor:
        "Latitude and longitude from existing LocalBusiness schema or an embedded map link. Sites often carry two different pins.",
      question:
        "What are the map coordinates of the office? (Optional. Copy them from your Google Business Profile.)",
      rendersIn: ["schema"],
      schemaProperty: "geo",
    },
    {
      id: "map_url",
      section: "basics",
      label: "Google Maps link",
      type: "url",
      required: false,
      lookFor: "A link to Google Maps or a Google Business Profile.",
      question: "What is the Google Maps or Google Business Profile link for the office?",
      rendersIn: ["schema"],
      schemaProperty: "hasMap",
    },
    {
      id: "phone",
      section: "basics",
      label: "Phone",
      type: "phone",
      required: false,
      lookFor: "The public phone number, from tel: links, the header, footer, or contact page.",
      question: "What phone number should the page show, if any?",
      rendersIn: ["page", "schema"],
      schemaProperty: "telephone",
    },
    {
      id: "email",
      section: "basics",
      label: "Email",
      type: "email",
      required: false,
      lookFor: "The public email address, from mailto: links, the contact page, or existing schema.",
      question: "What email address should the page show, if any?",
      rendersIn: ["page", "schema"],
      schemaProperty: "email",
    },
    {
      id: "hours",
      section: "basics",
      label: "Opening hours",
      type: "list",
      required: false,
      lookFor:
        "Opening hours by day, from the contact page, footer, or schema. Note when the site says admin hours differ from service hours.",
      question:
        "What are the opening hours, by day? Leave blank if the business has no set hours.",
      rendersIn: ["page", "schema"],
      itemShape: [
        { key: "days", label: "Days", type: "text", required: true, hint: "Monday to Thursday" },
        { key: "opens", label: "Opens", type: "text", required: true, hint: "9:00 AM" },
        { key: "closes", label: "Closes", type: "text", required: true, hint: "8:00 PM" },
      ],
      itemKind: "generic",
      dedupeKey: "days",
      conflictOn: ["opens", "closes"],
      schemaProperty: "openingHoursSpecification",
    },
    {
      id: "area_served",
      section: "basics",
      label: "Areas served",
      type: "list",
      required: false,
      lookFor:
        "Cities, regions, or countries the business serves, from service area pages, the footer, or 'serving X, Y, and Z' copy.",
      question: "Which cities, regions, or countries does the business serve?",
      rendersIn: ["page", "schema"],
      itemShape: [{ key: "name", label: "Place", type: "text", required: true }],
      itemKind: "generic",
      dedupeKey: "name",
      schemaProperty: "areaServed",
    },
    {
      id: "languages",
      section: "basics",
      label: "Languages offered",
      type: "list",
      required: false,
      lookFor: "Languages the business works in, beyond the language of the site.",
      question: "Does the business work in languages other than the site's language?",
      rendersIn: ["page", "schema"],
      itemShape: [{ key: "name", label: "Language", type: "text", required: true }],
      itemKind: "generic",
      dedupeKey: "name",
      schemaProperty: "knowsLanguage",
    },

    // ---- offerings ----
    {
      id: "services",
      section: "offerings",
      label: "Services, products, and features",
      type: "list",
      required: true,
      lookFor:
        "Each service, product, or named feature with what it does and the outcome for the customer, from service pages, the navigation, and pricing pages. Include a price when the page states one.",
      question:
        "List each service or product, with one line on what it does and what the customer gets. Add the price if there is a set one.",
      rendersIn: ["page", "schema"],
      itemShape: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "description", label: "What it does and the outcome", type: "long_text", required: true },
        { key: "price", label: "Price", type: "text", hint: "$170 per 50-minute session" },
        { key: "url", label: "Page", type: "url" },
      ],
      itemKind: "service",
      dedupeKey: "name",
      conflictOn: ["price"],
      allowlist: ["mindfulness", "mindfulness-based", "somatic", "acceptance and commitment therapy"],
      schemaProperty: "hasOfferCatalog",
    },
    {
      id: "pricing",
      section: "offerings",
      label: "Prices and plans",
      type: "list",
      required: true,
      lookFor:
        "Every stated price, plan, fee, or range with its unit (per month, per session, per order), plus free trials, free consultations, and whether tax is added. Blog posts and FAQ pages often carry older prices, so keep every mention.",
      question:
        "What does it cost? List each price or plan with its unit (per month, per session, per order), and any free trial or free consultation.",
      rendersIn: ["page", "schema"],
      itemShape: [
        { key: "name", label: "Plan or item", type: "text", required: true },
        { key: "price", label: "Price", type: "text", required: true, hint: "$47 a month" },
        { key: "notes", label: "Notes", type: "text", hint: "first 7 days free; plus GST" },
      ],
      itemKind: "price",
      dedupeKey: "name",
      conflictOn: ["price"],
      schemaProperty: "hasOfferCatalog",
    },
    {
      id: "price_range",
      section: "offerings",
      label: "Price range, in one phrase",
      type: "text",
      required: false,
      lookFor:
        "A short phrase that sums up the prices: 'from $6 an order', '$170 to $195 per 50-minute session', '$47 to $497 a month'.",
      question: "Sum up the pricing in one phrase, for example 'from $6 an order' or '$170 to $195 a session'.",
      rendersIn: ["page", "schema"],
      schemaProperty: "priceRange",
    },
    {
      id: "contract_terms",
      section: "offerings",
      label: "Contract terms",
      type: "text",
      required: true,
      lookFor:
        "Whether customers sign a contract, pay per order or per session, subscribe monthly or annually, and any cancellation or notice policy.",
      question:
        "Do customers sign a contract, pay per order or session, or subscribe? What is the cancellation policy?",
      rendersIn: ["page"],
    },
    {
      id: "free_offer",
      section: "offerings",
      label: "Free trial, consultation, or account",
      type: "text",
      required: false,
      lookFor: "A free trial, free consultation, free account, or free first call, with its length.",
      question: "Is there a free trial, free consultation, or free account? For how long?",
      rendersIn: ["page", "schema"],
    },

    // ---- differentiators ----
    {
      id: "differentiators",
      section: "differentiators",
      label: "What makes it different",
      type: "list",
      required: true,
      lookFor:
        "Specific, checkable claims that set the business apart: numbers (response times, team size, years, counts), credentials, named methods, guarantees, and comparisons with named competitors or with 'typical agencies'. Skip slogans with no fact in them.",
      question:
        "What sets the business apart, in specific terms? Numbers, credentials, guarantees, and named competitors all count. Slogans do not.",
      rendersIn: ["page"],
      itemShape: [
        { key: "claim", label: "Claim", type: "text", required: true },
        { key: "detail", label: "The fact behind it", type: "long_text" },
      ],
      itemKind: "generic",
      dedupeKey: "claim",
    },
    {
      id: "competitors",
      section: "differentiators",
      label: "Competitors or alternatives",
      type: "list",
      required: false,
      lookFor:
        "Named competitors or categories of alternative the site compares itself with: 'Fiverr and Upwork', 'online therapy subscriptions like BetterHelp', 'a traditional agency retainer'.",
      question:
        "Who are the competitors or alternatives a customer would compare you with? Named companies or categories both work.",
      rendersIn: ["page"],
      itemShape: [{ key: "name", label: "Competitor or alternative", type: "text", required: true }],
      itemKind: "generic",
      dedupeKey: "name",
    },
    {
      id: "awards",
      section: "differentiators",
      label: "Awards and recognition",
      type: "list",
      required: false,
      lookFor:
        "Awards, 'best of' listings, and ratings, with the issuer and year. Award badges are often images with no alt text, so check image file names like 'canadian-choice-2024.png'.",
      question:
        "Has the business won any awards or 'best of' listings? Give the award, who gave it, and the year.",
      rendersIn: ["page", "schema"],
      itemShape: [
        { key: "name", label: "Award", type: "text", required: true },
        { key: "issuer", label: "Issued by", type: "text" },
        { key: "year", label: "Year", type: "text" },
      ],
      itemKind: "award",
      dedupeKey: "name",
      schemaProperty: "award",
    },
    {
      id: "memberships",
      section: "differentiators",
      label: "Memberships and affiliations",
      type: "list",
      required: false,
      lookFor:
        "Professional bodies, associations, chambers of commerce, and directories shown as logos or named in the footer or about page.",
      question:
        "Which professional bodies, associations, or directories is the business a member of or listed in, and which should the page mention?",
      rendersIn: ["page", "schema"],
      itemShape: [{ key: "name", label: "Organization", type: "text", required: true }],
      itemKind: "generic",
      dedupeKey: "name",
      schemaProperty: "memberOf",
    },
    {
      id: "notable_clients",
      section: "differentiators",
      label: "Notable clients or referral partners",
      type: "list",
      required: false,
      lookFor:
        "Named clients, case studies, client logos (check alt text and file names), and named referral partners. For practices whose clients are confidential, note that instead.",
      question:
        "Can you name any clients, case studies, or referral partners? If clients are confidential, say so and the page will say that instead.",
      rendersIn: ["page"],
      itemShape: [{ key: "name", label: "Client or partner", type: "text", required: true }],
      itemKind: "generic",
      dedupeKey: "name",
    },
    {
      id: "customers_served",
      section: "differentiators",
      label: "Customers served",
      type: "text",
      required: false,
      lookFor:
        "A count or phrase for how many customers the business has served: 'tens of thousands of buyers', '25,000+ freelancers', 'thousands of clients'.",
      question: "Roughly how many customers has the business served to date? A number beats 'thousands'.",
      rendersIn: ["page"],
    },
    {
      id: "projects_delivered",
      section: "differentiators",
      label: "Projects, orders, or sessions delivered",
      type: "text",
      required: false,
      lookFor:
        "A count of orders, projects, sessions, jobs, or units delivered: 'over one million orders since 2018'.",
      question:
        "How many projects, orders, or sessions has the business delivered to date, if tracked?",
      rendersIn: ["page"],
    },
    {
      id: "track_record",
      section: "differentiators",
      label: "Track record claims",
      type: "list",
      required: false,
      lookFor:
        "Checkable results and reputation claims: '70 percent of clients come from word of mouth', review counts and ratings, retention figures, revenue scale ('eight figure business').",
      question:
        "Any results or reputation numbers worth stating: review counts, ratings, referral rates, retention, revenue scale?",
      rendersIn: ["page"],
      itemShape: [{ key: "claim", label: "Claim", type: "text", required: true }],
      itemKind: "generic",
      dedupeKey: "claim",
    },
    {
      id: "founder_quote",
      section: "differentiators",
      label: "A quote from the founder",
      type: "long_text",
      required: false,
      lookFor:
        "A direct quote from the founder or owner on the site, in quotation marks or attributed, about why the business exists or how it is different.",
      question:
        "Optional: two or three sentences from the founder, in their own words, about why the business exists. The page can carry it as a quote.",
      rendersIn: ["page"],
    },

    // ---- customers ----
    {
      id: "customer_segments",
      section: "customers",
      label: "Customer segments",
      type: "list",
      required: true,
      lookFor:
        "Exact groups of customers the business serves, with the situation they are in: 'business owners priced out of an agency retainer', 'parents of children ages 5 to 12 who are anxious or struggling at school'. Service pages and 'who we help' pages carry these.",
      question:
        "Who exactly uses the business? List each group with the situation they are in, for example 'couples who want to rebuild trust' or 'agencies that need vetted freelancers for client work'.",
      rendersIn: ["page"],
      itemShape: [{ key: "segment", label: "Segment", type: "text", required: true }],
      itemKind: "segment",
      dedupeKey: "segment",
    },

    // ---- team ----
    {
      id: "founders",
      section: "team",
      label: "Founders and owners",
      type: "list",
      required: true,
      lookFor:
        "Each founder, co-founder, or owner: full name, title, credentials, a short backstory, their profile page, and personal social links. Names are often spelled or abbreviated differently across pages; keep every variant.",
      question:
        "Who founded or owns the business? For each person: full name, title, credentials, and two sentences of backstory (where they come from, what they did before, why they started this).",
      rendersIn: ["page", "schema"],
      itemShape: [
        { key: "name", label: "Full name", type: "text", required: true },
        { key: "title", label: "Title", type: "text", required: true, hint: "Founder and CEO" },
        { key: "credentials", label: "Credentials", type: "text", hint: "MSW, RSW, RCC" },
        { key: "bio", label: "Backstory (two sentences)", type: "long_text" },
        { key: "url", label: "Profile page", type: "url" },
        { key: "linkedin", label: "LinkedIn", type: "url" },
        { key: "youtube", label: "YouTube", type: "url" },
        { key: "x", label: "X", type: "url" },
        { key: "facebook", label: "Facebook", type: "url" },
        { key: "instagram", label: "Instagram", type: "url" },
        { key: "website", label: "Personal site", type: "url" },
      ],
      itemKind: "person",
      dedupeKey: "name",
      conflictOn: ["title", "credentials"],
      allowlist: ["mindfulness", "mindfulness-based", "somatic", "authentic relating"],
      schemaProperty: "founder",
    },
    {
      id: "origin_story",
      section: "team",
      label: "How the business started",
      type: "long_text",
      required: true,
      lookFor:
        "The origin story: what the founder was doing before, what prompted the start, when it launched, and how it grew. About pages, founder pages, and blog posts carry this.",
      question:
        "How did the business start? What was the founder doing before, what prompted it, and when did it open? Two to four sentences is enough.",
      rendersIn: ["page"],
    },
    {
      id: "team_members",
      section: "team",
      label: "Team members",
      type: "list",
      required: false,
      lookFor:
        "Each named team member with role, credentials, specialties, and profile URL, from team pages and individual profile pages. Flag people with a live profile page who are missing from the team page.",
      question:
        "Who else is on the team? For each person: name, role, credentials, and specialties. Mention anyone who has left so their page can be removed.",
      rendersIn: ["page", "schema"],
      itemShape: [
        { key: "name", label: "Full name", type: "text", required: true },
        { key: "role", label: "Role", type: "text", required: true },
        { key: "credentials", label: "Credentials", type: "text" },
        { key: "specialties", label: "Specialties", type: "text" },
        { key: "url", label: "Profile page", type: "url" },
      ],
      itemKind: "person",
      dedupeKey: "name",
      conflictOn: ["role", "credentials"],
      allowlist: [
        "mindfulness",
        "mindfulness-based",
        "somatic",
        "acceptance and commitment therapy",
        "authentic relating",
      ],
      schemaProperty: "employee",
    },
    {
      id: "team_size",
      section: "team",
      label: "Team size",
      type: "text",
      required: false,
      lookFor:
        "How many people work at the business: '45 people across six continents', '14 registered therapists and three client care staff'.",
      question: "How many people are on the team, and how is it made up?",
      rendersIn: ["page", "schema"],
      schemaProperty: "numberOfEmployees",
    },
    {
      id: "team_composition",
      section: "team",
      label: "How the team is organised",
      type: "text",
      required: false,
      lookFor:
        "Departments, locations, remote or in-office, contractors versus employees, and anything that shapes how the team works.",
      question:
        "How is the team organised: departments, locations, remote or in office? Are team members employees or contractors?",
      rendersIn: ["page"],
    },

    // ---- process ----
    {
      id: "communication_channels",
      section: "process",
      label: "How customers reach you",
      type: "list",
      required: true,
      lookFor:
        "Every way a customer communicates: phone, email, contact form, chat, in-order messaging, booking portal, client portal, in person, video.",
      question:
        "How do customers reach and work with the business: phone, email, a contact form, chat, a client portal, in person, by video?",
      rendersIn: ["page"],
      itemShape: [{ key: "channel", label: "Channel", type: "text", required: true }],
      itemKind: "generic",
      dedupeKey: "channel",
    },
    {
      id: "response_time",
      section: "process",
      label: "Response time",
      type: "text",
      required: false,
      lookFor:
        "Stated response or resolution times: 'about 90 seconds to first response', 'we reply within three business days', '24/7'.",
      question: "How quickly does the business respond to a message, and is support available around the clock?",
      rendersIn: ["page"],
    },
    {
      id: "who_you_work_with",
      section: "process",
      label: "Who the customer works with",
      type: "text",
      required: true,
      lookFor:
        "Who the customer deals with day to day: the freelancer directly, an account manager, a client care team then a therapist, the owner.",
      question:
        "Who does a customer work with day to day: the owner, a dedicated person, a team, or someone matched to them?",
      rendersIn: ["page"],
    },
    {
      id: "turnaround",
      section: "process",
      label: "Turnaround or session length",
      type: "text",
      required: false,
      lookFor:
        "Delivery times, session lengths, typical wait for a first appointment, or project timelines.",
      question: "What is the typical turnaround, session length, or wait for a first appointment?",
      rendersIn: ["page"],
    },
    {
      id: "onboarding",
      section: "process",
      label: "How to get started",
      type: "long_text",
      required: true,
      lookFor:
        "The steps from first contact to first delivery: create an account, book a consultation, fill a form, intake process, what happens at the first appointment.",
      question:
        "What happens from first contact to the first delivery or appointment? List the steps.",
      rendersIn: ["page"],
    },
    {
      id: "policies",
      section: "process",
      label: "Policies worth stating",
      type: "list",
      required: false,
      lookFor:
        "Cancellation notice, refunds, guarantees, confidentiality, consent rules, payment timing, insurance and funding programs accepted.",
      question:
        "Any policies the page should state: cancellation notice, refunds, guarantees, confidentiality, payment timing, insurance or funding accepted?",
      rendersIn: ["page"],
      itemShape: [
        { key: "name", label: "Policy", type: "text", required: true },
        { key: "detail", label: "Detail", type: "long_text", required: true },
      ],
      itemKind: "generic",
      dedupeKey: "name",
      conflictOn: ["detail"],
    },

    // ---- faq ----
    {
      id: "existing_faqs",
      section: "faq",
      label: "Questions already answered on the site",
      type: "list",
      required: false,
      lookFor:
        "Question-and-answer pairs from FAQ pages, FAQ sections, accordions, and FAQPage schema. Keep the answer as written.",
      question:
        "Which questions do customers ask most? Give the question and a two-sentence answer for each. Ten to twelve is the target.",
      rendersIn: ["page", "schema"],
      itemShape: [
        { key: "question", label: "Question", type: "text", required: true },
        { key: "answer", label: "Answer", type: "long_text", required: true },
        { key: "url", label: "Page", type: "url" },
      ],
      itemKind: "faq",
      dedupeKey: "question",
      conflictOn: ["answer"],
      schemaProperty: "mainEntity",
    },

    // ---- social ----
    {
      id: "social_profiles",
      section: "social",
      label: "Social profiles",
      type: "list",
      required: false,
      lookFor:
        "Links to Facebook, Instagram, LinkedIn, YouTube, X, TikTok, Threads, Pinterest, and Google Business Profile, for the business and for named people. A handle mentioned in text without a link counts, but is flagged as constructed.",
      question:
        "What are the social profile links for the business, and for the founder? LinkedIn, YouTube, X, Facebook, Instagram, TikTok, and the Google Business Profile all help.",
      rendersIn: ["page", "schema"],
      itemShape: [
        { key: "platform", label: "Platform", type: "text", required: true },
        { key: "url", label: "Link", type: "url", required: true },
        { key: "owner", label: "Belongs to", type: "text", hint: "the business, or a person's name" },
      ],
      itemKind: "social",
      dedupeKey: "url",
      // A profile the organization's JSON-LD claims and a Person node also claims is shown as a conflict.
      conflictOn: ["owner"],
      schemaProperty: "sameAs",
    },
  ],

  keyFactsRows: [
    { label: "Company Name", from: ["company_name", "legal_name"] },
    { label: "Type", from: ["category", "business_type"] },
    { label: "Founded", from: ["founded_date", "years_in_business"] },
    { label: "Founder", from: ["founders"] },
    { label: "Headquarters", from: ["headquarters", "team_composition"] },
    { label: "Website", from: ["website_url"] },
    { label: "Core Offering", from: ["core_offering"] },
    { label: "Pricing", from: ["pricing", "price_range", "free_offer"] },
    { label: "Contract Terms", from: ["contract_terms"] },
    { label: "Services", from: ["services"] },
    { label: "Communication", from: ["communication_channels", "response_time"] },
    { label: "Notable Clients", from: ["notable_clients"] },
    { label: "Customers Served", from: ["customers_served"] },
    { label: "Projects Delivered", from: ["projects_delivered"] },
    { label: "Competitors", from: ["competitors"] },
    { label: "Social", from: ["social_profiles"] },
  ],

  faq: { min: 10, max: 12, answerSentencesMin: 2, answerSentencesMax: 3 },

  schema: {
    orgTypes: [
      "Organization",
      "LocalBusiness",
      "MedicalBusiness",
      "ProfessionalService",
      "Store",
      "Restaurant",
      "LegalService",
      "Dentist",
      "Physician",
      "HomeAndConstructionBusiness",
      "FinancialService",
      "RealEstateAgent",
      "AutoRepair",
      "HealthAndBeautyBusiness",
      "EducationalOrganization",
      "SportsActivityLocation",
      "TravelAgency",
      "LodgingBusiness",
      "FoodEstablishment",
      "ChildCare",
      "AccountingService",
      "InsuranceAgency",
      "Electrician",
      "Plumber",
      "RoofingContractor",
      "HVACBusiness",
      "VeterinaryCare",
      "FitnessCenter",
    ],
    localBusinessTypes: [
      "LocalBusiness",
      "MedicalBusiness",
      "ProfessionalService",
      "Store",
      "Restaurant",
      "LegalService",
      "Dentist",
      "Physician",
      "HomeAndConstructionBusiness",
      "FinancialService",
      "RealEstateAgent",
      "AutoRepair",
      "HealthAndBeautyBusiness",
      "SportsActivityLocation",
      "TravelAgency",
      "LodgingBusiness",
      "FoodEstablishment",
      "ChildCare",
      "AccountingService",
      "InsuranceAgency",
      "Electrician",
      "Plumber",
      "RoofingContractor",
      "HVACBusiness",
      "VeterinaryCare",
      "FitnessCenter",
    ],
  },
};

export const TEMPLATES: Record<string, TemplateSpec> = { [ABOUT_V1.id]: ABOUT_V1 };

export function getTemplate(id: string): TemplateSpec {
  const t = TEMPLATES[id];
  if (!t) throw new Error(`Unknown template: ${id}`);
  return t;
}

export function fieldsBySection(spec: TemplateSpec) {
  const out = new Map<string, typeof spec.fields>();
  for (const s of [...spec.sections].sort((a, b) => a.order - b.order)) out.set(s.id, []);
  for (const f of spec.fields) out.get(f.section)?.push(f);
  return out;
}
