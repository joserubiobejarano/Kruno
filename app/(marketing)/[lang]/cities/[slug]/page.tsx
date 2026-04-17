import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import { cityPages, getCityBySlug } from "@/lib/seo/cities";
import { StructuredData } from "@/components/seo/StructuredData";
import { getSiteUrl } from "@/lib/seo/site";
import {
  buildCanonicalUrl,
  buildLanguageAlternates,
  getLocalizedPath,
  isSupportedLocale,
  SUPPORTED_LOCALES,
} from "@/lib/seo/urls";
import { getMarketingCopy } from "@/lib/i18n/marketing";
import { getItineraryCopy } from "@/lib/i18n/itinerary";
import { getCityItinerary } from "@/lib/itinerary/city-itineraries";
import { getDayImageCards } from "@/lib/itinerary/day-images";
import { ItineraryHero } from "@/components/itinerary/Hero";
import { IconNav, type IconNavItem } from "@/components/itinerary/IconNav";
import { CityStats } from "@/components/itinerary/CityStats";
import { DayOverviewTable } from "@/components/itinerary/DayOverviewTable";
import { DayPlanSlider } from "@/components/itinerary/DayPlanSlider";
import { LogisticsTable } from "@/components/itinerary/LogisticsTable";
import { Checklist } from "@/components/itinerary/Checklist";
import { FAQAccordion } from "@/components/itinerary/FAQAccordion";
import { RelatedItineraries } from "@/components/itinerary/RelatedItineraries";
import { PrimaryCTA } from "@/components/itinerary/PrimaryCTA";
import { SectionBand } from "@/components/itinerary/SectionBand";
import { collectInvalidImageUrls, validateGuide } from "@/lib/guides/validateGuide";
import { getRelatedGuides } from "@/lib/seo/related-guides";

export function generateStaticParams() {
  return SUPPORTED_LOCALES.flatMap((lang) =>
    cityPages.map((city) => ({ lang, slug: city.slug }))
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>;
}): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isSupportedLocale(lang)) {
    return {};
  }
  const city = getCityBySlug(slug);
  const path = getLocalizedPath(`/cities/${slug}`, lang);
  const copy = getMarketingCopy(lang);
  const itinerary = getCityItinerary(lang, slug);
  if (!city) {
    return buildMetadata({
      title: copy.citiesMetaTitle,
      description: copy.citiesMetaDescription,
      path,
      alternates: {
        canonical: buildCanonicalUrl(path),
        languages: buildLanguageAlternates(`/cities/${slug}`),
      },
      openGraphLocale: lang === "es" ? "es_ES" : "en_US",
      openGraphAlternateLocales: lang === "es" ? ["en_US"] : ["es_ES"],
    });
  }

  // Lite pages have stub content — exclude from Google's index to protect crawl budget.
  if (city.contentLevel === "lite") {
    return { robots: { index: false, follow: true } };
  }

  const cityName = itinerary?.city ?? city.name;
  const cityDays = itinerary?.days ?? city.days;
  const title =
    lang === "es"
      ? `Cómo pasar ${cityDays} días en ${cityName} sin ir muy apurado.`
      : `How to spend ${cityDays} days in ${cityName} without Rushing`;
  const description =
    lang === "es"
      ? `Una guía de viaje completa de ${cityName}, día a día y diseñada para quienes la visitan por primera vez. Visita lo esencial, disfruta de una excelente comida y evita planificar demasiado.`
      : `A full day-by-day ${cityName} travel guide designed for first-time visitors. See the essentials, enjoy great food, and avoid overplanning.`;

  return buildMetadata({
    title,
    description,
    path,
    alternates: {
      canonical: buildCanonicalUrl(path),
      languages: buildLanguageAlternates(`/cities/${city.slug}`),
    },
    openGraphLocale: lang === "es" ? "es_ES" : "en_US",
    openGraphAlternateLocales: lang === "es" ? ["en_US"] : ["es_ES"],
  });
}

export default async function LocalizedCityItineraryPage({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>;
}) {
  const { lang, slug } = await params;
  if (!isSupportedLocale(lang)) {
    notFound();
  }
  const city = getCityBySlug(slug);
  if (!city) {
    notFound();
  }

  const copy = getMarketingCopy(lang);
  const itineraryCopy = getItineraryCopy(lang);
  const itinerary = getCityItinerary(lang, slug);
  const siteUrl = getSiteUrl();
  const basePath = getLocalizedPath("", lang);
  const displayCityName = itinerary?.city ?? city.name;
  const displayCityCountry = itinerary?.country ?? city.country;
  const displayCityDays = itinerary?.days ?? city.days;
  const travelGuideLabel =
    lang === "es"
      ? `Guía de ${displayCityName} en ${displayCityDays} días`
      : `${displayCityName} ${displayCityDays}-day travel guide`;
  const pacingTitle =
    lang === "es"
      ? `Cómo disfrutar ${displayCityName} en ${displayCityDays} días`
      : `How to enjoy ${displayCityName} in ${displayCityDays} days`;
  const dayOverviewTitle =
    lang === "es"
      ? `El plan para estos ${displayCityDays} días en ${displayCityName}`
      : `The plan for these ${displayCityDays} days in ${displayCityName}`;
  const logisticsTitle =
    lang === "es"
      ? `${itineraryCopy.logisticsTitle} en ${displayCityName}`
      : `${itineraryCopy.logisticsTitle} for ${displayCityName}`;
  const checklistTitle =
    lang === "es"
      ? `${itineraryCopy.checklistTitle} para ${displayCityName}`
      : `${itineraryCopy.checklistTitle} to ${displayCityName}`;
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: `${siteUrl}${basePath}`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: copy.citiesHubTitle,
          item: `${siteUrl}${basePath}/cities`,
        },
        {
          "@type": "ListItem",
          position: 3,
          name: travelGuideLabel,
          item: `${siteUrl}${basePath}/cities/${city.slug}`,
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "TouristTrip",
      name: travelGuideLabel,
      description: itinerary?.hero.subtitle ?? city.description,
      touristType: "Leisure",
      itinerary: {
        "@type": "ItemList",
        itemListElement: city.highlights.map((highlight, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: highlight,
        })),
      },
    },
  ];

  if (!itinerary) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-16 space-y-10">
        <StructuredData data={structuredData} id={`kruno-city-ld-${lang}`} />
        <div className="space-y-4">
          <div className="text-sm uppercase tracking-wide text-muted-foreground">
            {displayCityCountry}
          </div>
          <h1 className="text-4xl font-bold">{travelGuideLabel}</h1>
          <p className="text-lg text-muted-foreground">{city.description}</p>
        </div>
        <div>
          <h2 className="text-2xl font-semibold">{copy.cityDetailHighlightsTitle}</h2>
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {city.highlights.map((highlight) => (
              <li key={highlight} className="rounded-xl border border-border/40 p-4">
                {highlight}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-border/40 p-6 bg-background">
          <h3 className="text-xl font-semibold">{copy.cityDetailPlanTitle}</h3>
          <p className="mt-2 text-muted-foreground">{copy.cityDetailPlanBody}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={basePath || "/"}
              className="inline-flex items-center rounded-full bg-primary px-6 py-2 text-sm font-medium text-primary-foreground"
            >
              {copy.cityDetailPlanCta}
            </Link>
            <Link
              href={`${basePath}/cities`}
              className="inline-flex items-center rounded-full border border-border px-6 py-2 text-sm font-medium"
            >
              {copy.cityDetailBrowseAll}
            </Link>
          </div>
        </div>
        <div>
          <h3 className="text-xl font-semibold">{copy.cityDetailExploreMore}</h3>
          <div className="mt-4 flex flex-wrap gap-3">
            {cityPages
              .filter((other) => other.slug !== city.slug)
              .map((other) => (
                <Link
                  key={other.slug}
                  href={`${basePath}/cities/${other.slug}`}
                  className="text-sm text-primary"
                >
                  {other.name}
                </Link>
              ))}
          </div>
        </div>
      </div>
    );
  }

  const localizedPrimaryCtaHref = getLocalizedPath(itinerary.primaryCtaHref, lang);
  const localizedSecondaryCtaHref = itinerary.secondaryCtaHref
    ? getLocalizedPath(itinerary.secondaryCtaHref, lang)
    : undefined;
  const faqStructuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: itinerary.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
  const relatedGuides = getRelatedGuides(city, lang, itinerary.relatedItineraries);
  const relatedItemsWithImages = relatedGuides.map((item) => ({
    ...item,
    image: getCityItinerary(lang, item.slug)?.hero.image,
  }));
  // Use English city name and day plan titles for image lookup to ensure consistency across languages.
  // Always use English itinerary for image lookup when available, regardless of current language.
  // This ensures Spanish pages show the same images as English pages.
  const englishItinerary = getCityItinerary("en", slug);
  // Always prefer English city name and day plans for image lookup when English itinerary exists
  const imageLookupCity = englishItinerary?.city ?? itinerary.city ?? city.name;
  const imageLookupCountry = englishItinerary?.country ?? itinerary.country ?? city.country;
  const imageLookupDayPlans = englishItinerary?.dayPlans ?? itinerary.dayPlans;
  const dayImageCardsResult = await getDayImageCards({
    slug: itinerary.slug,
    city: imageLookupCity,
    country: imageLookupCountry,
    dayPlans: imageLookupDayPlans,
    fallbackImage: itinerary.hero.image,
  });
  // Map image cards to use current language titles for display (Spanish titles on ES pages, English on EN pages)
  const dayImageCards = dayImageCardsResult
    ? dayImageCardsResult.map((card, index) => {
        const displayTitle = itinerary.dayPlans[index]?.title ?? card.title;
        return {
          ...card,
          title: displayTitle,
          image: {
            ...card.image,
            alt: `${displayCityName} - ${displayTitle}`,
          },
        };
      })
    : null;
  if (process.env.NODE_ENV !== "production") {
    const missingP0 = validateGuide(itinerary);
    const invalidImageUrls = collectInvalidImageUrls(itinerary, relatedItemsWithImages);
    const missingRelatedLinks = itinerary.relatedItineraries.length
      ? itinerary.relatedItineraries
          .filter((item) => !item.slug || !getCityItinerary(lang, item.slug))
          .map((item) => item.slug || item.city || "unknown")
      : ["No related itineraries configured"];

    if (missingP0.length || invalidImageUrls.length || missingRelatedLinks.length) {
      console.warn(`[Guide QA] ${itinerary.slug} has issues`, {
        missingP0,
        invalidImageUrls,
        missingRelatedLinks,
      });
    }
  }

  const iconNavItems: IconNavItem[] = [
    { id: "overview", label: displayCityName, icon: "Compass" },
    { id: "facts", label: itineraryCopy.iconNav.facts, icon: "Star" },
    { id: "top", label: itineraryCopy.iconNav.top, icon: "MapPinned" },
    { id: "attractions", label: itineraryCopy.iconNav.attractions, icon: "Landmark" },
    { id: "history", label: itineraryCopy.iconNav.history, icon: "BookOpen" },
    { id: "food", label: itineraryCopy.iconNav.food, icon: "UtensilsCrossed" },
    { id: "logistics", label: itineraryCopy.iconNav.logistics, icon: "MapPin" },
    { id: "checklist", label: itineraryCopy.iconNav.checklist, icon: "CheckSquare" },
    { id: "tips", label: itineraryCopy.iconNav.tips, icon: "HelpCircle" },
  ];

  return (
    <div className="bg-background">
      <StructuredData data={[...structuredData, faqStructuredData]} id={`kruno-city-ld-${lang}`} />
      <SectionBand
        variant="base"
        className="!bg-background"
        innerClassName="flex justify-center py-4 md:py-6"
      >
        <div className="w-full max-w-6xl">
          <IconNav items={iconNavItems} />
        </div>
      </SectionBand>
      <SectionBand
        id="overview"
        variant="base"
        padding="md"
        className="scroll-mt-24 !bg-background"
        innerClassName="max-w-7xl pt-10 pb-14 md:pt-12 md:pb-20"
      >
        <div className="rounded-[2.75rem] border border-border/40 bg-white p-6 shadow-[0_30px_90px_-60px_rgba(15,23,42,0.6)] md:p-10">
          <ItineraryHero
            eyebrow={itinerary.hero.eyebrow ?? itineraryCopy.heroEyebrowLabel}
            title={itinerary.hero.title}
            subtitle={itinerary.hero.subtitle}
            image={itinerary.hero.image}
          />
        </div>
      </SectionBand>

      <SectionBand
        id="top"
        variant="base"
        className="scroll-mt-24 !bg-background"
        innerClassName="pt-10 pb-14 md:pt-12 md:pb-20"
      >
        <CityStats
          title={itineraryCopy.cityStatsTitle}
          cityName={displayCityName}
          items={itinerary.cityStats ?? []}
        />
      </SectionBand>

      <SectionBand
        id="attractions"
        variant="base"
        className="scroll-mt-24 !bg-background"
        innerClassName="pt-10 pb-14 md:pt-12 md:pb-20 max-w-7xl"
      >
        <DayOverviewTable
          title={dayOverviewTitle}
          labels={itineraryCopy.dayOverviewTable}
          plans={itinerary.dayPlans}
        />
      </SectionBand>

      <SectionBand
        id="facts"
        variant="base"
        className="scroll-mt-24 !bg-background"
        innerClassName="pt-10 pb-14 md:pt-12 md:pb-20"
      >
        <section className="space-y-8 font-sans">
          <h2 className="text-center text-2xl font-semibold">{itineraryCopy.fitTitle}</h2>
          <div className="grid gap-8 md:grid-cols-2">
            {/* Great Fit Column */}
            <div className="rounded-3xl border-2 border-emerald-300 bg-emerald-50/70 p-6 md:p-8">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-emerald-700">
                  {itineraryCopy.fitGoodLabel}
                </h3>
              </div>
              <ul className="space-y-3 text-sm">
                {itinerary.fit.forYou.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-emerald-800"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            {/* Not Ideal Column */}
            <div className="rounded-3xl border-2 border-rose-300 bg-rose-50/70 p-6 md:p-8">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500 text-white">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-rose-700">
                  {itineraryCopy.fitNotLabel}
                </h3>
              </div>
              <ul className="space-y-3 text-sm">
                {itinerary.fit.notForYou.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-rose-800"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-rose-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </SectionBand>

      <SectionBand
        id="history"
        variant="base"
        className="scroll-mt-24 !bg-background"
        innerClassName="space-y-8 pt-10 pb-14 md:pt-12 md:pb-20"
      >
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">{itineraryCopy.dayBreakdownTitle}</h2>
          <DayPlanSlider
            plans={itinerary.dayPlans}
            labels={itineraryCopy.dayBlockLabels}
            imageCards={dayImageCards ?? itinerary.imageInfoCards}
            heroImage={itinerary.hero.image}
          />
        </section>
      </SectionBand>

      {itinerary.pacing?.length ? (
        <SectionBand
          variant="base"
          className="!bg-background"
          innerClassName="space-y-8 pt-10 pb-14 md:pt-12 md:pb-20 max-w-7xl"
        >
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">{pacingTitle}</h2>
            <div className="space-y-4 rounded-3xl border border-[#7b2b04]/20 bg-[#ffedd5] p-6 text-sm text-[#7b2b04] md:p-8 md:text-base">
              {itinerary.pacing.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </section>
        </SectionBand>
      ) : null}

      <SectionBand
        variant="base"
        className="!bg-background"
        innerClassName="space-y-8 pt-10 pb-14 md:pt-12 md:pb-20 max-w-7xl"
      >
        <section id="logistics" className="scroll-mt-24">
          <LogisticsTable
            title={logisticsTitle}
            items={itinerary.logistics}
          />
        </section>
      </SectionBand>

      {itinerary.goodToKnow?.length ? (
        <SectionBand
          variant="base"
          className="!bg-background"
          innerClassName="space-y-8 pt-10 pb-14 md:pt-12 md:pb-20 max-w-7xl"
        >
          <section className="scroll-mt-24">
            <LogisticsTable title={itineraryCopy.goodToKnowTitle} items={itinerary.goodToKnow} />
          </section>
        </SectionBand>
      ) : null}

      <SectionBand
        variant="base"
        className="!bg-background"
        innerClassName="space-y-8 pt-10 pb-14 md:pt-12 md:pb-20 max-w-7xl"
      >
        <section id="checklist" className="scroll-mt-24">
          <Checklist
            title={checklistTitle}
            subtitle={itineraryCopy.checklistSubtitle}
            items={itinerary.checklist}
          />
        </section>
      </SectionBand>

      <SectionBand
        id="tips"
        variant="base"
        className="scroll-mt-24 !bg-background"
        innerClassName="space-y-8 pt-10 pb-14 md:pt-12 md:pb-20"
      >
        <FAQAccordion title={itineraryCopy.faqTitle} items={itinerary.faqs} />
      </SectionBand>

      <SectionBand
        variant="base"
        className="!bg-background"
        innerClassName="space-y-8 pt-10 pb-14 md:pt-12 md:pb-20"
      >
        <PrimaryCTA
          title={itineraryCopy.primaryCtaTitle}
          body={itineraryCopy.primaryCtaBody}
          buttonText={itineraryCopy.primaryCtaButton}
          href={localizedPrimaryCtaHref}
        />
      </SectionBand>

      <SectionBand
        variant="base"
        className="!bg-background"
        innerClassName="space-y-8 pt-10 pb-14 md:pt-12 md:pb-20"
      >
        <RelatedItineraries
          title={itineraryCopy.relatedTitle}
          items={relatedItemsWithImages}
          basePath={basePath}
          dayUnit={itineraryCopy.dayUnit}
          buttonText={itineraryCopy.secondaryCtaButton}
        />
      </SectionBand>

    </div>
  );
}
