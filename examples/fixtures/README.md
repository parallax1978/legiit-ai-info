# Fact sheet fixtures

Two fact sheets in the shape the app stores (`FactSheetData` in
`src/lib/facts/types.ts`), built by hand from the two example runs in the parent
folder. They are test inputs for the merge logic, the review screen, and the
generator (slice 3): given these, the generator's output should pass the linter
and match the structure of the example pages.

- `legiit.factsheet.json`: Legiit after the thirteen questions in
  `legiit-about-page-questions.md` were answered. Answers are `user_provided`
  with `source: "user"` evidence. The Instagram URL that was built from a handle
  is flagged in the field note.
- `darcy-bailey.factsheet.json`: Darcy Bailey & Associates Counselling before the
  open questions were answered, so it carries real conflicts (years in business,
  the couples fee, the GST question, name spellings, two titles, two map pins)
  and missing fields (founding year, the founder's book, wait time, sessions
  delivered).

Quotes are copied from the example pages. Evidence URLs for the Darcy Bailey run
point at the real site's pages (about-us, rates, faq, our-team, profile pages);
the two blog post slugs and the Jane booking URL are the best guess from the
question list, since the example did not record them.
