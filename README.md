# Legiit Ai Info

An AI-ready About page for any business website: crawl the site, build a fact
sheet with evidence, review what is found, missing, and contradicted, then
generate the page, the JSON-LD, and install instructions.

See `PLAN.md` for the architecture and `CLAUDE.md` for conventions and commands.

## Run it

```bash
cp .env.example .env.local   # fill in Supabase and Anthropic keys
pnpm install
pnpm dev
```

Apply `supabase/migrations/*.sql` to your Supabase project in order (SQL editor
or `supabase db push`).
