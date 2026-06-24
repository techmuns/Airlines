# Project guidance for Claude

## Working with Neha (project owner) — always applies

1. **All work lands on `main`.** Commit and push finished work straight to the
   `main` branch. Do not use any other branch unless Neha clearly asks for it.

2. **Plain language only.** Neha is not a technical person. Explain everything in
   simple, everyday words. Avoid technical jargon and acronyms; if a technical
   word is unavoidable, explain it in one short plain sentence.

3. **Don't ask Neha to do manual work.** Automate as much as possible. Only ask
   her to do something by hand when it is truly unavoidable (for example, a
   one-time account sign-in or connection that only she can approve). When that
   happens, give short, simple, click-by-click steps.

4. **Always end every reply with a plain-English summary.** Finish each response
   with a short wrap-up written in absolutely simple, everyday language that a
   non-technical person can fully understand (no jargon, no acronyms). The
   summary must clearly cover three things:
   - **What was done** — the work that is finished.
   - **What was not done** — anything skipped, left out, or still incomplete.
   - **What should be done** — the suggested next steps.

## What this project is
The **Airline Demand Monitor** — a website that shows airline passenger demand
and regional aviation traffic, and keeps itself up to date automatically.

- **The website (front)** is plain files (no complicated build step) so it is
  reliable and updates with no manual work.
- **The data behind it** lives in two files the website reads:
  - `data/tsa.json` — daily U.S. airport security (TSA) passenger numbers
  - `data/data.json` — monthly global airline traffic (IATA)
- The site is hosted on **Cloudflare Pages** and refreshes automatically every
  time new data lands on `main`.
- Keep the TSA section and the airline/IATA section completely separate.
