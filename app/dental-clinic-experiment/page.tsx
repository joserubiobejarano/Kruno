import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dental Clinic Services",
  description: "Informational landing page about dental clinic services.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      "max-image-preview": "none",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function DentalClinicExperimentPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold">Dental Clinic Services</h1>
      <p className="mt-4 text-base text-slate-700">
        This page provides general information about services commonly offered by
        a dental clinic.
      </p>

      <section className="mt-8">
        <h2 className="text-xl font-medium">General Dentistry</h2>
        <ul className="mt-3 list-disc space-y-1 pl-6 text-slate-800">
          <li>Routine dental exams and oral health evaluations</li>
          <li>Professional teeth cleaning and plaque removal</li>
          <li>Digital X-rays and diagnostic assessments</li>
          <li>Tooth-colored fillings for cavity treatment</li>
          <li>Preventive care plans and hygiene guidance</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-medium">Restorative Treatments</h2>
        <ul className="mt-3 list-disc space-y-1 pl-6 text-slate-800">
          <li>Dental crowns and bridges</li>
          <li>Root canal therapy</li>
          <li>Partial and full dentures</li>
          <li>Dental implant restoration consultations</li>
          <li>Emergency dental pain and damage care</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-medium">Cosmetic Dentistry</h2>
        <ul className="mt-3 list-disc space-y-1 pl-6 text-slate-800">
          <li>Teeth whitening treatments</li>
          <li>Porcelain veneers</li>
          <li>Cosmetic bonding</li>
          <li>Smile design consultations</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-medium">Orthodontic and Gum Care</h2>
        <ul className="mt-3 list-disc space-y-1 pl-6 text-slate-800">
          <li>Orthodontic assessment and treatment planning</li>
          <li>Clear aligner and braces evaluations</li>
          <li>Gum disease screening and periodontal maintenance</li>
          <li>Deep cleaning for gum health support</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-medium">Patient Information</h2>
        <p className="mt-3 text-slate-700">
          Treatment recommendations, timelines, and fees depend on each
          patient&apos;s clinical needs after examination by a licensed dentist.
        </p>
      </section>
    </main>
  );
}
