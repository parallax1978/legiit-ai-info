# Legiit about page: the questions that were asked, and the answers

How this example was produced: the first draft was written from facts Chris supplied, with bracketed placeholders for everything missing. These are the questions that came out of that draft, the answers Chris gave, and where each answer landed. Use it as the fixture for the question flow: every placeholder on a generated page should map to one plain-language question like these.

| # | Question | Answer given | Where it went |
|---|----------|--------------|---------------|
| 1 | Chris's YouTube link | https://www.youtube.com/@ChrisMWalker | Founder bio links, Social row, schema founder sameAs |
| 2 | Chris's LinkedIn link | https://www.linkedin.com/in/superstarseo/ | Same |
| 3 | Chris's X link | https://x.com/cmwalker | Same |
| 4 | Chris's Facebook link | https://www.facebook.com/cmwlegiit/ | Same |
| 5 | Jim's link | https://www.linkedin.com/in/jimsabellico/ | Jim's bio, schema co-founder sameAs |
| 6 | Legiit's own social links | YouTube @LegiitOfficial, LinkedIn /company/legiit, X @legiitcom, Facebook /legiitofficial | Social row, schema organization sameAs |
| 7 | Legiit Leads prices | Starter $47, Agency $97, Agency Pro $297, Agency Empire $497 per month, first 7 days free, two months free on annual (from a screenshot of the pricing page; the draft had assumed three tiers, there are four) | Pricing row, Legiit Leads section, cost FAQ |
| 8 | Notable client names | Superstar SEO, No Half Cakes, 38 Digital Market, Craig Campbell SEO | Notable Clients row |
| 9 | Confirm headquarters | Not Las Vegas. 2411 N. Oak Street 105E, Myrtle Beach, SC 29577, USA | Headquarters row, schema address |
| 10 | Seller Plus price (no placeholder, but the Pricing row needs it) | $27 a month | Pricing row, Seller Plus section, cost FAQ |
| 11 | Jim's last name | Sabellico | Every mention of Jim, schema founder |
| 12 | Logo URL | Found on the site: https://legiit.com/frontend/images/project_image/logos/Legiit_Logo_LightBG.png | Schema logo |
| 13 | Leadership team full names | Found on the live page: Jessica Lavatai (COO), Djordje Jovanovic (Director of Operations), Marija Jovanovic (Customer Success Director), Ritesh Shah (Head of Development) | Team section, schema employee |

Things the process caught that the person did not ask about:

- The draft said Legiit Leads had three tiers. The pricing page shows four. A scan of the pricing page would have caught this before the first draft.
- The draft listed Las Vegas as headquarters. The real answer was Myrtle Beach. Any fact the user supplies from memory should still be confirmed against the site.
- The live about page had an older schema block with "Jim" and no last name and no logo, and the visible page used the full name in one spot but not three others. The FAQ answer in the schema must match the visible page word for word, so a name change touches both.
- Instagram was the one URL built from a handle in the copy rather than supplied. The tool should flag any URL it constructed rather than found.
