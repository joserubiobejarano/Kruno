import type { Metadata } from "next";
import Link from "next/link";
import { HomePageClient } from "@/components/home-page-client";
import { HomepageSeoLinksSection } from "@/components/seo/HomepageSeoLinksSection";
import { StructuredData } from "@/components/seo/StructuredData";
import { buildMetadata } from "@/lib/seo/metadata";
import { getSiteUrl, siteConfig } from "@/lib/seo/site";
import { buildCanonicalUrl, buildLanguageAlternates, getLocalizedPath, isSupportedLocale } from "@/lib/seo/urls";
import { getMarketingCopy } from "@/lib/i18n/marketing";
import { HOMEPAGE_NEW_GUIDE_SLUGS, getCityBySlug } from "@/lib/seo/cities";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

const newGuidePillClass =
  "rounded-full border border-border/60 bg-white px-4 py-2.5 text-sm font-medium text-foreground shadow-sm transition-all duration-200 hover:border-primary/60 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-2";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { lang } = await params;
  const resolvedSearchParams = await searchParams;
  if (!isSupportedLocale(lang)) {
    return {};
  }
  const copy = getMarketingCopy(lang);
  const path = getLocalizedPath("/", lang);
  const canonical = buildCanonicalUrl(path, resolvedSearchParams);
  return buildMetadata({
    title: copy.homeMetaTitle,
    description: copy.homeMetaDescription,
    path,
    searchParams: resolvedSearchParams,
    alternates: {
      canonical,
      languages: buildLanguageAlternates("/"),
    },
    openGraphLocale: lang === "es" ? "es_ES" : "en_US",
    openGraphAlternateLocales: lang === "es" ? ["en_US"] : ["es_ES"],
  });
}

export default async function LocalizedHomePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isSupportedLocale(lang)) {
    notFound();
  }
  const { userId } = await auth();
  const isSignedIn = Boolean(userId);
  const siteUrl = getSiteUrl();
  const basePath = getLocalizedPath("", lang);
  const localizedBase = buildCanonicalUrl(getLocalizedPath("/", lang));
  const newGuideCities = HOMEPAGE_NEW_GUIDE_SLUGS.map((slug) => getCityBySlug(slug)).filter(
    (city): city is NonNullable<typeof city> => city != null
  );
  const newGuidesTitle = lang === "es" ? "Guías nuevas recientes" : "Recently added guides";
  const newGuidesSubtitle =
    lang === "es"
      ? "Destinos que acabamos de publicar en Kruno."
      : "Destinations we have just published on Kruno.";
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: siteConfig.name,
      url: localizedBase,
      potentialAction: {
        "@type": "SearchAction",
        target: `${siteUrl}${getLocalizedPath("/cities", lang)}?query={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: siteConfig.name,
      url: localizedBase,
      logo: `${siteUrl}/icon.svg`,
    },
  ];

  return (
    <>
      <StructuredData data={structuredData} id={`kruno-home-ld-${lang}`} />
      <HomePageClient showChrome={false} isSignedIn={isSignedIn} />
      <section
        className="py-12 px-6"
        style={{ backgroundColor: "hsl(var(--cream))" }}
        aria-label={newGuidesTitle}
      >
        <div className="max-w-6xl mx-auto">
          <div className="bg-white rounded-2xl shadow-sm p-6 md:p-8 transition-shadow duration-300 hover:shadow-md">
            <div className="space-y-3 mb-5">
              <h2
                className="text-3xl md:text-4xl font-bold"
                style={{ fontFamily: "'Patrick Hand', cursive" }}
              >
                {newGuidesTitle}
              </h2>
              <p className="text-muted-foreground">{newGuidesSubtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {newGuideCities.map((city) => (
                <Link
                  key={city.slug}
                  href={`${basePath}/cities/${city.slug}`}
                  className={newGuidePillClass}
                >
                  {city.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>
      <HomepageSeoLinksSection lang={lang} />
    </>
  );
}
