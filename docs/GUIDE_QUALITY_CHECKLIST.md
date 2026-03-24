# Guide Quality Checklist

Use this checklist before shipping any new city guide. The bar is "Rome quality."

## P0 (must-have)
- Hero section includes title, subtitle, and a valid hero image URL.
- Hero image and all three image-info-card images use **Unsplash** (`https://images.unsplash.com/...`) URLs that clearly match the guide city (EN and ES share the same `src`; localize alt text only).
- City stats section includes 3-5 stats with clear labels.
- Image cards section includes 3 cards with title, description, and image.
- Day plans count matches the number of days and each day has all fields filled.
- FAQ section includes 7 Q/A pairs with full-length answers.
- Related itineraries section includes 6 links with valid slugs (deterministic augmentation from 3+ in data).
- All image URLs are valid (https or local `/` paths).
- Primary and secondary CTA links are set.

## P1 (recommended)
- Spanish localization is complete and matches the English structure.
- Related itineraries are varied (not all the same city/country).
- Logistics includes at least 4 entries covering timing, transit, and tickets.
- Checklist includes at least 6 actionable items.
- Descriptions avoid repetition across sections.

## P2 (nice-to-have)
- Seasonality tips include shoulder-season guidance.
- One or two local tips add personality without adding length.
- Image choices show different times of day or neighborhoods.

## Default duration
- Default guides must be **2 or 3 days**. Use 3 days unless the city is small/compact (then 2 is OK).
- **Do not ship 4+ day default guides.** Longer durations belong in separate duration-variant pages (unique slug, `primaryKeyword`, and content).
- If a 4-day guide is produced by mistake, correct it to 2–3 days before shipping.

## SEO
- Follow the "SEO Copy Rules" in `docs/ADDING_A_CITY_GUIDE.md`, including fully localized Spanish metadata.
- Set `intent`, `contentLevel`, and `primaryKeyword` on each city in `cityPages` per `docs/ADDING_A_CITY_GUIDE.md`. `primaryKeyword` must not duplicate any other indexed city guide.
- **Internal linking:** Each guide should link to 6 related guides and be reachable from homepage ("Popular travel guides"), city hub (`/en/cities`, `/es/cities`), and country hub (`/en/countries/[slug]`, `/es/countries/[slug]`).
- **URL architecture:** City guides remain under `/cities/[slug]`; country hubs live under `/countries/[slug]`. Do not change existing city guide URLs.

## Ship / No-Ship rule
- Ship only if all P0 checks pass and there are no missing sections or broken images in dev.
- If any P0 item fails, it is a No-Ship until fixed.
