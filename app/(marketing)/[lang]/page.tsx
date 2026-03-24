import type { Metadata } from "next";
import { HomePageClient } from "@/components/home-page-client";
import { HomepageSeoLinksSection } from "@/components/seo/HomepageSeoLinksSection";
import { StructuredData } from "@/components/seo/StructuredData";
import { buildMetadata } from "@/lib/seo/metadata";
import { getSiteUrl, siteConfig } from "@/lib/seo/site";
import { buildCanonicalUrl, buildLanguageAlternates, getLocalizedPath, isSupportedLocale } from "@/lib/seo/urls";
import { getMarketingCopy } from "@/lib/i18n/marketing";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

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
  const localizedBase = buildCanonicalUrl(getLocalizedPath("/", lang));
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
      <HomepageSeoLinksSection lang={lang} />
    </>
  );
}
