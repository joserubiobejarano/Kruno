import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: [
          "/api/",
          "/trips",
          "/trips/",
          "/settings",
          "/settings/",
          "/sign-in",
          "/sign-up",
          "/p/",
          "/dental-clinic-experiment",
          "/sentry-example-page",
          "/monitoring",
          "/*?*utm_",
          "/*?*gclid=",
          "/*?*fbclid=",
          "/*?*msclkid=",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
