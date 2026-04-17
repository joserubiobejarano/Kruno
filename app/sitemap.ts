import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo/site";
import { cityPages } from "@/lib/seo/cities";
import { countryHubs } from "@/lib/seo/countries";
import { influencerPages } from "@/lib/seo/influencers";

// Update this date whenever you publish a new batch of content.
// Do NOT use new Date() here — a changing date causes Google to re-crawl
// all pages on every deploy instead of discovering unindexed ones.
const CONTENT_UPDATED_AT = new Date("2026-04-17");

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const locales = ["en", "es"];

  const staticRoutes = [
    "/about",
    "/contact",
    "/privacy",
    "/terms",
    "/cookies",
  ];

  const staticEntries = staticRoutes.map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified: CONTENT_UPDATED_AT,
    changeFrequency: "monthly" as const,
    priority: 0.5,
  }));

  const marketingRoutes = ["", "/cities", "/influencers", "/discover-kruno"];
  const marketingEntries = marketingRoutes.flatMap((path) =>
    locales.map((locale) => ({
      url: `${siteUrl}/${locale}${path}`,
      lastModified: CONTENT_UPDATED_AT,
      changeFrequency: "weekly" as const,
      priority: path === "" ? 1 : 0.7,
    }))
  );

  // Only include full-content city pages in the sitemap.
  // Lite pages (stub content) are excluded to protect crawl budget.
  const fullCityPages = cityPages.filter((city) => city.contentLevel === "full");
  const cityEntries = fullCityPages.flatMap((city) =>
    locales.map((locale) => ({
      url: `${siteUrl}/${locale}/cities/${city.slug}`,
      lastModified: CONTENT_UPDATED_AT,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    }))
  );

  const countryEntries = countryHubs.flatMap((country) => [
    {
      url: `${siteUrl}/en/countries/${country.slugEn}`,
      lastModified: CONTENT_UPDATED_AT,
      changeFrequency: "monthly" as const,
      priority: 0.75,
    },
    {
      url: `${siteUrl}/es/countries/${country.slugEs}`,
      lastModified: CONTENT_UPDATED_AT,
      changeFrequency: "monthly" as const,
      priority: 0.75,
    },
  ]);

  const influencerEntries = influencerPages.flatMap((influencer) =>
    locales.map((locale) => ({
      url: `${siteUrl}/${locale}/influencers/${influencer.slug}`,
      lastModified: CONTENT_UPDATED_AT,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    }))
  );

  return [...staticEntries, ...marketingEntries, ...cityEntries, ...countryEntries, ...influencerEntries];
}
